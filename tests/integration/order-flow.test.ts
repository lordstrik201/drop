import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/lib/db/client";
import { addToCart } from "@/lib/cart/cart";
import { createOrderFromCart, CheckoutError } from "@/lib/orders/create";
import { handleMercadoPagoWebhook } from "@/lib/payments/webhook";
import { requestRefund, startCheckoutPayment } from "@/lib/payments/service";
import { approveOrderForFulfillment, forwardSupplierOrder, markSupplierOrderSubmitted } from "@/lib/fulfillment/forward";
import { registerSupplierAdapter } from "@/lib/integrations/suppliers/registry";
import { SupplierError } from "@/lib/integrations/suppliers/types";
import { runDueJobs, retryJob } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/handlers";
import { expireUnpaidOrders } from "@/lib/orders/maintenance";
import type { MpPayment } from "@/lib/integrations/payments/mercadopago";
import { fakeMpFetch, makeCart, makeProduct, makeSupplier, mpPayment, signedWebhook, validCheckout } from "../helpers";

const SECRET = "webhook-secret-test";
const payments = new Map<string, MpPayment>();
const calls: { method: string; url: string; body?: string; headers?: Record<string, string> }[] = [];
const f = fakeMpFetch(payments, calls);

beforeAll(() => {
  process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-test-token";
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
});
afterAll(closeDb);

async function orderWithItem(opts: { manual?: boolean; qty?: number; stock?: number } = {}) {
  const supplierId = await makeSupplier({ requires_manual_approval: opts.manual ?? true });
  const { variantId, productId } = await makeProduct({ supplierId, stock: opts.stock ?? 10 });
  const cartId = await makeCart();
  await addToCart(cartId, variantId, opts.qty ?? 2);
  const order = await createOrderFromCart(cartId, null, validCheckout());
  return { order, supplierId, variantId, productId, cartId };
}

describe("checkout", () => {
  it("cria pedido com snapshot de preço/custo, reserva estoque e é idempotente", async () => {
    const supplierId = await makeSupplier();
    const { variantId } = await makeProduct({ supplierId, price: 12990, cost: 5000, ship: 1200, stock: 5 });
    const cartId = await makeCart();
    await addToCart(cartId, variantId, 2);
    const input = validCheckout();
    const o1 = await createOrderFromCart(cartId, null, input);
    expect(o1.total).toBe(12990 * 2 + 1200 * 2);
    const o2 = await createOrderFromCart(cartId, null, input);
    expect(o2).toMatchObject({ id: o1.id, alreadyExisted: true });
    const [item] = await db()`select unit_price_cents, unit_cost_cents, unit_shipping_cost_cents, quantity from public.order_items where order_id = ${o1.id}`;
    expect(item).toMatchObject({ unit_price_cents: 12990, unit_cost_cents: 5000, unit_shipping_cost_cents: 1200, quantity: 2 });
    const [v] = await db()`select stock_quantity from public.product_variants where id = ${variantId}`;
    expect(v.stock_quantity).toBe(3);
    // alterar o preço depois não altera o pedido
    await db()`update public.products set price_cents = 1 where id = (select product_id from public.product_variants where id = ${variantId})`;
    const [again] = await db()`select unit_price_cents from public.order_items where order_id = ${o1.id}`;
    expect(again.unit_price_cents).toBe(12990);
  });

  it("recusa estoque insuficiente e CPF inválido", async () => {
    const supplierId = await makeSupplier();
    const { variantId } = await makeProduct({ supplierId, stock: 1 });
    const cartId = await makeCart();
    await expect(addToCart(cartId, variantId, 2)).rejects.toThrow(/disponível/);
    await addToCart(cartId, variantId, 1);
    await db()`update public.product_variants set stock_quantity = 0 where id = ${variantId}`;
    await expect(createOrderFromCart(cartId, null, validCheckout())).rejects.toBeInstanceOf(CheckoutError);
    await db()`update public.product_variants set stock_quantity = 1 where id = ${variantId}`;
    await expect(createOrderFromCart(cartId, null, validCheckout({ cpf: "111.111.111-11" }))).rejects.toThrow(/CPF/);
  });

  it("aplica cupom e respeita limite de usos", async () => {
    await db()`insert into public.coupons (code, kind, value, max_uses) values ('DEZ', 'percent', 1000, 1)`;
    const supplierId = await makeSupplier();
    const { variantId } = await makeProduct({ supplierId, price: 10000, ship: 0 });
    const c1 = await makeCart();
    await addToCart(c1, variantId, 1);
    await db()`update public.carts set coupon_code = 'DEZ' where id = ${c1}`;
    const o = await createOrderFromCart(c1, null, validCheckout());
    expect(o.total).toBe(9000);
    const c2 = await makeCart();
    await addToCart(c2, variantId, 1);
    await db()`update public.carts set coupon_code = 'DEZ' where id = ${c2}`;
    await expect(createOrderFromCart(c2, null, validCheckout())).rejects.toThrow(/esgotado/);
  });
});

describe("pagamento via webhook", () => {
  it("cria preferência no Checkout Pro sem dados de cartão", async () => {
    const { order } = await orderWithItem();
    const r = await startCheckoutPayment(order.id, f);
    expect(r.redirectUrl).toContain("mercadopago.com.br");
    const pref = calls.find((c) => c.url.endsWith("/checkout/preferences"))!;
    const body = JSON.parse(pref.body!);
    expect(body.external_reference).toBe(order.id);
    expect(body.notification_url).toMatch(/\/api\/webhooks\/mercadopago$/);
    const sum = body.items.reduce((s: number, i: { unit_price: number; quantity: number }) => s + i.unit_price * i.quantity, 0) + (body.shipments?.cost ?? 0);
    expect(Math.round(sum * 100)).toBe(order.total);
  });

  it("rejeita assinatura inválida e não altera o pedido", async () => {
    const { order } = await orderWithItem();
    const p = mpPayment({ external_reference: order.id, transaction_amount: order.total / 100 });
    payments.set(String(p.id), p);
    const r = await handleMercadoPagoWebhook(signedWebhook(SECRET, p.id, { badSig: true }), f);
    expect(r.status).toBe(401);
    const [o] = await db()`select status from public.orders where id = ${order.id}`;
    expect(o.status).toBe("pending_payment");
  });

  it("aprova, lança financeiro, prepara fornecedor e ignora duplicatas", async () => {
    const { order } = await orderWithItem({ manual: true });
    const p = mpPayment({ external_reference: order.id, transaction_amount: order.total / 100 });
    payments.set(String(p.id), p);
    const req = signedWebhook(SECRET, p.id, { requestId: `fixed-${p.id}` });
    const r1 = await handleMercadoPagoWebhook(req.clone(), f);
    expect(r1).toMatchObject({ status: 200, body: { orderStatus: "awaiting_supplier" } });
    const r2 = await handleMercadoPagoWebhook(req.clone(), f);
    expect(r2.body.duplicate).toBe(true);
    // notificação diferente para o mesmo pagamento também é idempotente
    await handleMercadoPagoWebhook(signedWebhook(SECRET, p.id), f);

    const hist = await db()`select to_status from public.order_status_history where order_id = ${order.id} order by id`;
    expect(hist.map((h) => h.to_status)).toEqual(["pending_payment", "paid", "awaiting_supplier"]);
    const ledger = await db()`select kind, amount_cents, status from public.financial_entries where order_id = ${order.id} order by kind`;
    const byKind = Object.fromEntries(ledger.map((l) => [l.kind, l]));
    expect(byKind.sale_revenue.amount_cents).toBe(20000);
    expect(byKind.shipping_revenue.amount_cents).toBe(3000);
    expect(byKind.gateway_fee.amount_cents).toBe(-99);
    expect(byKind.product_cost).toMatchObject({ amount_cents: -8000, status: "expected" });
    const [so] = await db()`select status from public.supplier_orders where order_id = ${order.id}`;
    expect(so.status).toBe("awaiting_approval");
    const [pay] = await db()`select count(*)::int as n from public.payments where order_id = ${order.id} and provider_payment_id = ${String(p.id)}`;
    expect(pay.n).toBe(1);
  });

  it("valor divergente vai para Em análise e não chega ao fornecedor", async () => {
    const { order } = await orderWithItem({ manual: false });
    const p = mpPayment({ external_reference: order.id, transaction_amount: 1 });
    payments.set(String(p.id), p);
    const r = await handleMercadoPagoWebhook(signedWebhook(SECRET, p.id), f);
    expect(r.body.orderStatus).toBe("under_review");
    const so = await db()`select id from public.supplier_orders where order_id = ${order.id}`;
    expect(so.length).toBe(0);
  });

  it("pagamento recusado mantém aguardando pagamento", async () => {
    const { order } = await orderWithItem();
    const p = mpPayment({ external_reference: order.id, transaction_amount: order.total / 100, status: "rejected", status_detail: "cc_rejected_insufficient_amount" });
    payments.set(String(p.id), p);
    const r = await handleMercadoPagoWebhook(signedWebhook(SECRET, p.id), f);
    expect(r.body.orderStatus).toBe("pending_payment");
  });

  it("falha da API agenda reprocessamento sem perder o evento", async () => {
    const { order } = await orderWithItem();
    const missing = 424242;
    const r = await handleMercadoPagoWebhook(signedWebhook(SECRET, missing), f);
    expect(r.body.queued).toBe(true);
    const [job] = await db()`select status from public.jobs where type = 'payment.sync' and payload->>'providerPaymentId' = ${String(missing)}`;
    expect(job.status).toBe("queued");
    // o pagamento passa a existir; a fila processa e aprova
    payments.set(String(missing), mpPayment({ id: missing, external_reference: order.id, transaction_amount: order.total / 100 }));
    const { syncMercadoPagoPayment } = await import("@/lib/payments/service");
    await runDueJobs({ ...jobHandlers, "payment.sync": async (pl) => syncMercadoPagoPayment(String(pl.providerPaymentId), f) }, { types: ["payment.sync"] });
    const [o] = await db()`select status from public.orders where id = ${order.id}`;
    expect(o.status).toBe("awaiting_supplier");
  });
});

describe("encaminhamento ao fornecedor", () => {
  async function paidOrder(manual: boolean) {
    const ctx = await orderWithItem({ manual });
    const p = mpPayment({ external_reference: ctx.order.id, transaction_amount: ctx.order.total / 100 });
    payments.set(String(p.id), p);
    await handleMercadoPagoWebhook(signedWebhook(SECRET, p.id), f);
    return { ...ctx, paymentId: String(p.id) };
  }

  it("nunca encaminha pedido não pago", async () => {
    const { order, supplierId } = await orderWithItem({ manual: false });
    const [so] = await db()`insert into public.supplier_orders (order_id, supplier_id, idempotency_key) values (${order.id}, ${supplierId}, ${"x-" + order.id}) returning id`;
    await expect(forwardSupplierOrder(so.id)).rejects.toThrow(/não está pago/);
  });

  it("aprovação manual → envio via conector com tentativa automática após falha temporária", async () => {
    let attempts = 0;
    const seen: string[] = [];
    registerSupplierAdapter("api", {
      code: "api", label: "Teste",
      async createOrder(input) {
        attempts++;
        seen.push(input.idempotencyKey);
        if (attempts === 1) throw new SupplierError("timeout", true);
        return { kind: "submitted", externalOrderId: `EXT-${input.orderNumber}`, raw: { ok: true } };
      },
    });
    const { order, supplierId } = await paidOrder(true);
    await db()`update public.suppliers set integration_type = 'api' where id = ${supplierId}`;
    const [so] = await db()`select id from public.supplier_orders where order_id = ${order.id}`;
    await expect(forwardSupplierOrder(so.id)).rejects.toThrow(/aprovação/);
    await approveOrderForFulfillment(order.id, (await db()`insert into auth.users (email) values ('op@example.com') returning id`)[0].id);
    const run1 = await runDueJobs(jobHandlers, { types: ["supplier.forward"] });
    expect(run1.failed).toBe(1);
    await db()`update public.jobs set run_at = now() where type = 'supplier.forward' and status = 'failed'`;
    const run2 = await runDueJobs(jobHandlers, { types: ["supplier.forward"] });
    expect(run2.succeeded).toBe(1);
    expect(new Set(seen).size).toBe(1); // mesma chave de idempotência nas duas tentativas
    const [o] = await db()`select status from public.orders where id = ${order.id}`;
    expect(o.status).toBe("sent_to_supplier");
    // reexecutar não envia de novo
    expect(await forwardSupplierOrder(so.id)).toEqual({ status: "already_submitted" });
    expect(attempts).toBe(2);
    const costs = await db()`select status from public.financial_entries where order_id = ${order.id} and kind = 'product_cost'`;
    expect(costs.every((c) => c.status === "realized")).toBe(true);
  });

  it("fornecedor manual: registro do número do pedido pelo operador", async () => {
    const { order } = await paidOrder(true);
    const [so] = await db()`select id from public.supplier_orders where order_id = ${order.id}`;
    const [u] = await db()`insert into auth.users (email) values (${`op${Date.now()}@example.com`}) returning id`;
    await expect(markSupplierOrderSubmitted(so.id, "PED-123", u.id)).rejects.toThrow(/Aprove o encaminhamento/);
    await approveOrderForFulfillment(order.id, u.id);
    await markSupplierOrderSubmitted(so.id, "PED-123", u.id);
    const [o] = await db()`select status from public.orders where id = ${order.id}`;
    expect(o.status).toBe("sent_to_supplier");
    await expect(markSupplierOrderSubmitted(so.id, "PED-124", u.id)).rejects.toThrow(/já foi encaminhado/);
  });

  it("reembolso total com chave de idempotência e lançamento no financeiro", async () => {
    const { order, paymentId } = await paidOrder(true);
    const [u] = await db()`insert into auth.users (email) values (${`fin${Date.now()}@example.com`}) returning id`;
    await requestRefund(order.id, null, "Cliente desistiu", u.id, f, `refund-test-${order.id}`);
    const refundCall = calls.filter((c) => c.url.includes(`/v1/payments/${paymentId}/refunds`));
    expect(refundCall.length).toBe(1);
    expect(refundCall[0].headers?.["X-Idempotency-Key"]).toBe(`refund-test-${order.id}`);
    const [o] = await db()`select status from public.orders where id = ${order.id}`;
    expect(o.status).toBe("refunded");
    const [r] = await db()`select coalesce(sum(amount_cents),0)::int as total from public.financial_entries where order_id = ${order.id} and kind = 'refund'`;
    expect(r.total).toBe(-order.total);
    const costs = await db()`select status from public.financial_entries where order_id = ${order.id} and kind = 'product_cost'`;
    expect(costs.every((c) => c.status === "canceled")).toBe(true);
    await expect(requestRefund(order.id, null, "de novo", u.id, f)).rejects.toThrow(/Não há pagamento aprovado/);
  });
});

describe("manutenção", () => {
  it("expira pedidos não pagos e devolve estoque", async () => {
    const { order, variantId } = await orderWithItem({ qty: 3, stock: 5 });
    await db()`update public.orders set created_at = now() - interval '3 days' where id = ${order.id}`;
    const r = await expireUnpaidOrders();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    const [o] = await db()`select status from public.orders where id = ${order.id}`;
    expect(o.status).toBe("canceled");
    const [v] = await db()`select stock_quantity from public.product_variants where id = ${variantId}`;
    expect(v.stock_quantity).toBe(5);
  });

  it("tarefa definitivamente falha pode ser reexecutada pelo painel", async () => {
    const [j] = await db()`insert into public.jobs (type, idempotency_key, status, attempts) values ('desconhecida', ${"k" + Date.now()}, 'dead', 6) returning id`;
    expect(await retryJob(j.id)).toBe(true);
    const s = await runDueJobs(jobHandlers, { types: ["desconhecida"] });
    expect(s.dead).toBe(1);
  });
});
