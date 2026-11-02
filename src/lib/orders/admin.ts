import { db, type Tx } from "@/lib/db/client";
import { transitionOrder } from "./transition";
import { releaseOrderStock } from "./create";
import { enqueueJob } from "@/lib/jobs/queue";
import { cancelExpectedCosts } from "@/lib/finance/ledger";
import { canTransition, isPaidState } from "./status";
import type { OrderStatus, ShipmentStatus } from "@/lib/types";

/**
 * Cancela um pedido. Pedido pago exige reembolso: aqui só cancelamos pedidos
 * não pagos (ou com reembolso já concluído). O estoque reservado é devolvido.
 */
export async function cancelOrder(orderId: string, reason: string, actorId: string) {
  if (reason.trim().length < 3) throw new Error("Informe o motivo do cancelamento.");
  await db().begin(async (tx: Tx) => {
    const [o] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId} for update`;
    if (!o) throw new Error("Pedido não encontrado");
    if (isPaidState(o.status)) throw new Error("Pedido pago: faça o reembolso antes (ou use \"Cancelar e reembolsar\").");
    const [sent] = await tx<{ n: number }[]>`select count(*)::int as n from public.supplier_orders where order_id = ${orderId} and status in ('submitted','confirmed','processing','shipped')`;
    if (sent.n > 0) throw new Error("Pedido já foi enviado ao fornecedor. Cancele também junto ao fornecedor e registre a ocorrência.");
    await transitionOrder(tx, orderId, "canceled", "admin", { actorId, note: reason });
    await releaseOrderStock(tx, orderId, "canceled");
    await cancelExpectedCosts(tx, orderId);
    await tx`update public.supplier_orders set status = 'canceled' where order_id = ${orderId} and status in ('pending','awaiting_approval','failed')`;
    await enqueueJob(tx, "notify.order", { orderId, template: "order_canceled" }, `notify:order_canceled:${orderId}`);
  });
}

export async function setOrderStatus(orderId: string, to: OrderStatus, actorId: string, note: string | null) {
  await db().begin(async (tx: Tx) => {
    const [o] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId} for update`;
    if (!o) throw new Error("Pedido não encontrado");
    if (to === "paid" || to === "refunded") throw new Error("Pagamento e reembolso só mudam pela confirmação do gateway.");
    if (to === "awaiting_supplier" || to === "sent_to_supplier") {
      const [p] = await tx<{ n: number }[]>`select count(*)::int as n from public.payments where order_id = ${orderId} and status in ('approved','partially_refunded')`;
      if (p.n === 0) throw new Error("Sem pagamento aprovado: o pedido não pode seguir para o fornecedor.");
    }
    if (!canTransition(o.status, to)) throw new Error("Transição de status não permitida.");
    await transitionOrder(tx, orderId, to, "admin", { actorId, note });
    if (to === "delivered") await enqueueJob(tx, "notify.order", { orderId, template: "order_delivered" }, `notify:order_delivered:${orderId}`);
  });
}

export async function addInternalNote(orderId: string, note: string, actor: { id: string; email: string }) {
  const line = `[${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${actor.email}] ${note.trim()}`;
  await db()`update public.orders set internal_notes = trim(both E'\n' from coalesce(internal_notes, '') || E'\n' || ${line}) where id = ${orderId}`;
}

export type ShipmentInput = {
  supplierOrderId?: string | null;
  carrier: string;
  service?: string | null;
  trackingCode: string;
  trackingUrl?: string | null;
  confirmedEta?: string | null;
};

/** Registra rastreio (manual ou vindo do fornecedor) e marca o pedido como enviado. */
export async function addShipment(orderId: string, s: ShipmentInput, actorId: string | null, source: "admin" | "supplier" = "admin") {
  if (!s.trackingCode.trim() || s.trackingCode.length > 60) throw new Error("Código de rastreio inválido.");
  if (s.trackingUrl && !/^https:\/\//.test(s.trackingUrl)) throw new Error("O link de rastreio deve começar com https://");
  return db().begin(async (tx: Tx) => {
    const [o] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId} for update`;
    if (!o) throw new Error("Pedido não encontrado");
    if (!isPaidState(o.status)) throw new Error("Pedido não está pago.");
    const [sh] = await tx<{ id: string }[]>`
      insert into public.shipments (order_id, supplier_order_id, carrier, service, tracking_code, tracking_url, status, confirmed_eta, shipped_at)
      values (${orderId}, ${s.supplierOrderId ?? null}, ${s.carrier.trim()}, ${s.service ?? null}, ${s.trackingCode.trim().toUpperCase()}, ${s.trackingUrl ?? null}, 'posted', ${s.confirmedEta || null}, now())
      on conflict (carrier, tracking_code) where tracking_code is not null do update set tracking_url = coalesce(excluded.tracking_url, public.shipments.tracking_url)
      returning id`;
    if (s.supplierOrderId) await tx`update public.supplier_orders set status = 'shipped' where id = ${s.supplierOrderId} and status not in ('delivered')`;
    let cur = o.status;
    // pedido "aguardando fornecedor" que já recebeu rastreio passa por "enviado ao fornecedor"
    if (cur === "awaiting_supplier") {
      await transitionOrder(tx, orderId, "sent_to_supplier", source, { actorId });
      cur = "sent_to_supplier";
    }
    if (canTransition(cur, "shipped")) await transitionOrder(tx, orderId, "shipped", source, { actorId, note: `${s.carrier} ${s.trackingCode}` });
    await enqueueJob(tx, "notify.order", { orderId, template: "order_shipped" }, `notify:order_shipped:${orderId}`);
    return sh.id;
  });
}

const SHIP_TO_ORDER: Partial<Record<ShipmentStatus, OrderStatus>> = { in_transit: "in_transit", out_for_delivery: "in_transit", delivered: "delivered" };

/** Atualiza o status de um envio e propaga ao pedido quando todos os envios avançaram. */
export async function updateShipmentStatus(shipmentId: string, status: ShipmentStatus, event: { at: Date; description: string; location?: string | null } | null, source: "admin" | "tracking", actorId: string | null = null) {
  return db().begin(async (tx: Tx) => {
    const [sh] = await tx<{ order_id: string; status: ShipmentStatus }[]>`select order_id, status from public.shipments where id = ${shipmentId} for update`;
    if (!sh) throw new Error("Envio não encontrado");
    await tx`update public.shipments set status = ${status}, last_event_at = ${event?.at ?? new Date()}, last_checked_at = now(),
               delivered_at = case when ${status} = 'delivered' then coalesce(delivered_at, now()) else delivered_at end where id = ${shipmentId}`;
    if (event) {
      await tx`insert into public.tracking_events (shipment_id, occurred_at, status, description, location)
               values (${shipmentId}, ${event.at}, ${status}, ${event.description.slice(0, 500)}, ${event.location ?? null}) on conflict do nothing`;
    }
    const target = SHIP_TO_ORDER[status];
    if (!target) return;
    const all = await tx<{ status: ShipmentStatus }[]>`select status from public.shipments where order_id = ${sh.order_id}`;
    const everyDelivered = all.every((s) => s.status === "delivered");
    const [o] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${sh.order_id} for update`;
    if (target === "delivered" && everyDelivered && canTransition(o.status, "delivered")) {
      await transitionOrder(tx, sh.order_id, "delivered", source, { actorId });
      await tx`update public.supplier_orders set status = 'delivered' where order_id = ${sh.order_id}`;
      await enqueueJob(tx, "notify.order", { orderId: sh.order_id, template: "order_delivered" }, `notify:order_delivered:${sh.order_id}`);
    } else if (target === "in_transit" && canTransition(o.status, "in_transit")) {
      await transitionOrder(tx, sh.order_id, "in_transit", source, { actorId });
    }
  });
}

export async function requeueForward(supplierOrderId: string) {
  const sql = db();
  const [so] = await sql<{ status: string; order_id: string }[]>`select status, order_id from public.supplier_orders where id = ${supplierOrderId}`;
  if (!so) throw new Error("Pedido de fornecedor não encontrado");
  if (!["pending", "failed"].includes(so.status)) throw new Error("Só é possível reenviar pedidos pendentes ou com falha.");
  await sql`update public.supplier_orders set status = 'pending', last_error = null where id = ${supplierOrderId}`;
  const [job] = await sql<{ id: string }[]>`select id from public.jobs where idempotency_key = ${`forward:${supplierOrderId}`}`;
  if (job) await sql`update public.jobs set status = 'queued', run_at = now(), attempts = 0, finished_at = null where id = ${job.id}`;
  else await enqueueJob(sql, "supplier.forward", { supplierOrderId }, `forward:${supplierOrderId}`);
}
