import type { OrderStatus, PaymentStatus, ShipmentStatus, SupplierOrderStatus } from "@/lib/types";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Pagamento aprovado",
  awaiting_supplier: "Aguardando fornecedor",
  sent_to_supplier: "Pedido enviado ao fornecedor",
  preparing: "Em preparação",
  shipped: "Enviado",
  in_transit: "Em trânsito",
  delivered: "Entregue",
  canceled: "Cancelado",
  refunded: "Reembolsado",
  under_review: "Em análise",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  pending_payment: "warning",
  paid: "info",
  awaiting_supplier: "warning",
  sent_to_supplier: "info",
  preparing: "info",
  shipped: "info",
  in_transit: "info",
  delivered: "success",
  canceled: "neutral",
  refunded: "neutral",
  under_review: "danger",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pendente",
  in_process: "Em processamento",
  authorized: "Autorizado",
  approved: "Aprovado",
  rejected: "Recusado",
  cancelled: "Cancelado",
  refunded: "Estornado",
  partially_refunded: "Estornado parcialmente",
  charged_back: "Contestado (chargeback)",
};

export const SUPPLIER_ORDER_STATUS_LABELS: Record<SupplierOrderStatus, string> = {
  pending: "Pendente",
  awaiting_approval: "Aguardando aprovação",
  submitting: "Enviando",
  submitted: "Enviado ao fornecedor",
  confirmed: "Confirmado pelo fornecedor",
  processing: "Em processamento",
  shipped: "Despachado",
  delivered: "Entregue",
  failed: "Falhou",
  canceled: "Cancelado",
};

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending: "Aguardando postagem",
  posted: "Postado",
  in_transit: "Em trânsito",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  exception: "Ocorrência",
  returned: "Devolvido",
};

/**
 * Máquina de estados do pedido. Qualquer transição fora desta tabela é
 * rejeitada. "under_review" (em análise) pode ser usado a partir de qualquer
 * estado ativo para travar o fluxo automático.
 */
const T: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "canceled", "under_review"],
  paid: ["awaiting_supplier", "canceled", "refunded", "under_review"],
  awaiting_supplier: ["sent_to_supplier", "canceled", "refunded", "under_review"],
  sent_to_supplier: ["preparing", "shipped", "awaiting_supplier", "canceled", "refunded", "under_review"],
  preparing: ["shipped", "canceled", "refunded", "under_review"],
  shipped: ["in_transit", "delivered", "refunded", "under_review"],
  in_transit: ["delivered", "refunded", "under_review"],
  delivered: ["refunded", "under_review"],
  canceled: ["refunded"],
  refunded: [],
  under_review: ["pending_payment", "paid", "awaiting_supplier", "sent_to_supplier", "preparing", "shipped", "in_transit", "delivered", "canceled", "refunded"],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return T[from].includes(to);
}

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return T[from];
}

export class InvalidTransitionError extends Error {
  constructor(public from: OrderStatus, public to: OrderStatus) {
    super(`Transição inválida: ${ORDER_STATUS_LABELS[from]} → ${ORDER_STATUS_LABELS[to]}`);
  }
}

/** Estados em que o pagamento já foi confirmado. */
export const PAID_STATES: OrderStatus[] = ["paid", "awaiting_supplier", "sent_to_supplier", "preparing", "shipped", "in_transit", "delivered"];

export function isPaidState(s: OrderStatus) {
  return PAID_STATES.includes(s);
}

/** Pedido pode ser cancelado pelo painel sem logística em andamento? */
export function isCancelable(s: OrderStatus) {
  return canTransition(s, "canceled");
}
