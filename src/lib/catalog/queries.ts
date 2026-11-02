import "server-only";
import { db } from "@/lib/db/client";
import { effectivePrice, type EffectivePrice } from "./pricing";

export type ProductCard = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  rating_avg: number;
  rating_count: number;
  sold_count: number;
  in_stock: boolean;
  lead_time_min_days: number | null;
  lead_time_max_days: number | null;
  pricing: EffectivePrice;
};

type Row = {
  id: string; slug: string; name: string; brand: string | null; image: string | null;
  rating_avg: string; rating_count: number; sold_count: number; stock: number;
  price_cents: number; compare_at_cents: number | null; promo_price_cents: number | null;
  promo_starts_at: Date | null; promo_ends_at: Date | null;
  min_variant_price: number | null; campaign_bps: number | null;
  lead_time_min_days: number | null; lead_time_max_days: number | null;
};

function toCard(r: Row): ProductCard {
  return {
    id: r.id, slug: r.slug, name: r.name, brand: r.brand, image: r.image,
    rating_avg: Number(r.rating_avg), rating_count: r.rating_count, sold_count: r.sold_count,
    in_stock: r.stock > 0,
    lead_time_min_days: r.lead_time_min_days, lead_time_max_days: r.lead_time_max_days,
    pricing: effectivePrice(
      { price_cents: r.min_variant_price ?? r.price_cents, compare_at_cents: r.compare_at_cents, promo_price_cents: r.promo_price_cents, promo_starts_at: r.promo_starts_at, promo_ends_at: r.promo_ends_at },
      null,
      r.campaign_bps ?? 0,
    ),
  };
}

export type ProductSort = "relevance" | "bestsellers" | "price_asc" | "price_desc" | "newest" | "rating" | "discount";

export type ProductQuery = {
  q?: string;
  categorySlug?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onSale?: boolean;
  featured?: boolean;
  brand?: string;
  minRating?: number;
  sort?: ProductSort;
  page?: number;
  perPage?: number;
  excludeId?: string;
};

/** Listagem do catálogo público com busca textual, tolerância a erros de digitação e filtros. */
export async function listProducts(q: ProductQuery = {}): Promise<{ items: ProductCard[]; total: number }> {
  const sql = db();
  const perPage = Math.min(Math.max(q.perPage ?? 24, 1), 60);
  const page = Math.max(q.page ?? 1, 1);
  const term = q.q?.trim().slice(0, 100) || null;

  const conds = [sql`p.status = 'active'`];
  if (term) {
    conds.push(sql`(p.search_vector @@ websearch_to_tsquery('portuguese', public.f_unaccent(${term}))
      or public.f_unaccent(lower(p.name)) % public.f_unaccent(lower(${term}))
      or upper(p.sku) = upper(${term}))`);
  }
  if (q.categorySlug) {
    conds.push(sql`p.category_id in (
      with recursive tree as (
        select id from public.categories where slug = ${q.categorySlug} and is_active
        union all select c.id from public.categories c join tree t on c.parent_id = t.id where c.is_active
      ) select id from tree)`);
  }
  if (q.brand) conds.push(sql`lower(p.brand) = lower(${q.brand})`);
  if (q.featured) conds.push(sql`p.is_featured`);
  if (q.minRating) conds.push(sql`p.rating_avg >= ${q.minRating}`);
  if (q.excludeId) conds.push(sql`p.id <> ${q.excludeId}`);
  const where = conds.reduce((a, c) => sql`${a} and ${c}`);

  const priceExpr = sql`(case when p.promo_price_cents is not null and p.promo_price_cents < p.price_cents
      and (p.promo_starts_at is null or p.promo_starts_at <= now()) and (p.promo_ends_at is null or p.promo_ends_at > now())
      then p.promo_price_cents else coalesce(v.min_price, p.price_cents) end)`;

  const outer = [sql`true`];
  if (q.minPrice != null) outer.push(sql`x.eff_price >= ${q.minPrice}`);
  if (q.maxPrice != null) outer.push(sql`x.eff_price <= ${q.maxPrice}`);
  if (q.inStock) outer.push(sql`x.stock > 0`);
  if (q.onSale) outer.push(sql`(x.eff_price < x.price_cents or coalesce(x.compare_at_cents, 0) > x.eff_price or x.campaign_bps > 0)`);
  const outerWhere = outer.reduce((a, c) => sql`${a} and ${c}`);

  const order = {
    relevance: term
      ? sql`ts_rank(x.search_vector, websearch_to_tsquery('portuguese', public.f_unaccent(${term}))) desc, x.sold_count desc`
      : sql`x.is_featured desc, x.sold_count desc, x.created_at desc`,
    bestsellers: sql`x.sold_count desc, x.rating_avg desc`,
    price_asc: sql`x.eff_price asc`,
    price_desc: sql`x.eff_price desc`,
    newest: sql`x.created_at desc`,
    rating: sql`x.rating_avg desc, x.rating_count desc`,
    discount: sql`(greatest(x.price_cents, coalesce(x.compare_at_cents, 0)) - x.eff_price)::float / nullif(greatest(x.price_cents, coalesce(x.compare_at_cents, 0)), 0) desc nulls last`,
  }[q.sort ?? "relevance"];

  const rows = await sql<(Row & { total: number })[]>`
    with base as (
      select p.id, p.slug, p.name, p.brand, p.rating_avg, p.rating_count, p.sold_count, p.price_cents,
             p.compare_at_cents, p.promo_price_cents, p.promo_starts_at, p.promo_ends_at, p.is_featured,
             p.created_at, p.search_vector, p.lead_time_min_days, p.lead_time_max_days,
             v.min_price as min_variant_price, coalesce(v.stock, 0) as stock,
             ${priceExpr} as eff_price,
             (select max(c.discount_bps) from public.campaigns c
               where c.is_active and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())
                 and (c.product_id = p.id or c.category_id = p.category_id or (c.product_id is null and c.category_id is null))) as campaign_bps,
             (select url from public.product_images i where i.product_id = p.id order by position limit 1) as image
      from public.products p
      left join lateral (
        select min(coalesce(pv.price_cents, p.price_cents)) as min_price, sum(pv.stock_quantity)::int as stock
        from public.product_variants pv where pv.product_id = p.id and pv.is_active
      ) v on true
      where ${where}
    )
    select x.*, count(*) over()::int as total from base x
    where ${outerWhere}
    order by ${order}
    limit ${perPage} offset ${(page - 1) * perPage}`;
  return { items: rows.map(toCard), total: rows[0]?.total ?? 0 };
}

export type CategoryNode = { id: string; parent_id: string | null; name: string; slug: string; description: string | null; image_url: string | null; seo_title: string | null; seo_description: string | null; product_count: number };

export async function listCategories(): Promise<CategoryNode[]> {
  return db()<CategoryNode[]>`
    select c.id, c.parent_id, c.name, c.slug, c.description, c.image_url, c.seo_title, c.seo_description,
      (select count(*)::int from public.products p where p.category_id = c.id and p.status = 'active') as product_count
    from public.categories c where c.is_active order by c.position, c.name`;
}

export async function getCategory(slug: string) {
  const [c] = await db()<CategoryNode[]>`
    select id, parent_id, name, slug, description, image_url, seo_title, seo_description, 0 as product_count
    from public.categories where slug = ${slug} and is_active`;
  return c ?? null;
}

export async function listBrands(categorySlug?: string): Promise<string[]> {
  const rows = categorySlug
    ? await db()<{ brand: string }[]>`select distinct p.brand from public.products p join public.categories c on c.id = p.category_id where p.status='active' and c.slug = ${categorySlug} and p.brand is not null order by 1`
    : await db()<{ brand: string }[]>`select distinct brand from public.products where status='active' and brand is not null order by 1`;
  return rows.map((r) => r.brand);
}

export type ProductDetail = {
  id: string; slug: string; name: string; sku: string; brand: string | null;
  short_description: string | null; description: string | null;
  category: { name: string; slug: string } | null;
  images: { url: string; alt: string | null }[];
  variants: { id: string; sku: string; title: string; options: Record<string, string>; stock: number; image_url: string | null; pricing: EffectivePrice }[];
  optionNames: string[];
  rating_avg: number; rating_count: number; sold_count: number;
  lead_time_min_days: number | null; lead_time_max_days: number | null;
  supplier_processing_days: number | null;
  seo_title: string | null; seo_description: string | null;
  pricing: EffectivePrice;
};

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const sql = db();
  const [p] = await sql`
    select p.*, c.name as category_name, c.slug as category_slug, s.avg_processing_days,
      (select max(cp.discount_bps) from public.campaigns cp
        where cp.is_active and (cp.starts_at is null or cp.starts_at <= now()) and (cp.ends_at is null or cp.ends_at > now())
          and (cp.product_id = p.id or cp.category_id = p.category_id or (cp.product_id is null and cp.category_id is null))) as campaign_bps
    from public.products p
    left join public.categories c on c.id = p.category_id
    left join public.suppliers s on s.id = p.supplier_id
    where p.slug = ${slug} and p.status = 'active'`;
  if (!p) return null;
  const [images, variants] = await Promise.all([
    sql<{ url: string; alt: string | null }[]>`select url, alt from public.product_images where product_id = ${p.id} order by position`,
    sql`select id, sku, title, options, stock_quantity, image_url, price_cents, promo_price_cents from public.product_variants where product_id = ${p.id} and is_active order by position, title`,
  ]);
  const camp = Number(p.campaign_bps ?? 0);
  const v = variants.map((x) => ({
    id: x.id as string, sku: x.sku as string, title: x.title as string, options: (x.options ?? {}) as Record<string, string>,
    stock: x.stock_quantity as number, image_url: x.image_url as string | null,
    pricing: effectivePrice(p as never, { price_cents: x.price_cents, promo_price_cents: x.promo_price_cents }, camp),
  }));
  const optionNames = Array.from(new Set(v.flatMap((x) => Object.keys(x.options))));
  return {
    id: p.id, slug: p.slug, name: p.name, sku: p.sku, brand: p.brand,
    short_description: p.short_description, description: p.description,
    category: p.category_slug ? { name: p.category_name, slug: p.category_slug } : null,
    images, variants: v, optionNames,
    rating_avg: Number(p.rating_avg), rating_count: p.rating_count, sold_count: p.sold_count,
    lead_time_min_days: p.lead_time_min_days, lead_time_max_days: p.lead_time_max_days,
    supplier_processing_days: p.avg_processing_days,
    seo_title: p.seo_title, seo_description: p.seo_description,
    pricing: v.length ? v.reduce((min, x) => (x.pricing.price < min.price ? x.pricing : min), v[0].pricing) : effectivePrice(p as never, null, camp),
  };
}

export async function listReviews(productId: string, limit = 20) {
  return db()<{ id: string; author_name: string; rating: number; title: string | null; body: string | null; verified_purchase: boolean; created_at: Date }[]>`
    select id, author_name, rating, title, body, verified_purchase, created_at from public.reviews
    where product_id = ${productId} and status = 'approved' order by created_at desc limit ${limit}`;
}

export async function relatedProducts(productId: string, limit = 8) {
  const [p] = await db()<{ category_id: string | null }[]>`select category_id from public.products where id = ${productId}`;
  if (!p?.category_id) return (await listProducts({ sort: "bestsellers", perPage: limit, excludeId: productId })).items;
  const [c] = await db()<{ slug: string }[]>`select slug from public.categories where id = ${p.category_id}`;
  return (await listProducts({ categorySlug: c?.slug, sort: "bestsellers", perPage: limit, excludeId: productId })).items;
}

export async function activeBanners(placement = "home_hero") {
  return db()<{ id: string; title: string; subtitle: string | null; cta_label: string | null; link_url: string | null; image_url: string | null; mobile_image_url: string | null; background_color: string | null }[]>`
    select id, title, subtitle, cta_label, link_url, image_url, mobile_image_url, background_color from public.banners
    where placement = ${placement} and is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
    order by position, created_at desc limit 6`;
}
