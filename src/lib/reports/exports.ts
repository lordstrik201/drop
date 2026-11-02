import { db } from "@/lib/db/client";
import { centsCell, type CsvColumn } from "@/lib/reports/csv";
import { ORDER_STATUS_LABELS } from "@/lib/orders/status";
import type { OrderStatus } from "@/lib/types";

type Range = { from: Date; to: Date; fromStr: string; toStr: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportDef = { id: string; title: string; permission: string; load: (r: Range, sp: Record<string, string>) => Promise<any[]>; columns: CsvColumn<any>[] };

const sp_dt = (d: Date | null) => (d ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d) : "");

type OrderRow = {
  number: string; created_at: Date; paid_at: Date | null; status: OrderStatus; customer_name: string; customer_email: string;
  city: string; state: string; items: number; subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number;
  coupon_code: string | null; method: string | null; fee: number; cost: number; refunded: number;
};

export const REPORTS: Record<string, ReportDef> = {
  pedidos: {
    id: "pedidos", title: "Pedidos", permission: "orders.read",
    load: async (r, sp) => {
      const sql = db();
      const status = sp.status && sp.status in ORDER_STATUS_LABELS ? sp.status : null;
      return sql<OrderRow[]>`
        select o.number, o.created_at, o.paid_at, o.status, o.customer_name, o.customer_email,
               o.shipping_address->>'city' as city, o.shipping_address->>'state' as state,
               (select sum(quantity)::int from public.order_items i where i.order_id = o.id) as items,
               o.subtotal_cents, o.discount_cents, o.shipping_cents, o.total_cents, o.coupon_code,
               (select method from public.payments p where p.order_id = o.id and p.status in ('approved','partially_refunded','refunded') limit 1) as method,
               coalesce((select sum(fee_cents) from public.payments p where p.order_id = o.id and p.status in ('approved','partially_refunded','refunded')), 0)::int as fee,
               (select coalesce(sum((unit_cost_cents + unit_shipping_cost_cents) * quantity), 0)::int from public.order_items i where i.order_id = o.id) as cost,
               coalesce((select sum(refunded_cents) from public.payments p where p.order_id = o.id), 0)::int as refunded
        from public.orders o
        where o.created_at >= ${r.from} and o.created_at < ${r.to} ${status ? sql`and o.status = ${status}` : sql``}
        order by o.created_at`;
    },
    columns: [
      { header: "pedido", value: (o: OrderRow) => o.number },
      { header: "criado_em", value: (o: OrderRow) => sp_dt(o.created_at) },
      { header: "pago_em", value: (o: OrderRow) => sp_dt(o.paid_at) },
      { header: "status", value: (o: OrderRow) => ORDER_STATUS_LABELS[o.status] },
      { header: "cliente", value: (o: OrderRow) => o.customer_name },
      { header: "email", value: (o: OrderRow) => o.customer_email },
      { header: "cidade", value: (o: OrderRow) => o.city },
      { header: "uf", value: (o: OrderRow) => o.state },
      { header: "itens", value: (o: OrderRow) => o.items },
      { header: "subtotal", value: (o: OrderRow) => centsCell(o.subtotal_cents) },
      { header: "desconto", value: (o: OrderRow) => centsCell(o.discount_cents) },
      { header: "frete", value: (o: OrderRow) => centsCell(o.shipping_cents) },
      { header: "total", value: (o: OrderRow) => centsCell(o.total_cents) },
      { header: "cupom", value: (o: OrderRow) => o.coupon_code },
      { header: "forma_pagamento", value: (o: OrderRow) => o.method },
      { header: "taxa_gateway", value: (o: OrderRow) => centsCell(o.fee) },
      { header: "custo_fornecedor", value: (o: OrderRow) => centsCell(o.cost) },
      { header: "reembolsado", value: (o: OrderRow) => centsCell(o.refunded) },
      { header: "margem", value: (o: OrderRow) => (o.paid_at ? centsCell(o.total_cents - o.refunded - o.cost - o.fee) : "") },
    ],
  },
};
