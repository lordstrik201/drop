import "server-only";
import { cookies } from "next/headers";
import { db, type DbOrTx } from "@/lib/db/client";
import { effectivePrice } from "@/lib/catalog/pricing";

export const CART_COOKIE = "drop_cart";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CartLine = {
  variantId: string;
  productId: string;
  slug: string;
  name: string;
  variantTitle: string;
  sku: string;
  image: string | null;
  quantity: number;
  stock: number;
  unitPrice: number;
  originalPrice: number | null;
  available: boolean;
  shippingCost: number;
  supplierId: string | null;
};

export type CartView = { id: string | null; couponCode: string | null; email: string | null; lines: CartLine[]; itemCount: number; subtotal: number };

export async function getCartId(): Promise<string | null> {
  const v = (await cookies()).get(CART_COOKIE)?.value;
  return v && UUID.test(v) ? v : null;
}

export async function setCartCookie(id: string) {
  (await cookies()).set(CART_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearCartCookie() {
  (await cookies()).delete(CART_COOKIE);
}

export async function ensureCart(profileId: string | null): Promise<string> {
  const sql = db();
  const existing = await getCartId();
  if (existing) {
    const [c] = await sql<{ id: string }[]>`select id from public.carts where id = ${existing} and status = 'open'`;
    if (c) {
      if (profileId) await sql`update public.carts set profile_id = ${profileId} where id = ${c.id} and profile_id is null`;
      return c.id;
    }
  }
  if (profileId) {
    const [c] = await sql<{ id: string }[]>`select id from public.carts where profile_id = ${profileId} and status = 'open' order by updated_at desc limit 1`;
    if (c) {
      await setCartCookie(c.id);
      return c.id;
    }
  }
  const [c] = await sql<{ id: string }[]>`insert into public.carts (profile_id) values (${profileId}) returning id`;
  await setCartCookie(c.id);
  return c.id;
}

/** Linhas do carrinho com preço e estoque ATUAIS (o preço só é congelado no pedido). */
export async function loadCartLines(cartId: string, sql: DbOrTx = db()): Promise<CartLine[]> {
  const rows = await sql`
    select ci.quantity, v.id as variant_id, v.sku, v.title as variant_title, v.stock_quantity, v.is_active as v_active,
      v.price_cents as v_price, v.promo_price_cents as v_promo, v.shipping_cost_cents as v_ship, v.image_url as v_image,
      p.id as product_id, p.slug, p.name, p.status, p.price_cents, p.compare_at_cents, p.promo_price_cents,
      p.promo_starts_at, p.promo_ends_at, p.shipping_cost_cents, p.supplier_id,
      (select url from public.product_images i where i.product_id = p.id order by position limit 1) as image,
      (select max(c.discount_bps) from public.campaigns c
        where c.is_active and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now())
          and (c.product_id = p.id or c.category_id = p.category_id or (c.product_id is null and c.category_id is null))) as campaign_bps
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    where ci.cart_id = ${cartId}
    order by ci.added_at`;
  return rows.map((r) => {
    const pr = effectivePrice(r as never, { price_cents: r.v_price, promo_price_cents: r.v_promo }, Number(r.campaign_bps ?? 0));
    return {
      variantId: r.variant_id, productId: r.product_id, slug: r.slug, name: r.name, variantTitle: r.variant_title,
      sku: r.sku, image: r.v_image ?? r.image, quantity: r.quantity, stock: r.stock_quantity,
      unitPrice: pr.price, originalPrice: pr.original,
      available: r.status === "active" && r.v_active && r.stock_quantity >= r.quantity,
      shippingCost: r.v_ship ?? r.shipping_cost_cents ?? 0,
      supplierId: r.supplier_id,
    };
  });
}

export async function getCart(): Promise<CartView> {
  const id = await getCartId();
  if (!id) return { id: null, couponCode: null, email: null, lines: [], itemCount: 0, subtotal: 0 };
  const [c] = await db()<{ id: string; coupon_code: string | null; email: string | null }[]>`
    select id, coupon_code, email from public.carts where id = ${id} and status = 'open'`;
  if (!c) return { id: null, couponCode: null, email: null, lines: [], itemCount: 0, subtotal: 0 };
  const lines = await loadCartLines(c.id);
  return {
    id: c.id, couponCode: c.coupon_code, email: c.email, lines,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal: lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
  };
}

export class CartError extends Error {}

export async function addToCart(cartId: string, variantId: string, quantity: number) {
  if (!UUID.test(variantId)) throw new CartError("Produto inválido.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new CartError("Quantidade inválida.");
  const sql = db();
  const [v] = await sql<{ stock_quantity: number; ok: boolean }[]>`
    select v.stock_quantity, (v.is_active and p.status = 'active') as ok
    from public.product_variants v join public.products p on p.id = v.product_id where v.id = ${variantId}`;
  if (!v || !v.ok) throw new CartError("Produto indisponível.");
  const [cur] = await sql<{ quantity: number }[]>`select quantity from public.cart_items where cart_id = ${cartId} and variant_id = ${variantId}`;
  const next = Math.min((cur?.quantity ?? 0) + quantity, 99);
  if (next > v.stock_quantity) throw new CartError(v.stock_quantity > 0 ? `Apenas ${v.stock_quantity} unidade(s) disponível(is).` : "Produto sem estoque no momento.");
  await sql`
    insert into public.cart_items (cart_id, variant_id, quantity) values (${cartId}, ${variantId}, ${next})
    on conflict (cart_id, variant_id) do update set quantity = excluded.quantity`;
  await sql`update public.carts set updated_at = now() where id = ${cartId}`;
}

export async function setCartQuantity(cartId: string, variantId: string, quantity: number) {
  const sql = db();
  if (quantity <= 0) {
    await sql`delete from public.cart_items where cart_id = ${cartId} and variant_id = ${variantId}`;
  } else {
    if (quantity > 99) throw new CartError("Quantidade máxima por item: 99.");
    const [v] = await sql<{ stock_quantity: number }[]>`select stock_quantity from public.product_variants where id = ${variantId}`;
    if (!v) throw new CartError("Produto inválido.");
    if (quantity > v.stock_quantity) throw new CartError(`Apenas ${v.stock_quantity} unidade(s) disponível(is).`);
    await sql`update public.cart_items set quantity = ${quantity} where cart_id = ${cartId} and variant_id = ${variantId}`;
  }
  await sql`update public.carts set updated_at = now() where id = ${cartId}`;
}
