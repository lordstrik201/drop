"use server";

import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str, optStr } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { addInternalNote, addShipment, cancelOrder, requeueForward, setOrderStatus, updateShipmentStatus } from "@/lib/orders/admin";
import { approveOrderForFulfillment, markSupplierOrderSubmitted } from "@/lib/fulfillment/forward";
import { requestRefund, syncMercadoPagoPayment } from "@/lib/payments/service";
import { parseBRL } from "@/lib/money";
import { db } from "@/lib/db/client";
import type { OrderStatus, ShipmentStatus } from "@/lib/types";

// Volta para a página de origem quando ela é do painel (ex.: fila de encaminhamento); senão, para o pedido.
const back = (f: FormData) => {
  const b = str(f, "back");
  return /^\/admin\/[a-z0-9/_-]*(\?[\w=&%.-]*)?$/i.test(b) ? b : `/admin/pedidos/${str(f, "orderId")}`;
};

export async function approveAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.approve");
    const n = await approveOrderForFulfillment(str(f, "orderId"), u.id);
    await audit(u, "order.approve_fulfillment", "order", str(f, "orderId"));
    return n ? `Aprovado: ${n} pedido(s) de fornecedor na fila de envio.` : "Nada a aprovar.";
  });
}

export async function markSubmittedAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.write");
    const ext = str(f, "externalOrderId");
    if (!ext) throw new Error("Informe o número do pedido no fornecedor.");
    await markSupplierOrderSubmitted(str(f, "supplierOrderId"), ext, u.id);
    await audit(u, "supplier_order.mark_submitted", "supplier_order", str(f, "supplierOrderId"), { after: { externalOrderId: ext } });
    return "Encaminhamento registrado.";
  });
}

export async function requeueAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.write");
    await requeueForward(str(f, "supplierOrderId"));
    await audit(u, "supplier_order.requeue", "supplier_order", str(f, "supplierOrderId"));
    return "Reenvio agendado (mesma chave de idempotência, sem duplicar o pedido no fornecedor).";
  });
}

export async function shipmentAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.write");
    await addShipment(str(f, "orderId"), {
      supplierOrderId: optStr(f, "supplierOrderId"), carrier: str(f, "carrier"), service: optStr(f, "service"),
      trackingCode: str(f, "trackingCode"), trackingUrl: optStr(f, "trackingUrl"), confirmedEta: optStr(f, "confirmedEta"),
    }, u.id);
    await audit(u, "order.add_shipment", "order", str(f, "orderId"), { after: { carrier: str(f, "carrier"), code: str(f, "trackingCode") } });
    return "Rastreio registrado e cliente notificado.";
  });
}

export async function shipmentStatusAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.write");
    const status = str(f, "status") as ShipmentStatus;
    const desc = str(f, "description") || { in_transit: "Em trânsito", out_for_delivery: "Saiu para entrega", delivered: "Entregue", exception: "Ocorrência na entrega", returned: "Devolvido ao remetente", posted: "Postado", pending: "Aguardando postagem" }[status];
    await updateShipmentStatus(str(f, "shipmentId"), status, { at: new Date(), description: desc }, "admin", u.id);
    await audit(u, "shipment.status", "shipment", str(f, "shipmentId"), { after: { status } });
    return "Status do envio atualizado.";
  });
}

export async function cancelAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.cancel");
    await cancelOrder(str(f, "orderId"), str(f, "reason"), u.id);
    await audit(u, "order.cancel", "order", str(f, "orderId"), { after: { reason: str(f, "reason") } });
    return "Pedido cancelado e estoque devolvido.";
  });
}

export async function refundAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("payments.refund");
    const amountRaw = str(f, "amount");
    const amount = amountRaw ? parseBRL(amountRaw) : null;
    const reason = str(f, "reason");
    if (reason.length < 3) throw new Error("Informe o motivo do reembolso.");
    if (f.get("confirm") !== "on") throw new Error("Confirme o reembolso marcando a caixa de confirmação.");
    const r = await requestRefund(str(f, "orderId"), amount, reason, u.id, fetch, `refund:${str(f, "orderId")}:${str(f, "nonce")}`);
    await audit(u, "order.refund", "order", str(f, "orderId"), { after: { amount, reason, providerRefundId: r.providerRefundId } });
    return "Reembolso processado no Mercado Pago.";
  });
}

export async function statusAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.write");
    const to = str(f, "to") as OrderStatus;
    await setOrderStatus(str(f, "orderId"), to, u.id, optStr(f, "note"));
    await audit(u, "order.set_status", "order", str(f, "orderId"), { after: { to } });
    return "Status atualizado.";
  });
}

export async function noteAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.write");
    if (str(f, "note").length < 2) throw new Error("Nota vazia.");
    await addInternalNote(str(f, "orderId"), str(f, "note").slice(0, 2000), u);
    return "Nota adicionada.";
  });
}

export async function syncPaymentAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("orders.write");
    const [p] = await db()<{ provider_payment_id: string }[]>`select provider_payment_id from public.payments where order_id = ${str(f, "orderId")} and provider_payment_id is not null order by created_at desc limit 1`;
    if (!p) throw new Error("Nenhum pagamento registrado para sincronizar. Pagamentos chegam pelo webhook quando o cliente paga.");
    const r = await syncMercadoPagoPayment(p.provider_payment_id);
    await audit(u, "payment.sync", "order", str(f, "orderId"));
    return `Pagamento sincronizado com o Mercado Pago (status do pedido: ${r.orderStatus}).`;
  });
}
