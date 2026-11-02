import { db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getCredentials, missingFields, markIntegration } from "@/lib/integrations/credentials";
import * as mp from "@/lib/integrations/payments/mercadopago";
import { applyPaymentSnapshot } from "./apply";
import { readSetting } from "@/lib/settings";
import { log } from "@/lib/logger";
import { randomToken } from "@/lib/security/crypto";

export class PaymentNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Mercado Pago não configurado. Falta: ${missing.join(", ")} (Painel → Integrações → Mercado Pago).`);
  }
}

export async function mercadoPagoCreds() {
  const c = await getCredentials("mercadopago");
  const missing = missingFields("mercadopago", c);
  if (missing.length) throw new PaymentNotConfiguredError(missing);
  return c as { accessToken: string; webhookSecret: string; publicKey?: string };
}

/** O ambiente deve usar credenciais do modo correspondente (produção x teste). */
export function expectedLiveMode(): boolean | null {
  const e = env().APP_ENV;
  if (e === "production") return true;
  if (e === "staging") return false;
  return null;
}

/**
 * Inicia o pagamento: cria (ou reaproveita) a preferência do Checkout Pro e
 * devolve a URL oficial de pagamento do Mercado Pago.
 */
export async function startCheckoutPayment(orderId: string, f: mp.FetchLike = fetch): Promise<{ redirectUrl: string }> {
  const creds = await mercadoPagoCreds();
  const sql = db();
  const [o] = await sql`select * from public.orders where id = ${orderId}`;
  if (!o) throw new Error("Pedido não encontrado");
  if (o.status !== "pending_payment") throw new Error("Este pedido não está aguardando pagamento.");

  const [existing] = await sql<{ id: string; raw: { init_point?: string } | null; created_at: Date }[]>`
    select id, raw, created_at from public.payments
    where order_id = ${orderId} and provider = 'mercadopago' and provider_payment_id is null and provider_preference_id is not null
    order by created_at desc limit 1`;
  if (existing?.raw?.init_point && Date.now() - existing.created_at.getTime() < 6 * 3600_000) {
    return { redirectUrl: existing.raw.init_point };
  }

  const items = await sql<{ id: string; product_name: string; variant_title: string | null; quantity: number; unit_price_cents: number; image_url: string | null }[]>`
    select id, product_name, variant_title, quantity, unit_price_cents, image_url from public.order_items where order_id = ${orderId}`;
  const checkout = await readSetting("checkout");
  const identity = await readSetting("store.identity");
  const payCfg = await readSetting("payments");
  const pref = await mp.createPreference(creds.accessToken, {
    orderId,
    orderNumber: Number(o.number),
    items: items.map((i) => ({ id: i.id, title: i.variant_title && i.variant_title !== "Padrão" ? `${i.product_name} (${i.variant_title})` : i.product_name, quantity: i.quantity, unitPriceCents: i.unit_price_cents, pictureUrl: i.image_url })),
    shippingCents: o.shipping_cents,
    discountCents: o.discount_cents,
    payer: { name: o.customer_name, email: o.customer_email, cpf: o.customer_cpf, phone: o.customer_phone },
    siteUrl: env().NEXT_PUBLIC_SITE_URL.replace(/\/$/, ""),
    expiresAt: new Date(new Date(o.created_at).getTime() + checkout.pending_payment_expiration_hours * 3600_000),
    statementDescriptor: identity.name.replace(/[^A-Za-z0-9 ]/g, "").toUpperCase(),
    paymentMethods: { excludedTypes: payCfg.excluded_payment_types, installments: payCfg.max_installments },
  }, f);
  await sql`insert into public.payments (order_id, provider, provider_preference_id, status, amount_cents, raw)
            values (${orderId}, 'mercadopago', ${pref.id}, 'pending', ${o.total_cents}, ${sql.json({ init_point: pref.init_point, sandbox_init_point: pref.sandbox_init_point ?? null } as never)})`;
  await markIntegration("mercadopago", true);
  return { redirectUrl: pref.init_point };
}

/** Consulta o pagamento na API oficial e aplica ao pedido (usado pelo webhook, pela fila e pelo painel). */
export async function syncMercadoPagoPayment(providerPaymentId: string, f: mp.FetchLike = fetch) {
  const creds = await mercadoPagoCreds();
  try {
    const p = await mp.getPayment(creds.accessToken, providerPaymentId, f);
    const snap = mp.mapPayment(p);
    const result = await applyPaymentSnapshot(snap, { expectLiveMode: expectedLiveMode() });
    await markIntegration("mercadopago", true);
    return result;
  } catch (e) {
    if (e instanceof mp.MercadoPagoError && e.status === 401) await markIntegration("mercadopago", false, "Credencial recusada (401)");
    throw e;
  }
}

export class RefundError extends Error {}

/**
 * Solicita reembolso (total ou parcial). Grava a solicitação com chave de
 * idempotência ANTES de chamar o gateway: se a chamada for repetida, o Mercado
 * Pago recebe a mesma X-Idempotency-Key e não estorna duas vezes.
 */
export async function requestRefund(
  orderId: string,
  amountCents: number | null,
  reason: string,
  actorId: string,
  f: mp.FetchLike = fetch,
  idempotencyKey = `refund:${orderId}:${randomToken(8)}`,
) {
  const sql = db();
  const [pay] = await sql<{ id: string; provider_payment_id: string; amount_cents: number; refunded_cents: number; status: string }[]>`
    select id, provider_payment_id, amount_cents, refunded_cents, status from public.payments
    where order_id = ${orderId} and provider = 'mercadopago' and status in ('approved', 'partially_refunded') order by created_at desc limit 1`;
  if (!pay) throw new RefundError("Não há pagamento aprovado para reembolsar neste pedido.");
  const [pendingRefunds] = await sql<{ total: number }[]>`
    select coalesce(sum(amount_cents), 0)::int as total from public.refunds where payment_id = ${pay.id} and status in ('requested', 'processing')`;
  const available = pay.amount_cents - pay.refunded_cents - pendingRefunds.total;
  const amount = amountCents ?? available;
  if (amount <= 0 || amount > available) throw new RefundError(`Valor de reembolso inválido. Disponível: ${(available / 100).toFixed(2)}`);

  const [refund] = await sql<{ id: string; status: string }[]>`
    insert into public.refunds (order_id, payment_id, amount_cents, reason, status, idempotency_key, requested_by)
    values (${orderId}, ${pay.id}, ${amount}, ${reason}, 'processing', ${idempotencyKey}, ${actorId})
    on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key returning id, status`;

  const creds = await mercadoPagoCreds();
  try {
    const full = amount === pay.amount_cents - pay.refunded_cents;
    const r = await mp.createRefund(creds.accessToken, pay.provider_payment_id, full ? null : amount, idempotencyKey, f);
    await sql`update public.refunds set provider_refund_id = ${String(r.id)} where id = ${refund.id}`;
    // Confirma o estado real consultando o pagamento (lança transações e razão)
    await syncMercadoPagoPayment(pay.provider_payment_id, f);
    await sql`update public.refunds set status = 'completed', completed_at = coalesce(completed_at, now()) where id = ${refund.id} and status = 'processing'`;
    return { refundId: refund.id, providerRefundId: String(r.id) };
  } catch (e) {
    const msg = (e as Error).message;
    const retryable = e instanceof mp.MercadoPagoError && e.retryable;
    await sql`update public.refunds set status = ${retryable ? "processing" : "failed"}, error = ${msg} where id = ${refund.id}`;
    await log("error", "payments", `Falha no reembolso do pedido ${orderId}`, { error: msg, retryable });
    throw new RefundError(retryable ? `Gateway indisponível; o reembolso ficou pendente e pode ser reexecutado. (${msg})` : msg);
  }
}
