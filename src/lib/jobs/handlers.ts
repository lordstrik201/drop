import type { JobHandler } from "./queue";
import { forwardSupplierOrder } from "@/lib/fulfillment/forward";
import { syncMercadoPagoPayment } from "@/lib/payments/service";
import { sendOrderNotification } from "@/lib/notifications/send";
import type { OrderTemplate } from "@/lib/notifications/templates";
import { expireUnpaidOrders } from "@/lib/orders/maintenance";

/** Registro central dos executores de tarefas em segundo plano. */
export const jobHandlers: Record<string, JobHandler> = {
  "supplier.forward": async (p) => forwardSupplierOrder(String(p.supplierOrderId)),
  "payment.sync": async (p) => syncMercadoPagoPayment(String(p.providerPaymentId)),
  "notify.order": async (p) => sendOrderNotification(String(p.orderId), p.template as OrderTemplate),
  "orders.expire": async () => expireUnpaidOrders(),
};
