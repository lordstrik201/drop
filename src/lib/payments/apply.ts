import { db, type Tx } from "@/lib/db/client";
import type { PaymentSnapshot } from "@/lib/integrations/payments/mercadopago";
import { postLedger, postSaleEntries, cancelExpectedCosts } from "@/lib/finance/ledger";
import { transitionOrder } from "@/lib/orders/transition";
import { enqueueJob } from "@/lib/jobs/queue";
import { log } from "@/lib/logger";
import type { OrderStatus, PaymentStatus } from "@/lib/types";

export type ApplyResult = {
  orderId: string;
  paymentId: string;
  orderStatus: OrderStatus;
  changed: boolean;
  flaggedForReview?: string;
};

/**
 * Aplica o estado OFICIAL de um pagamento (consultado na API do gateway, nunca
 * o corpo do webhook) ao pedido. Totalmente idempotente: pode ser chamado
 * quantas vezes for preciso com o mesmo pagamento.
 *
 * Regras:
 * - Só aprova o pedido se o valor pago for igual ao total do pedido, em BRL e
 *   no modo correto (produção x teste). Divergências vão para "Em análise".
 * - Pagamento aprovado para pedido cancelado/expirado → "Em análise" (o dinheiro
 *   entrou e alguém precisa decidir entre reativar ou estornar).
 * - Pedido nunca é encaminhado ao fornecedor sem pagamento aprovado.
 */
export async function applyPaymentSnapshot(snap: PaymentSnapshot, opts: { expectLiveMode?: boolean | null } = {}): Promise<ApplyResult> {
  if (!snap.orderId) throw new Error(`Pagamento ${snap.providerPaymentId} sem external_reference`);
  return db().begin(async (tx: Tx) => {
    const [order] = await tx<{ id: string; status: OrderStatus; total_cents: number; requires_manual_approval: boolean; number: string }[]>`
      select id, status, total_cents, requires_manual_approval, number from public.orders where id = ${snap.orderId} for update`;
    if (!order) throw new Error(`Pedido ${snap.orderId} não encontrado para o pagamento ${snap.providerPaymentId}`);

    const [prev] = await tx<{ id: string; status: PaymentStatus }[]>`
      select id, status from public.payments where provider = ${snap.provider} and provider_payment_id = ${snap.providerPaymentId} for update`;

    let paymentId: string;
    const values = {
      status: snap.status, statusDetail: snap.statusDetail, method: snap.method, amount: snap.amount, fee: snap.fee,
      net: snap.net, refunded: snap.refunded, installments: snap.installments, release: snap.releaseDate,
      approvedAt: snap.approvedAt, live: snap.liveMode,
    };
    if (prev) {
      paymentId = prev.id;
      await tx`update public.payments set status = ${values.status}, status_detail = ${values.statusDetail}, method = ${values.method},
                 amount_cents = ${values.amount}, fee_cents = ${values.fee}, net_cents = ${values.net}, refunded_cents = ${values.refunded},
                 installments = ${values.installments}, money_release_date = ${values.release}, approved_at = ${values.approvedAt},
                 live_mode = ${values.live}, raw = ${tx.json(snap.raw as never)}
               where id = ${paymentId}`;
    } else {
      // Reaproveita o registro "pendente" criado junto da preferência, se houver.
      const [pending] = await tx<{ id: string }[]>`
        select id from public.payments where order_id = ${order.id} and provider = ${snap.provider} and provider_payment_id is null
        order by created_at desc limit 1 for update`;
      if (pending) {
        paymentId = pending.id;
        await tx`update public.payments set provider_payment_id = ${snap.providerPaymentId}, status = ${values.status}, status_detail = ${values.statusDetail},
                   method = ${values.method}, amount_cents = ${values.amount}, fee_cents = ${values.fee}, net_cents = ${values.net},
                   refunded_cents = ${values.refunded}, installments = ${values.installments}, money_release_date = ${values.release},
                   approved_at = ${values.approvedAt}, live_mode = ${values.live}, raw = ${tx.json(snap.raw as never)}
                 where id = ${paymentId}`;
      } else {
        const [ins] = await tx<{ id: string }[]>`
          insert into public.payments (order_id, provider, provider_payment_id, status, status_detail, method, amount_cents, fee_cents, net_cents,
                                       refunded_cents, installments, money_release_date, approved_at, live_mode, raw)
          values (${order.id}, ${snap.provider}, ${snap.providerPaymentId}, ${values.status}, ${values.statusDetail}, ${values.method}, ${values.amount},
                  ${values.fee}, ${values.net}, ${values.refunded}, ${values.installments}, ${values.release}, ${values.approvedAt}, ${values.live},
                  ${tx.json(snap.raw as never)})
          returning id`;
        paymentId = ins.id;
      }
    }

    let changed = false;
    let flagged: string | undefined;
    const isApproved = snap.status === "approved" || snap.status === "partially_refunded";

    if (isApproved) {
      await tx`insert into public.transactions (payment_id, kind, amount_cents, provider_ref, occurred_at)
               values (${paymentId}, 'charge', ${snap.amount}, ${snap.providerPaymentId}, ${snap.approvedAt ?? new Date()})
               on conflict do nothing`;
      if (snap.fee) {
        await tx`insert into public.transactions (payment_id, kind, amount_cents, provider_ref, occurred_at)
                 values (${paymentId}, 'fee', ${-snap.fee}, ${snap.providerPaymentId}, ${snap.approvedAt ?? new Date()})
                 on conflict do nothing`;
      }

      const mismatch =
        snap.currency !== "BRL" ? `moeda ${snap.currency}`
        : snap.amount !== order.total_cents ? `valor pago ${snap.amount} ≠ total ${order.total_cents}`
        : opts.expectLiveMode != null && snap.liveMode != null && snap.liveMode !== opts.expectLiveMode ? `pagamento em modo ${snap.liveMode ? "produção" : "teste"} no ambiente errado`
        : null;

      if (order.status === "pending_payment") {
        if (mismatch) {
          changed = await transitionOrder(tx, order.id, "under_review", "webhook", { note: `Pagamento divergente: ${mismatch}` });
          flagged = mismatch;
        } else {
          changed = await transitionOrder(tx, order.id, "paid", "webhook", { note: `Pagamento ${snap.providerPaymentId} aprovado (${snap.method ?? "?"})` });
          await postSaleEntries(tx, order.id, { id: paymentId, fee: snap.fee, releaseDate: snap.releaseDate, approvedAt: snap.approvedAt ?? new Date() });
          await prepareFulfillment(tx, order.id, Number(order.number), order.requires_manual_approval);
          await tx`update public.products p set sold_count = sold_count + oi.quantity
                   from public.order_items oi where oi.order_id = ${order.id} and oi.product_id = p.id`;
          await enqueueJob(tx, "notify.order", { orderId: order.id, template: "payment_approved" }, `notify:payment_approved:${order.id}`);
        }
      } else if (order.status === "canceled") {
        changed = await transitionOrder(tx, order.id, "refunded", "webhook").catch(() => false);
        // canceled → refunded só faz sentido se houve estorno; aqui o dinheiro entrou: revisão manual.
        if (!changed) {
          flagged = "Pagamento aprovado para pedido cancelado";
        }
      }
    }

    // Estornos (total ou parcial) registrados no gateway
    for (const r of snap.refunds) {
      const [t] = await tx<{ id: string }[]>`
        insert into public.transactions (payment_id, kind, amount_cents, provider_ref, occurred_at)
        values (${paymentId}, 'refund', ${-r.amount}, ${r.id}, ${r.at}) on conflict do nothing returning id`;
      if (t) {
        await postLedger(tx, { kind: "refund", amount: r.amount, orderId: order.id, paymentId, dedupeKey: `refund:${snap.provider}:${r.id}`, occurredAt: r.at, description: "Reembolso ao cliente" });
        await tx`update public.refunds set status = 'completed', completed_at = coalesce(completed_at, now()), provider_refund_id = coalesce(provider_refund_id, ${r.id})
                 where payment_id = ${paymentId} and status in ('requested', 'processing') and amount_cents = ${r.amount}`;
      }
    }

    if (snap.status === "refunded") {
      const [cur] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${order.id}`;
      if (cur.status !== "refunded") {
        changed = (await transitionOrder(tx, order.id, "refunded", "webhook", { note: "Pagamento estornado integralmente" }).catch(() => false)) || changed;
        await cancelExpectedCosts(tx, order.id);
        await enqueueJob(tx, "notify.order", { orderId: order.id, template: "refund_completed" }, `notify:refund_completed:${order.id}`);
      }
    }

    if (snap.status === "charged_back") {
      await tx`insert into public.transactions (payment_id, kind, amount_cents, provider_ref)
               values (${paymentId}, 'chargeback', ${-snap.amount}, ${snap.providerPaymentId}) on conflict do nothing`;
      await postLedger(tx, { kind: "chargeback", amount: snap.amount, orderId: order.id, paymentId, dedupeKey: `chargeback:${snap.providerPaymentId}` });
      const [cur] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${order.id}`;
      if (cur.status !== "under_review" && cur.status !== "refunded") {
        changed = (await transitionOrder(tx, order.id, "under_review", "webhook", { note: "Contestação (chargeback) aberta" }).catch(() => false)) || changed;
      }
      flagged = "Chargeback";
    }

    if (flagged) {
      await tx`insert into public.app_logs (level, source, message, context)
               values ('warn', 'payments', ${`Pedido ${order.number}: ${flagged}`}, ${tx.json({ orderId: order.id, paymentId: snap.providerPaymentId } as never)})`;
    }

    const [final] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${order.id}`;
    return { orderId: order.id, paymentId, orderStatus: final.status, changed, flaggedForReview: flagged };
  }).then(async (r) => {
    if (r.flaggedForReview) await log("warn", "payments", `Pagamento sinalizado para revisão: ${r.flaggedForReview}`, { orderId: r.orderId });
    return r;
  });
}

/**
 * Após o pagamento: cria um pedido de fornecedor por fornecedor envolvido.
 * Sem aprovação manual, enfileira o encaminhamento automático; com aprovação
 * manual, fica aguardando a aprovação no painel.
 */
export async function prepareFulfillment(tx: Tx, orderId: string, orderNumber: number, requiresManual: boolean) {
  await transitionOrder(tx, orderId, "awaiting_supplier", "system", { note: requiresManual ? "Aguardando aprovação manual" : "Encaminhamento automático" });
  const groups = await tx<{ supplier_id: string | null; cost: number }[]>`
    select supplier_id, sum((unit_cost_cents + unit_shipping_cost_cents) * quantity)::int as cost
    from public.order_items where order_id = ${orderId} group by supplier_id`;
  for (const g of groups) {
    if (!g.supplier_id) {
      await tx`insert into public.app_logs (level, source, message, context)
               values ('warn', 'fulfillment', ${`Pedido ${orderNumber} tem itens sem fornecedor vinculado`}, ${tx.json({ orderId } as never)})`;
      continue;
    }
    const key = `so:${orderId}:${g.supplier_id}`;
    const [so] = await tx<{ id: string }[]>`
      insert into public.supplier_orders (order_id, supplier_id, status, idempotency_key, total_cost_cents)
      values (${orderId}, ${g.supplier_id}, ${requiresManual ? "awaiting_approval" : "pending"}, ${key}, ${g.cost})
      on conflict (order_id, supplier_id) do nothing returning id`;
    if (so && !requiresManual) {
      await enqueueJob(tx, "supplier.forward", { supplierOrderId: so.id }, `forward:${so.id}`);
    }
  }
}
