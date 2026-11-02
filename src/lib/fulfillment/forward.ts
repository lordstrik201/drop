import { db, type Tx } from "@/lib/db/client";
import { getSupplierAdapter } from "@/lib/integrations/suppliers/registry";
import { SupplierError } from "@/lib/integrations/suppliers/types";
import { PermanentJobError } from "@/lib/jobs/queue";
import { transitionOrder } from "@/lib/orders/transition";
import { isPaidState } from "@/lib/orders/status";
import { realizeSupplierCosts } from "@/lib/finance/ledger";
import { enqueueJob } from "@/lib/jobs/queue";
import type { Address, OrderStatus } from "@/lib/types";

/**
 * Aprovação manual no painel: libera os pedidos de fornecedor aguardando aprovação.
 */
export async function approveOrderForFulfillment(orderId: string, actorId: string) {
  return db().begin(async (tx: Tx) => {
    const [o] = await tx<{ status: OrderStatus; number: string }[]>`select status, number from public.orders where id = ${orderId} for update`;
    if (!o) throw new Error("Pedido não encontrado");
    if (o.status !== "awaiting_supplier") throw new Error("Somente pedidos pagos aguardando fornecedor podem ser aprovados.");
    await tx`update public.orders set approved_for_fulfillment_at = now(), approved_for_fulfillment_by = ${actorId} where id = ${orderId}`;
    const sos = await tx<{ id: string }[]>`
      update public.supplier_orders set status = 'pending' where order_id = ${orderId} and status = 'awaiting_approval' returning id`;
    for (const so of sos) await enqueueJob(tx, "supplier.forward", { supplierOrderId: so.id }, `forward:${so.id}`);
    await tx`insert into public.order_status_history (order_id, from_status, to_status, source, actor_id, note)
             values (${orderId}, ${o.status}, ${o.status}, 'admin', ${actorId}, 'Encaminhamento ao fornecedor aprovado')`;
    return sos.length;
  });
}

/**
 * Encaminha um pedido de fornecedor. Idempotente e seguro para reexecução:
 * - recusa se o pedido não estiver pago;
 * - se já foi enviado (tem external_order_id), não envia de novo;
 * - marca "submitting" antes da chamada; uma falha transitória volta para
 *   "pending" e a fila tenta de novo com a mesma chave de idempotência.
 */
export async function forwardSupplierOrder(supplierOrderId: string) {
  const sql = db();
  const claim = await sql.begin(async (tx: Tx) => {
    const [so] = await tx`
      select so.*, o.status as order_status, o.number, o.customer_name, o.customer_email, o.customer_phone, o.customer_cpf,
             o.shipping_address, o.shipping_method, o.approved_for_fulfillment_at, o.requires_manual_approval,
             s.integration_type, s.integration_config, s.is_active as supplier_active, s.name as supplier_name
      from public.supplier_orders so
      join public.orders o on o.id = so.order_id
      join public.suppliers s on s.id = so.supplier_id
      where so.id = ${supplierOrderId} for update of so`;
    if (!so) throw new PermanentJobError("Pedido de fornecedor não encontrado");
    if (so.external_order_id || ["submitted", "confirmed", "processing", "shipped", "delivered"].includes(so.status)) return { skip: "already_submitted" as const };
    if (so.status === "canceled") return { skip: "canceled" as const };
    if (!isPaidState(so.order_status)) throw new PermanentJobError(`Pedido ${so.number} não está pago (${so.order_status}); encaminhamento bloqueado.`);
    if (so.order_status !== "awaiting_supplier" && so.order_status !== "sent_to_supplier") throw new PermanentJobError(`Pedido em estado ${so.order_status}`);
    if (so.requires_manual_approval && !so.approved_for_fulfillment_at) throw new PermanentJobError("Pedido exige aprovação manual antes do encaminhamento.");
    if (so.status === "awaiting_approval") throw new PermanentJobError("Pedido aguardando aprovação.");
    if (!so.supplier_active) throw new PermanentJobError(`Fornecedor ${so.supplier_name} está inativo.`);
    await tx`update public.supplier_orders set status = 'submitting', attempts = attempts + 1 where id = ${supplierOrderId}`;
    const items = await tx`
      select sku, supplier_product_ref, supplier_variant_ref, quantity, product_name from public.order_items
      where order_id = ${so.order_id} and supplier_id = ${so.supplier_id}`;
    return { so, items };
  });
  if ("skip" in claim) return { status: claim.skip };

  const { so, items } = claim;
  const adapter = getSupplierAdapter(so.integration_type);
  try {
    if (!adapter.createOrder) throw new PermanentJobError(`O conector ${adapter.label} não suporta envio de pedidos.`);
    const result = await adapter.createOrder({
      supplierOrderId,
      idempotencyKey: so.idempotency_key,
      orderNumber: Number(so.number),
      customer: { name: so.customer_name, email: so.customer_email, phone: so.customer_phone, cpf: so.customer_cpf },
      address: so.shipping_address as Address,
      items: items.map((i) => ({ sku: i.sku, supplierProductRef: i.supplier_product_ref, supplierVariantRef: i.supplier_variant_ref, quantity: i.quantity, name: i.product_name })),
      shippingMethod: so.shipping_method,
      config: so.integration_config ?? {},
    });
    await sql.begin(async (tx: Tx) => {
      if (result.kind === "submitted") {
        await tx`update public.supplier_orders set status = 'submitted', external_order_id = ${result.externalOrderId},
                   response_payload = ${tx.json((result.raw ?? null) as never)}, submitted_at = now(), last_error = null
                 where id = ${supplierOrderId}`;
        await realizeSupplierCosts(tx, so.order_id, so.supplier_id);
        const [pending] = await tx<{ n: number }[]>`
          select count(*)::int as n from public.supplier_orders where order_id = ${so.order_id} and status in ('pending', 'awaiting_approval', 'submitting', 'failed')`;
        if (pending.n === 0) await transitionOrder(tx, so.order_id, "sent_to_supplier", "job", { note: `Enviado a ${so.supplier_name} (#${result.externalOrderId})` });
      } else {
        // manual: volta para pendente e aparece na fila de encaminhamento manual
        await tx`update public.supplier_orders set status = 'pending', last_error = null,
                   response_payload = ${tx.json({ manual: true, instructions: result.instructions } as never)} where id = ${supplierOrderId}`;
      }
    });
    return { status: result.kind };
  } catch (e) {
    const retryable = e instanceof SupplierError ? e.retryable : !(e instanceof PermanentJobError);
    await sql`update public.supplier_orders set status = ${retryable ? "pending" : "failed"}, last_error = ${(e as Error).message.slice(0, 2000)} where id = ${supplierOrderId}`;
    if (!retryable && !(e instanceof PermanentJobError)) throw new PermanentJobError((e as Error).message);
    throw e;
  }
}

/** Registro manual do envio (fornecedor sem API): operador informa o nº do pedido no fornecedor. */
export async function markSupplierOrderSubmitted(supplierOrderId: string, externalOrderId: string, actorId: string) {
  return db().begin(async (tx: Tx) => {
    const [so] = await tx<{ order_id: string; supplier_id: string; status: string; order_status: OrderStatus }[]>`
      select so.order_id, so.supplier_id, so.status, o.status as order_status
      from public.supplier_orders so join public.orders o on o.id = so.order_id where so.id = ${supplierOrderId} for update of so`;
    if (!so) throw new Error("Pedido de fornecedor não encontrado");
    if (!isPaidState(so.order_status)) throw new Error("Pedido não está pago.");
    if (!["pending", "failed", "awaiting_approval"].includes(so.status)) throw new Error("Este pedido já foi encaminhado.");
    await tx`update public.supplier_orders set status = 'submitted', external_order_id = ${externalOrderId.trim()}, submitted_at = now(), last_error = null where id = ${supplierOrderId}`;
    await realizeSupplierCosts(tx, so.order_id, so.supplier_id);
    const [pending] = await tx<{ n: number }[]>`
      select count(*)::int as n from public.supplier_orders where order_id = ${so.order_id} and status in ('pending', 'awaiting_approval', 'submitting', 'failed')`;
    if (pending.n === 0) await transitionOrder(tx, so.order_id, "sent_to_supplier", "admin", { actorId, note: `Registrado manualmente (#${externalOrderId})` });
  });
}

export { SupplierError };
