import type { JobHandler } from "./queue";
import { forwardSupplierOrder } from "@/lib/fulfillment/forward";
import { syncMercadoPagoPayment } from "@/lib/payments/service";
import { sendOrderNotification } from "@/lib/notifications/send";
import type { OrderTemplate } from "@/lib/notifications/templates";
import { expireUnpaidOrders } from "@/lib/orders/maintenance";
import { syncSupplier } from "@/lib/suppliers/sync";
import { db } from "@/lib/db/client";
import { enqueueJob } from "./queue";

/** Registro central dos executores de tarefas em segundo plano. */
export const jobHandlers: Record<string, JobHandler> = {
  "supplier.forward": async (p) => forwardSupplierOrder(String(p.supplierOrderId)),
  "payment.sync": async (p) => syncMercadoPagoPayment(String(p.providerPaymentId)),
  "notify.order": async (p) => sendOrderNotification(String(p.orderId), p.template as OrderTemplate),
  "orders.expire": async () => expireUnpaidOrders(),
  // Sincronização diária de custo/estoque: uma tarefa por fornecedor com API.
  "suppliers.sync_all": async (_p, ctx) => {
    const day = new Date().toISOString().slice(0, 10);
    const rows = await db()<{ id: string }[]>`select id from public.suppliers where is_active and integration_type = 'cj'`;
    for (const r of rows) await enqueueJob(db(), "supplier.sync", { supplierId: r.id }, `supplier.sync:${r.id}:${day}`, { maxAttempts: 3 });
    return { enqueued: rows.length, by: ctx.jobId };
  },
  "supplier.sync": async (p) => syncSupplier(String(p.supplierId), null, { limit: 45 }),
};
