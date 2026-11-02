import { db } from "@/lib/db/client";
import { hmacSha256Hex } from "@/lib/security/crypto";
import type { MpPayment } from "@/lib/integrations/payments/mercadopago";

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;

export async function makeSupplier(over: Partial<{ requires_manual_approval: boolean; integration_type: string }> = {}) {
  const [s] = await db()`insert into public.suppliers (name, integration_type, requires_manual_approval)
    values (${"Fornecedor " + uid()}, ${over.integration_type ?? "manual"}, ${over.requires_manual_approval ?? true}) returning id`;
  return s.id as string;
}

export async function makeProduct(opts: { supplierId: string; price?: number; cost?: number; ship?: number; stock?: number }) {
  const id = uid();
  const [p] = await db()`insert into public.products (name, slug, sku, status, supplier_id, price_cents, cost_cents, shipping_cost_cents, supplier_product_ref)
    values (${"Produto " + id}, ${"produto-" + id}, ${"SKU-" + id}, 'active', ${opts.supplierId}, ${opts.price ?? 10000}, ${opts.cost ?? 4000}, ${opts.ship ?? 1500}, ${"EXT-" + id}) returning id`;
  const [v] = await db()`insert into public.product_variants (product_id, sku, title, stock_quantity) values (${p.id}, ${"SKU-" + id + "-V"}, 'Padrão', ${opts.stock ?? 10}) returning id`;
  return { productId: p.id as string, variantId: v.id as string };
}

export async function makeCart() {
  const [c] = await db()`insert into public.carts default values returning id`;
  return c.id as string;
}

export const validCheckout = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: `idem-${uid()}-xxxxxxxxxxxx`,
  name: "Maria da Silva",
  email: `maria.${uid()}@example.com`,
  phone: "(11) 98765-4321",
  cpf: "529.982.247-25",
  address: { recipient_name: "Maria da Silva", cep: "01310-100", street: "Av. Paulista", number: "1000", complement: "", district: "Bela Vista", city: "São Paulo", state: "SP" },
  shippingOptionId: "product",
  ...over,
});

export function mpPayment(over: Partial<MpPayment> & { external_reference: string; transaction_amount: number }): MpPayment {
  return {
    id: 1000000 + Math.floor(Math.random() * 1e6),
    status: "approved",
    status_detail: "accredited",
    currency_id: "BRL",
    payment_type_id: "bank_transfer",
    payment_method_id: "pix",
    installments: 1,
    date_approved: new Date().toISOString(),
    money_release_date: new Date(Date.now() + 86400000).toISOString(),
    live_mode: false,
    fee_details: [{ type: "mercadopago_fee", amount: 0.99, fee_payer: "collector" }],
    transaction_details: { net_received_amount: over.transaction_amount - 0.99 },
    transaction_amount_refunded: 0,
    refunds: [],
    ...over,
  };
}

/** fetch falso que responde como a API do Mercado Pago. */
export function fakeMpFetch(payments: Map<string, MpPayment>, calls: { method: string; url: string; body?: string; headers?: Record<string, string> }[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body as string, headers: init?.headers as Record<string, string> });
    const m = url.match(/\/v1\/payments\/(\d+)(\/refunds)?$/);
    if (m && method === "GET") {
      const p = payments.get(m[1]);
      return new Response(JSON.stringify(p ?? { message: "not found" }), { status: p ? 200 : 404 });
    }
    if (m && m[2] && method === "POST") {
      const p = payments.get(m[1])!;
      const body = JSON.parse((init?.body as string) || "{}");
      const amount = body.amount ?? p.transaction_amount - (p.transaction_amount_refunded ?? 0);
      const refund = { id: 900000 + (p.refunds?.length ?? 0), amount, date_created: new Date().toISOString(), status: "approved" };
      p.refunds = [...(p.refunds ?? []), refund];
      p.transaction_amount_refunded = Math.round(((p.transaction_amount_refunded ?? 0) + amount) * 100) / 100;
      if (p.transaction_amount_refunded >= p.transaction_amount) p.status = "refunded";
      return new Response(JSON.stringify({ id: refund.id, payment_id: p.id, amount, status: "approved" }), { status: 201 });
    }
    if (url.endsWith("/checkout/preferences") && method === "POST") {
      return new Response(JSON.stringify({ id: `pref-${uid()}`, init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=x" }), { status: 201 });
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
}

export function signedWebhook(secret: string, paymentId: string | number, opts: { badSig?: boolean; requestId?: string } = {}) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const requestId = opts.requestId ?? `req-${uid()}`;
  const manifest = `id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = opts.badSig ? "0".repeat(64) : hmacSha256Hex(secret, manifest);
  return new Request(`https://loja.test/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${v1}` },
    body: JSON.stringify({ action: "payment.updated", api_version: "v1", data: { id: String(paymentId) }, type: "payment", live_mode: false }),
  });
}
