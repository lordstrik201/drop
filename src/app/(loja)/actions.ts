"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { addToCart, CartError, ensureCart, getCartId, loadCartLines, setCartQuantity } from "@/lib/cart/cart";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { quoteShipping, type ShippingOption } from "@/lib/shipping/quote";
import { createOrderFromCart, CheckoutError } from "@/lib/orders/create";
import { startCheckoutPayment, PaymentNotConfiguredError } from "@/lib/payments/service";
import { RateLimitError, enforceRateLimit } from "@/lib/security/rate-limit";
import { onlyDigits } from "@/lib/validation/br";
import { enqueueJob } from "@/lib/jobs/queue";
import { log } from "@/lib/logger";
import { melhorEnvioQuote } from "@/lib/integrations/shipping/melhorenvio";

export type ActionState = { ok: boolean; message?: string; errors?: Record<string, string> } | null;

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "local").split(",")[0].trim();
}

export async function addToCartAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await enforceRateLimit(`cart:${await clientIp()}`, 60, 60);
    const user = await getSessionUser();
    const cartId = await ensureCart(user?.id ?? null);
    await addToCart(cartId, String(form.get("variantId") ?? ""), Number(form.get("quantity") ?? 1));
    revalidatePath("/", "layout");
    if (form.get("buyNow") === "1") redirect("/carrinho");
    return { ok: true, message: "Produto adicionado ao carrinho." };
  } catch (e) {
    if (e instanceof CartError || e instanceof RateLimitError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function updateCartItemAction(form: FormData) {
  const cartId = await getCartId();
  if (!cartId) return;
  try {
    await setCartQuantity(cartId, String(form.get("variantId")), Number(form.get("quantity")));
  } catch (e) {
    if (!(e instanceof CartError)) throw e;
    redirect(`/carrinho?erro=${encodeURIComponent(e.message)}`);
  }
  revalidatePath("/carrinho");
}

export async function applyCouponAction(_: ActionState, form: FormData): Promise<ActionState> {
  await enforceRateLimit(`coupon:${await clientIp()}`, 20, 300).catch((e) => { throw e; });
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  const cartId = await getCartId();
  if (!cartId) return { ok: false, message: "Carrinho vazio." };
  if (!code) {
    await db()`update public.carts set coupon_code = null where id = ${cartId}`;
    revalidatePath("/carrinho");
    return { ok: true, message: "Cupom removido." };
  }
  const [c] = await db()<{ code: string; is_active: boolean; ends_at: Date | null; starts_at: Date | null; min_subtotal_cents: number; max_uses: number | null; used_count: number }[]>`
    select code, is_active, ends_at, starts_at, min_subtotal_cents, max_uses, used_count from public.coupons where code = ${code}`;
  const now = new Date();
  if (!c || !c.is_active || (c.ends_at && c.ends_at <= now) || (c.starts_at && c.starts_at > now) || (c.max_uses != null && c.used_count >= c.max_uses)) {
    return { ok: false, message: "Cupom inválido ou expirado." };
  }
  const lines = await loadCartLines(cartId);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  if (subtotal < c.min_subtotal_cents) return { ok: false, message: "O carrinho não atinge o valor mínimo deste cupom." };
  await db()`update public.carts set coupon_code = ${c.code} where id = ${cartId}`;
  revalidatePath("/carrinho");
  return { ok: true, message: `Cupom ${c.code} aplicado. Regras de primeira compra e limite por cliente são confirmadas no pagamento.` };
}

export async function quoteShippingAction(cepRaw: string, productVariant?: { productId: string; variantId: string; quantity: number }): Promise<{ ok: boolean; options?: ShippingOption[]; message?: string }> {
  const cep = onlyDigits(cepRaw);
  if (cep.length !== 8) return { ok: false, message: "CEP inválido." };
  try {
    await enforceRateLimit(`ship:${await clientIp()}`, 40, 60);
    let lines;
    if (productVariant) {
      const [v] = await db()`select v.id, v.product_id, coalesce(v.shipping_cost_cents, p.shipping_cost_cents) as ship,
                                    coalesce(v.price_cents, p.price_cents) as price, p.supplier_id
                             from public.product_variants v join public.products p on p.id = v.product_id
                             where v.id = ${productVariant.variantId} and p.status = 'active'`;
      if (!v) return { ok: false, message: "Produto indisponível." };
      lines = [{ productId: v.product_id, variantId: v.id, quantity: Math.min(Math.max(productVariant.quantity, 1), 99), unitPrice: v.price, shippingCost: v.ship, supplierId: v.supplier_id }];
    } else {
      const cartId = await getCartId();
      if (!cartId) return { ok: false, message: "Carrinho vazio." };
      lines = (await loadCartLines(cartId)).map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice, shippingCost: l.shippingCost, supplierId: l.supplierId }));
    }
    return { ok: true, options: await quoteShipping(lines, cep, db(), melhorEnvioQuote) };
  } catch (e) {
    await log("warn", "shipping", "Falha na cotação de frete", { error: (e as Error).message });
    return { ok: false, message: e instanceof RateLimitError ? e.message : "Não foi possível calcular o frete agora. Tente novamente." };
  }
}

const placeSchema = z.object({ payload: z.string().max(20000) });

export async function placeOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = placeSchema.safeParse({ payload: form.get("payload") });
  if (!parsed.success) return { ok: false, message: "Dados inválidos." };
  let orderId: string;
  try {
    await enforceRateLimit(`checkout:${await clientIp()}`, 10, 600);
    const user = await getSessionUser();
    const cartId = await getCartId();
    if (!cartId) return { ok: false, message: "Seu carrinho está vazio." };
    const data = JSON.parse(parsed.data.payload);
    const order = await createOrderFromCart(cartId, user?.id ?? null, data, { melhorEnvio: melhorEnvioQuote });
    orderId = order.id;
    if (!order.alreadyExisted) await enqueueJob(db(), "notify.order", { orderId: order.id, template: "order_created" }, `notify:order_created:${order.id}`);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const errors: Record<string, string> = {};
      for (const i of e.issues) errors[i.path.join(".")] = i.message;
      return { ok: false, message: "Revise os campos destacados.", errors };
    }
    if (e instanceof CheckoutError || e instanceof RateLimitError) return { ok: false, message: e.message };
    await log("error", "checkout", "Erro ao criar pedido", { error: (e as Error).message });
    return { ok: false, message: "Não foi possível finalizar o pedido. Nenhuma cobrança foi feita. Tente novamente." };
  }
  let redirectUrl: string;
  try {
    redirectUrl = (await startCheckoutPayment(orderId)).redirectUrl;
  } catch (e) {
    await log("error", "checkout", "Falha ao iniciar pagamento", { orderId, error: (e as Error).message });
    const reason = e instanceof PaymentNotConfiguredError ? "config" : "gateway";
    redirect(`/checkout/retorno?pedido=${orderId}&falha=${reason}`);
  }
  redirect(redirectUrl);
}

export async function retryPaymentAction(form: FormData) {
  const orderId = String(form.get("orderId") ?? "");
  const user = await getSessionUser();
  const [o] = await db()<{ id: string; profile_id: string | null; status: string }[]>`select id, profile_id, status from public.orders where id = ${orderId}`;
  if (!o || o.status !== "pending_payment" || (o.profile_id && o.profile_id !== user?.id)) redirect("/");
  let url: string;
  try {
    url = (await startCheckoutPayment(o.id)).redirectUrl;
  } catch {
    redirect(`/checkout/retorno?pedido=${o.id}&falha=gateway`);
  }
  redirect(url);
}

const contactSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120),
  email: z.string().trim().email("E-mail inválido").max(200),
  phone: z.string().trim().max(30).optional(),
  orderNumber: z.string().trim().regex(/^\d*$/, "Número inválido").max(12).optional(),
  subject: z.string().trim().min(3, "Informe o assunto").max(150),
  message: z.string().trim().min(10, "Escreva ao menos 10 caracteres").max(5000),
  website: z.string().max(0).optional(), // honeypot anti-spam
});

export async function contactAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = contactSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] = i.message;
    return { ok: false, message: "Revise os campos.", errors };
  }
  try {
    await enforceRateLimit(`contact:${await clientIp()}`, 5, 3600);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const d = parsed.data;
  const user = await getSessionUser();
  await db()`insert into public.contact_messages (profile_id, name, email, phone, order_number, subject, message)
             values (${user?.id ?? null}, ${d.name}, ${d.email.toLowerCase()}, ${d.phone || null}, ${d.orderNumber ? Number(d.orderNumber) : null}, ${d.subject}, ${d.message})`;
  return { ok: true, message: "Mensagem enviada! Responderemos pelo e-mail informado." };
}

const reviewSchema = z.object({
  productId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, "Escreva ao menos 10 caracteres").max(4000),
});

export async function reviewAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Entre na sua conta para avaliar." };
  const parsed = reviewSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const d = parsed.data;
  const [purchase] = await db()<{ order_id: string }[]>`
    select o.id as order_id from public.orders o join public.order_items i on i.order_id = o.id
    where o.profile_id = ${user.id} and i.product_id = ${d.productId} and o.status = 'delivered' limit 1`;
  if (!purchase) return { ok: false, message: "Só é possível avaliar produtos de pedidos entregues." };
  await db()`insert into public.reviews (product_id, profile_id, order_id, author_name, rating, title, body, verified_purchase)
             values (${d.productId}, ${user.id}, ${purchase.order_id}, ${(user.fullName ?? "Cliente").split(" ")[0]}, ${d.rating}, ${d.title || null}, ${d.body}, true)
             on conflict (product_id, profile_id) where profile_id is not null do update set rating = excluded.rating, title = excluded.title, body = excluded.body, status = 'pending'`;
  return { ok: true, message: "Obrigado! Sua avaliação será publicada após moderação." };
}

export async function trackOrderAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await enforceRateLimit(`track:${await clientIp()}`, 15, 600);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const number = Number(onlyDigits(String(form.get("number") ?? "")));
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const [o] = await db()<{ id: string }[]>`select id from public.orders where number = ${number} and lower(customer_email) = ${email}`;
  if (!o) return { ok: false, message: "Pedido não encontrado. Confira o número e o e-mail usados na compra." };
  const { signOrderAccess } = await import("@/lib/orders/access");
  redirect(`/rastreio/${o.id}?t=${signOrderAccess(o.id)}`);
}
