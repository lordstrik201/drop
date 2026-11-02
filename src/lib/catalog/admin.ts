import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/lib/db/client";
import { parseBRL } from "@/lib/money";
import { slugify } from "@/lib/validation/br";
import { priceForMargin } from "./pricing";
import type { ProductStatus } from "@/lib/types";

/** Valor em reais digitado no painel ("1.234,56") → centavos; vazio → null. */
const moneyOpt = z.preprocess((v) => (v === "" || v == null ? null : typeof v === "number" ? v : parseBRL(String(v))), z.number().int().min(0).max(100_000_000).nullable());
const money = z.preprocess((v) => (v === "" || v == null ? 0 : typeof v === "number" ? v : parseBRL(String(v))), z.number().int().min(0).max(100_000_000));
const intOpt = (max: number) => z.preprocess((v) => (v === "" || v == null ? null : Number(String(v).replace(",", "."))), z.number().int().min(0).max(max).nullable());
const decOpt = z.preprocess((v) => (v === "" || v == null ? null : Number(String(v).replace(",", "."))), z.number().positive().max(9999).nullable());
const textOpt = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable().optional());
const dateOpt = z.preprocess((v) => (v === "" || v == null ? null : new Date(String(v))), z.date().nullable());

export const productSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(200),
  slug: z.string().trim().max(120).optional(),
  sku: z.string().trim().min(1, "Informe o SKU").max(60).regex(/^[\w.\-/]+$/, "SKU: use letras, números, ponto, hífen, barra ou _"),
  short_description: textOpt(300),
  description: textOpt(50_000),
  brand: textOpt(80),
  category_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  supplier_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  supplier_product_ref: textOpt(120),
  status: z.enum(["draft", "active", "inactive", "archived"]),
  is_featured: z.boolean(),
  cost_cents: money,
  shipping_cost_cents: money,
  price_cents: money,
  compare_at_cents: moneyOpt,
  promo_price_cents: moneyOpt,
  promo_starts_at: dateOpt,
  promo_ends_at: dateOpt,
  target_margin_bps: z.preprocess((v) => (v === "" || v == null ? null : Math.round(Number(String(v).replace(",", ".")) * 100)), z.number().int().min(-10000).max(100000).nullable()),
  weight_grams: intOpt(1_000_000),
  length_cm: decOpt,
  width_cm: decOpt,
  height_cm: decOpt,
  lead_time_min_days: intOpt(180),
  lead_time_max_days: intOpt(180),
  seo_title: textOpt(70),
  seo_description: textOpt(170),
}).superRefine((p, ctx) => {
  if (p.promo_price_cents != null && p.promo_price_cents >= p.price_cents) ctx.addIssue({ code: "custom", path: ["promo_price_cents"], message: "O preço promocional deve ser menor que o preço normal" });
  if (p.promo_starts_at && p.promo_ends_at && p.promo_ends_at <= p.promo_starts_at) ctx.addIssue({ code: "custom", path: ["promo_ends_at"], message: "O fim da promoção deve ser depois do início" });
  if (p.lead_time_min_days != null && p.lead_time_max_days != null && p.lead_time_max_days < p.lead_time_min_days) ctx.addIssue({ code: "custom", path: ["lead_time_max_days"], message: "Prazo máximo menor que o mínimo" });
  if (p.status === "active") {
    if (p.price_cents <= 0) ctx.addIssue({ code: "custom", path: ["price_cents"], message: "Produto ativo precisa de preço" });
    if (!p.supplier_id) ctx.addIssue({ code: "custom", path: ["supplier_id"], message: "Produto ativo precisa de fornecedor (sem ele o pedido não pode ser encaminhado)" });
  }
});
export type ProductInput = z.infer<typeof productSchema>;

export class CatalogError extends Error {}

function friendlyDbError(e: unknown): never {
  const err = e as { code?: string; constraint_name?: string; message?: string };
  if (err.code === "23505") {
    if (err.constraint_name?.includes("slug")) throw new CatalogError("Já existe um produto com esse endereço (slug).");
    if (err.constraint_name?.includes("sku")) throw new CatalogError("Já existe um produto ou variação com esse SKU.");
    if (err.constraint_name?.includes("supplier_ref")) throw new CatalogError("Este produto do fornecedor já foi cadastrado.");
  }
  throw e;
}

async function uniqueSlug(tx: DbOrTx, base: string, exceptId: string | null) {
  const root = slugify(base).slice(0, 100) || "produto";
  for (let i = 0; i < 50; i++) {
    const s = i === 0 ? root : `${root}-${i + 1}`;
    const [hit] = await tx`select id from public.products where slug = ${s} and id is distinct from ${exceptId}`;
    if (!hit) return s;
  }
  throw new CatalogError("Não foi possível gerar um endereço único para o produto.");
}

async function recordPrice(tx: Tx, productId: string, variantId: string | null, v: { cost: number | null; ship: number | null; price: number | null; promo: number | null }, source: string, actorId: string | null) {
  await tx`insert into public.price_history (product_id, variant_id, cost_cents, shipping_cost_cents, price_cents, promo_price_cents, source, changed_by)
           values (${productId}, ${variantId}, ${v.cost}, ${v.ship}, ${v.price}, ${v.promo}, ${source}, ${actorId})`;
}

/** Cria ou atualiza um produto. Mudanças de preço/custo entram no histórico. */
export async function saveProduct(id: string | null, raw: unknown, actorId: string | null): Promise<{ id: string; slug: string }> {
  const p = productSchema.parse(raw);
  try {
    return await db().begin(async (tx: Tx) => {
      const slug = p.slug ? slugify(p.slug) : await uniqueSlug(tx, p.name, id);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new CatalogError("Endereço (slug) inválido.");
      const values = { ...p, slug };
      if (id) {
        const [before] = await tx<{ cost_cents: number; shipping_cost_cents: number; price_cents: number; promo_price_cents: number | null; sku: string }[]>`
          select cost_cents, shipping_cost_cents, price_cents, promo_price_cents, sku from public.products where id = ${id} for update`;
        if (!before) throw new CatalogError("Produto não encontrado.");
        if (p.status === "active") await assertSellable(tx, id);
        await tx`update public.products set ${tx(values as never)} where id = ${id}`;
        if (before.cost_cents !== p.cost_cents || before.shipping_cost_cents !== p.shipping_cost_cents || before.price_cents !== p.price_cents || before.promo_price_cents !== p.promo_price_cents) {
          await recordPrice(tx, id, null, { cost: p.cost_cents, ship: p.shipping_cost_cents, price: p.price_cents, promo: p.promo_price_cents }, "manual", actorId);
        }
        // a variação padrão acompanha o SKU do produto
        if (before.sku !== p.sku) await tx`update public.product_variants set sku = ${p.sku} where product_id = ${id} and upper(sku) = upper(${before.sku})`;
        return { id, slug };
      }
      if (p.status === "active") throw new CatalogError("Salve o produto como rascunho, adicione imagem e estoque e depois ative.");
      const [ins] = await tx<{ id: string }[]>`insert into public.products ${tx(values as never)} returning id`;
      await tx`insert into public.product_variants (product_id, sku, title, stock_quantity) values (${ins.id}, ${p.sku}, 'Padrão', 0)`;
      await recordPrice(tx, ins.id, null, { cost: p.cost_cents, ship: p.shipping_cost_cents, price: p.price_cents, promo: p.promo_price_cents }, "manual", actorId);
      return { id: ins.id, slug };
    });
  } catch (e) {
    friendlyDbError(e);
  }
}

/** Requisitos mínimos para um produto ficar visível e vendável na loja. */
async function assertSellable(tx: DbOrTx, productId: string) {
  const [r] = await tx<{ images: number; variants: number }[]>`
    select (select count(*)::int from public.product_images where product_id = ${productId}) as images,
           (select count(*)::int from public.product_variants where product_id = ${productId} and is_active) as variants`;
  if (r.images === 0) throw new CatalogError("Adicione pelo menos uma imagem antes de ativar o produto.");
  if (r.variants === 0) throw new CatalogError("O produto precisa de pelo menos uma variação ativa.");
}

export async function setProductsStatus(ids: string[], status: ProductStatus) {
  return db().begin(async (tx: Tx) => {
    const ok: string[] = [], skipped: string[] = [];
    for (const id of ids) {
      if (status === "active") {
        const [p] = await tx<{ name: string; price_cents: number; supplier_id: string | null }[]>`select name, price_cents, supplier_id from public.products where id = ${id}`;
        if (!p) continue;
        try {
          if (p.price_cents <= 0 || !p.supplier_id) throw new CatalogError("sem preço ou fornecedor");
          await assertSellable(tx, id);
        } catch {
          skipped.push(p.name);
          continue;
        }
      }
      await tx`update public.products set status = ${status} where id = ${id}`;
      ok.push(id);
    }
    return { updated: ok.length, skipped };
  });
}

/**
 * Reajuste em massa. "percent": aplica % sobre o preço atual; "margin": recalcula
 * o preço para a margem-alvo a partir do custo + frete + taxas estimadas.
 */
export async function bulkReprice(ids: string[], mode: { kind: "percent"; bps: number } | { kind: "margin"; marginBps: number; feeBps: number; feeFixed: number }, actorId: string | null) {
  return db().begin(async (tx: Tx) => {
    const rows = await tx<{ id: string; price_cents: number; cost_cents: number; shipping_cost_cents: number; promo_price_cents: number | null }[]>`
      select id, price_cents, cost_cents, shipping_cost_cents, promo_price_cents from public.products where id = any(${ids}::uuid[]) for update`;
    let n = 0;
    for (const r of rows) {
      const price = mode.kind === "percent"
        ? Math.max(0, Math.round((r.price_cents * (10000 + mode.bps)) / 10000))
        : priceForMargin(r.cost_cents, r.shipping_cost_cents, mode.marginBps, mode.feeBps, mode.feeFixed);
      if (price === r.price_cents) continue;
      // promoção que deixaria de ser menor que o preço é removida para não exibir "desconto" falso
      const promo = r.promo_price_cents != null && r.promo_price_cents >= price ? null : r.promo_price_cents;
      await tx`update public.products set price_cents = ${price}, promo_price_cents = ${promo} where id = ${r.id}`;
      await recordPrice(tx, r.id, null, { cost: r.cost_cents, ship: r.shipping_cost_cents, price, promo }, mode.kind === "percent" ? "bulk_percent" : "bulk_margin", actorId);
      n++;
    }
    return n;
  });
}

export async function duplicateProduct(id: string, actorId: string | null): Promise<string> {
  return db().begin(async (tx: Tx) => {
    const [p] = await tx`select * from public.products where id = ${id}`;
    if (!p) throw new CatalogError("Produto não encontrado.");
    const suffix = Date.now().toString(36).toUpperCase().slice(-5);
    const slug = await uniqueSlug(tx, `${p.slug}-copia`, null);
    const [n] = await tx<{ id: string }[]>`
      insert into public.products (name, slug, sku, short_description, description, brand, category_id, supplier_id, supplier_product_ref, status, is_featured,
        cost_cents, shipping_cost_cents, price_cents, compare_at_cents, promo_price_cents, promo_starts_at, promo_ends_at, target_margin_bps,
        weight_grams, length_cm, width_cm, height_cm, lead_time_min_days, lead_time_max_days, seo_title, seo_description)
      select ${p.name + " (cópia)"}, ${slug}, ${p.sku + "-" + suffix}, short_description, description, brand, category_id, supplier_id, null, 'draft', false,
        cost_cents, shipping_cost_cents, price_cents, compare_at_cents, promo_price_cents, promo_starts_at, promo_ends_at, target_margin_bps,
        weight_grams, length_cm, width_cm, height_cm, lead_time_min_days, lead_time_max_days, seo_title, seo_description
      from public.products where id = ${id} returning id`;
    await tx`insert into public.product_images (product_id, url, storage_path, alt, position)
             select ${n.id}, url, null, alt, position from public.product_images where product_id = ${id}`;
    await tx`insert into public.product_variants (product_id, sku, title, options, cost_cents, shipping_cost_cents, price_cents, promo_price_cents, stock_quantity, image_url, position, is_active)
             select ${n.id}, sku || ${"-" + suffix}, title, options, cost_cents, shipping_cost_cents, price_cents, promo_price_cents, 0, image_url, position, is_active
             from public.product_variants where product_id = ${id}`;
    await recordPrice(tx, n.id, null, { cost: p.cost_cents, ship: p.shipping_cost_cents, price: p.price_cents, promo: p.promo_price_cents }, "duplicate", actorId);
    return n.id;
  });
}

/** Exclui se nunca foi vendido; com vendas, arquiva (o histórico do pedido mantém o snapshot). */
export async function deleteOrArchiveProduct(id: string): Promise<"deleted" | "archived"> {
  return db().begin(async (tx: Tx) => {
    const [sold] = await tx<{ n: number }[]>`select count(*)::int as n from public.order_items where product_id = ${id}`;
    if (sold.n > 0) {
      await tx`update public.products set status = 'archived' where id = ${id}`;
      return "archived";
    }
    await tx`delete from public.cart_items where variant_id in (select id from public.product_variants where product_id = ${id})`;
    await tx`delete from public.products where id = ${id}`;
    return "deleted";
  });
}

// ---------------------------------------------------------------------------
// Variações
// ---------------------------------------------------------------------------
export const variantSchema = z.object({
  sku: z.string().trim().min(1).max(60).regex(/^[\w.\-/]+$/, "SKU inválido"),
  title: z.string().trim().min(1).max(120),
  options: z.record(z.string().max(40), z.string().max(60)).default({}),
  supplier_variant_ref: textOpt(120),
  cost_cents: moneyOpt,
  shipping_cost_cents: moneyOpt,
  price_cents: moneyOpt,
  promo_price_cents: moneyOpt,
  stock_quantity: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(1_000_000)),
  image_url: textOpt(1000),
  position: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(1000)),
  is_active: z.boolean(),
});

/** "Cor: Azul; Tamanho: M" → { Cor: "Azul", Tamanho: "M" } */
export function parseOptions(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(/[;\n]/)) {
    const [k, ...rest] = part.split(":");
    const v = rest.join(":").trim();
    if (k?.trim() && v) out[k.trim().slice(0, 40)] = v.slice(0, 60);
  }
  return out;
}

export async function saveVariant(productId: string, variantId: string | null, raw: unknown, source: string, actorId: string | null) {
  const v = variantSchema.parse(raw);
  if (v.image_url && !/^https:\/\//.test(v.image_url)) throw new CatalogError("A imagem da variação deve ser um endereço https://");
  try {
    return await db().begin(async (tx: Tx) => {
      if (variantId) {
        const [before] = await tx<{ stock_quantity: number; cost_cents: number | null; price_cents: number | null; shipping_cost_cents: number | null; promo_price_cents: number | null }[]>`
          select stock_quantity, cost_cents, price_cents, shipping_cost_cents, promo_price_cents from public.product_variants where id = ${variantId} and product_id = ${productId} for update`;
        if (!before) throw new CatalogError("Variação não encontrada.");
        await tx`update public.product_variants set ${tx({ ...v, options: tx.json(v.options as never) } as never)},
                   stock_updated_at = case when ${before.stock_quantity !== v.stock_quantity} then now() else stock_updated_at end
                 where id = ${variantId}`;
        if (before.stock_quantity !== v.stock_quantity) {
          await tx`insert into public.stock_history (variant_id, previous_quantity, new_quantity, source) values (${variantId}, ${before.stock_quantity}, ${v.stock_quantity}, ${source})`;
        }
        if (before.cost_cents !== v.cost_cents || before.price_cents !== v.price_cents || before.shipping_cost_cents !== v.shipping_cost_cents || before.promo_price_cents !== v.promo_price_cents) {
          await recordPrice(tx, productId, variantId, { cost: v.cost_cents, ship: v.shipping_cost_cents, price: v.price_cents, promo: v.promo_price_cents }, source, actorId);
        }
        return variantId;
      }
      const [ins] = await tx<{ id: string }[]>`insert into public.product_variants ${tx({ ...v, product_id: productId, options: tx.json(v.options as never), stock_updated_at: new Date() } as never)} returning id`;
      await tx`insert into public.stock_history (variant_id, previous_quantity, new_quantity, source) values (${ins.id}, null, ${v.stock_quantity}, ${source})`;
      return ins.id;
    });
  } catch (e) {
    friendlyDbError(e);
  }
}

export async function deleteVariant(productId: string, variantId: string) {
  return db().begin(async (tx: Tx) => {
    const [n] = await tx<{ n: number }[]>`select count(*)::int as n from public.product_variants where product_id = ${productId}`;
    if (n.n <= 1) throw new CatalogError("O produto precisa de pelo menos uma variação. Desative-a em vez de excluir.");
    const [sold] = await tx<{ n: number }[]>`select count(*)::int as n from public.order_items where variant_id = ${variantId}`;
    if (sold.n > 0) {
      await tx`update public.product_variants set is_active = false where id = ${variantId}`;
      return "deactivated" as const;
    }
    await tx`delete from public.cart_items where variant_id = ${variantId}`;
    await tx`delete from public.product_variants where id = ${variantId} and product_id = ${productId}`;
    return "deleted" as const;
  });
}

/** Atualiza estoque de uma variação (manual, CSV ou sincronização), com histórico. */
export async function setVariantStock(tx: DbOrTx, variantId: string, qty: number, source: string): Promise<boolean> {
  const q = Math.max(0, Math.floor(qty));
  const [r] = await tx<{ previous: number }[]>`
    with prev as (select stock_quantity from public.product_variants where id = ${variantId} for update)
    update public.product_variants v set stock_quantity = ${q}, stock_updated_at = now()
    from prev where v.id = ${variantId} returning prev.stock_quantity as previous`;
  if (!r) return false;
  if (r.previous !== q) {
    await tx`insert into public.stock_history (variant_id, previous_quantity, new_quantity, source) values (${variantId}, ${r.previous}, ${q}, ${source})`;
  }
  return r.previous !== q;
}

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------
export async function addProductImage(productId: string, img: { url: string; storagePath?: string | null; alt?: string | null }) {
  if (!/^https:\/\/\S+$/.test(img.url)) throw new CatalogError("A imagem deve ser um endereço https://");
  const [{ pos }] = await db()<{ pos: number }[]>`select coalesce(max(position) + 1, 0)::int as pos from public.product_images where product_id = ${productId}`;
  await db()`insert into public.product_images (product_id, url, storage_path, alt, position) values (${productId}, ${img.url}, ${img.storagePath ?? null}, ${img.alt ?? null}, ${pos})`;
}

export async function moveProductImage(productId: string, imageId: string, dir: -1 | 1) {
  await db().begin(async (tx: Tx) => {
    const imgs = await tx<{ id: string }[]>`select id from public.product_images where product_id = ${productId} order by position, created_at for update`;
    const i = imgs.findIndex((x) => x.id === imageId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= imgs.length) return;
    [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
    for (let k = 0; k < imgs.length; k++) await tx`update public.product_images set position = ${k} where id = ${imgs[k].id}`;
  });
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().max(80).optional(),
  parent_id: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  description: textOpt(2000),
  image_url: textOpt(1000),
  seo_title: textOpt(70),
  seo_description: textOpt(170),
  position: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(10000)),
  is_active: z.boolean(),
});

export async function saveCategory(id: string | null, raw: unknown) {
  const c = categorySchema.parse(raw);
  if (c.image_url && !/^https:\/\//.test(c.image_url)) throw new CatalogError("A imagem deve ser um endereço https://");
  const slug = slugify(c.slug || c.name);
  if (!slug) throw new CatalogError("Nome inválido.");
  const sql = db();
  if (id && c.parent_id) {
    // impede ciclos (categoria dentro de si mesma ou de uma descendente)
    const [cycle] = await sql`
      with recursive up as (select id, parent_id from public.categories where id = ${c.parent_id}
                            union all select p.id, p.parent_id from public.categories p join up on p.id = up.parent_id)
      select 1 from up where id = ${id}`;
    if (cycle) throw new CatalogError("Uma categoria não pode ficar dentro dela mesma.");
  }
  try {
    if (id) {
      const [r] = await sql`update public.categories set ${sql({ ...c, slug } as never)} where id = ${id} returning id`;
      if (!r) throw new CatalogError("Categoria não encontrada.");
      return id;
    }
    const [r] = await sql<{ id: string }[]>`insert into public.categories ${sql({ ...c, slug } as never)} returning id`;
    return r.id;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new CatalogError("Já existe uma categoria com esse endereço.");
    throw e;
  }
}

export async function deleteCategory(id: string) {
  return db().begin(async (tx: Tx) => {
    const [n] = await tx<{ products: number; children: number }[]>`
      select (select count(*)::int from public.products where category_id = ${id}) as products,
             (select count(*)::int from public.categories where parent_id = ${id}) as children`;
    if (n.products > 0) throw new CatalogError(`A categoria tem ${n.products} produto(s). Mova-os antes de excluir.`);
    if (n.children > 0) throw new CatalogError("A categoria tem subcategorias. Mova-as antes de excluir.");
    await tx`delete from public.categories where id = ${id}`;
  });
}
