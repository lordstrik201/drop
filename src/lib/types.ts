export type AppRole = "customer" | "operator" | "support" | "manager" | "admin";

export type OrderStatus =
  | "pending_payment" | "paid" | "awaiting_supplier" | "sent_to_supplier" | "preparing"
  | "shipped" | "in_transit" | "delivered" | "canceled" | "refunded" | "under_review";

export type PaymentStatus =
  | "pending" | "in_process" | "authorized" | "approved" | "rejected"
  | "cancelled" | "refunded" | "partially_refunded" | "charged_back";

export type SupplierOrderStatus =
  | "pending" | "awaiting_approval" | "submitting" | "submitted" | "confirmed"
  | "processing" | "shipped" | "delivered" | "failed" | "canceled";

export type ShipmentStatus = "pending" | "posted" | "in_transit" | "out_for_delivery" | "delivered" | "exception" | "returned";

export type IntegrationStatus = "not_configured" | "configured" | "connected" | "error" | "disabled";
export type IntegrationType = "manual" | "csv" | "cj" | "dropi" | "api";
export type ProductStatus = "draft" | "active" | "inactive" | "archived";

export type Address = {
  recipient_name: string;
  phone?: string | null;
  cep: string;
  street: string;
  number: string;
  complement?: string | null;
  district: string;
  city: string;
  state: string;
};
