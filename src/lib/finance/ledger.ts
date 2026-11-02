import type { Tx } from "@/lib/db/client";

type Kind =
  | "sale_revenue" | "shipping_revenue" | "discount" | "product_cost" | "shipping_cost"
  | "gateway_fee" | "refund" | "chargeback" | "commission" | "other_income" | "other_expense";

export type LedgerEntry = {
  kind: Kind;
  amount: number;
  dedupeKey: string;
  orderId?: string | null;
  supplierId?: string | null;
  productId?: string | null;
  paymentId?: string | null;
  description?: string | null;
  occurredAt?: Date;
  availableAt?: Date | null;
  status?: "expected" | "realized" | "canceled";
};

const NEGATIVE: Kind[] = ["discount", "product_cost", "shipping_cost", "gateway_fee", "refund", "chargeback", "commission", "other_expense"];

/** Lança no razão financeiro. Idempotente pela dedupeKey. Sinal é imposto pelo tipo. */
export async function postLedger(tx: Tx, e: LedgerEntry) {
  const amount = NEGATIVE.includes(e.kind) ? -Math.abs(e.amount) : Math.abs(e.amount);
  if (amount === 0) return;
  await tx`
    insert into public.financial_entries (kind, amount_cents, order_id, supplier_id, product_id, payment_id, description, occurred_at, available_at, status, dedupe_key)
    values (${e.kind}, ${amount}, ${e.orderId ?? null}, ${e.supplierId ?? null}, ${e.productId ?? null}, ${e.paymentId ?? null},
            ${e.description ?? null}, ${e.occurredAt ?? new Date()}, ${e.availableAt ?? null}, ${e.status ?? "realized"}, ${e.dedupeKey})
    on conflict (dedupe_key) do update set
      amount_cents = excluded.amount_cents, status = excluded.status, available_at = excluded.available_at
      where public.financial_entries.status <> 'realized' or excluded.status = 'canceled'`;
}

/**
 * Lançamentos de uma venda aprovada: receita de produtos, frete cobrado,
 * descontos, taxa do gateway e custos previstos (fornecedor + frete), por item.
 */
export async function postSaleEntries(tx: Tx, orderId: string, payment: { id: string; fee: number; releaseDate: Date | null; approvedAt: Date }) {
  const [o] = await tx<{ shipping_cents: number; discount_cents: number }[]>`select shipping_cents, discount_cents from public.orders where id = ${orderId}`;
  const items = await tx<{ id: string; product_id: string | null; supplier_id: string | null; quantity: number; unit_price_cents: number; unit_cost_cents: number; unit_shipping_cost_cents: number; discount_cents: number }[]>`
    select id, product_id, supplier_id, quantity, unit_price_cents, unit_cost_cents, unit_shipping_cost_cents, discount_cents
    from public.order_items where order_id = ${orderId}`;
  const at = payment.approvedAt;
  for (const it of items) {
    await postLedger(tx, { kind: "sale_revenue", amount: it.unit_price_cents * it.quantity, orderId, productId: it.product_id, supplierId: it.supplier_id, paymentId: payment.id, dedupeKey: `sale:${it.id}`, occurredAt: at, availableAt: payment.releaseDate });
    if (it.discount_cents) await postLedger(tx, { kind: "discount", amount: it.discount_cents, orderId, productId: it.product_id, supplierId: it.supplier_id, dedupeKey: `discount:${it.id}`, occurredAt: at });
    await postLedger(tx, { kind: "product_cost", amount: it.unit_cost_cents * it.quantity, orderId, productId: it.product_id, supplierId: it.supplier_id, dedupeKey: `cost:${it.id}`, occurredAt: at, status: "expected", description: "Custo do fornecedor (previsto até o encaminhamento)" });
    if (it.unit_shipping_cost_cents) await postLedger(tx, { kind: "shipping_cost", amount: it.unit_shipping_cost_cents * it.quantity, orderId, productId: it.product_id, supplierId: it.supplier_id, dedupeKey: `shipcost:${it.id}`, occurredAt: at, status: "expected" });
  }
  if (o.shipping_cents) await postLedger(tx, { kind: "shipping_revenue", amount: o.shipping_cents, orderId, paymentId: payment.id, dedupeKey: `shiprev:${orderId}`, occurredAt: at, availableAt: payment.releaseDate });
  if (payment.fee) await postLedger(tx, { kind: "gateway_fee", amount: payment.fee, orderId, paymentId: payment.id, dedupeKey: `fee:${payment.id}`, occurredAt: at, availableAt: payment.releaseDate });
}

/** Converte custos previstos em realizados quando o pedido é efetivamente encaminhado. */
export async function realizeSupplierCosts(tx: Tx, orderId: string, supplierId: string) {
  await tx`update public.financial_entries set status = 'realized'
           where order_id = ${orderId} and supplier_id = ${supplierId} and kind in ('product_cost', 'shipping_cost') and status = 'expected'`;
}

/** Cancela custos previstos (pedido cancelado antes de ir ao fornecedor). */
export async function cancelExpectedCosts(tx: Tx, orderId: string) {
  await tx`update public.financial_entries set status = 'canceled'
           where order_id = ${orderId} and kind in ('product_cost', 'shipping_cost') and status = 'expected'`;
}
