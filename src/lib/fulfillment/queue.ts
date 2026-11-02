import { db } from "@/lib/db/client";
import type { Address, SupplierOrderStatus } from "@/lib/types";

export type QueueRow = {
  id: string; order_id: string; number: string; status: SupplierOrderStatus; supplier_id: string; supplier_name: string;
  integration_type: string; attempts: number; last_error: string | null; total_cost_cents: number; paid_at: Date | null;
  customer_name: string; customer_email: string; customer_phone: string | null; customer_cpf: string | null;
  shipping_address: Address; shipping_method: string | null;
  items: { sku: string; name: string; variant: string | null; ref: string | null; qty: number }[];
};

export const OPEN_SUPPLIER_STATUSES: SupplierOrderStatus[] = ["awaiting_approval", "pending", "submitting", "failed"];

/** Pedidos de fornecedor ainda não encaminhados (somente pedidos pagos). */
export async function fulfillmentQueue(opts: { supplierId?: string | null; statuses?: SupplierOrderStatus[] } = {}) {
  const sql = db();
  const statuses = opts.statuses?.length ? opts.statuses : OPEN_SUPPLIER_STATUSES;
  return sql<QueueRow[]>`
    select so.id, so.order_id, o.number, so.status, so.supplier_id, s.name as supplier_name, s.integration_type, so.attempts,
           so.last_error, so.total_cost_cents, o.paid_at, o.customer_name, o.customer_email, o.customer_phone, o.customer_cpf,
           o.shipping_address, o.shipping_method,
           (select json_agg(json_build_object('sku', i.sku, 'name', i.product_name, 'variant', i.variant_title,
                   'ref', coalesce(i.supplier_variant_ref, i.supplier_product_ref), 'qty', i.quantity) order by i.created_at)
            from public.order_items i where i.order_id = so.order_id and i.supplier_id = so.supplier_id) as items
    from public.supplier_orders so
    join public.orders o on o.id = so.order_id
    join public.suppliers s on s.id = so.supplier_id
    where so.status = any(${statuses}::public.supplier_order_status[])
      and o.status in ('awaiting_supplier', 'sent_to_supplier', 'under_review')
      ${opts.supplierId ? sql`and so.supplier_id = ${opts.supplierId}` : sql``}
    order by o.paid_at nulls last, o.number`;
}
