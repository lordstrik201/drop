import "server-only";
import { db } from "@/lib/db/client";
import type { OrderStatus, ShipmentStatus } from "@/lib/types";

export type OrderView = {
  id: string; number: number; status: OrderStatus; created_at: Date; paid_at: Date | null;
  customer_name: string; customer_email: string; shipping_address: Record<string, string>;
  shipping_method: string | null; subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number;
  coupon_code: string | null; payment_method: string | null; cancel_reason: string | null; profile_id: string | null;
  items: { id: string; product_name: string; variant_title: string | null; quantity: number; unit_price_cents: number; total_cents: number; image_url: string | null; product_slug: string | null }[];
  history: { to_status: OrderStatus; created_at: Date; note: string | null; source: string }[];
  shipments: { id: string; carrier: string | null; tracking_code: string | null; tracking_url: string | null; status: ShipmentStatus; confirmed_eta: string | null; events: { occurred_at: Date; description: string; location: string | null }[] }[];
  payments: { method: string | null; status: string; installments: number | null; created_at: Date }[];
};

export async function getOrderView(orderId: string): Promise<OrderView | null> {
  const sql = db();
  const [o] = await sql`select * from public.orders where id = ${orderId}`;
  if (!o) return null;
  const [items, history, shipments, payments] = await Promise.all([
    sql`select i.id, i.product_name, i.variant_title, i.quantity, i.unit_price_cents, i.total_cents, i.image_url, p.slug as product_slug
        from public.order_items i left join public.products p on p.id = i.product_id where i.order_id = ${orderId} order by i.created_at`,
    sql`select to_status, created_at, note, source from public.order_status_history where order_id = ${orderId} order by created_at`,
    sql`select id, carrier, tracking_code, tracking_url, status, confirmed_eta::text from public.shipments where order_id = ${orderId} order by created_at`,
    sql`select method, status, installments, created_at from public.payments where order_id = ${orderId} and provider_payment_id is not null order by created_at desc`,
  ]);
  const events = shipments.length
    ? await sql`select shipment_id, occurred_at, description, location from public.tracking_events where shipment_id = any(${shipments.map((s) => s.id)}::uuid[]) order by occurred_at desc`
    : [];
  return {
    ...(o as unknown as OrderView),
    number: Number(o.number),
    items: items as unknown as OrderView["items"],
    history: history as unknown as OrderView["history"],
    shipments: shipments.map((s) => ({ ...(s as unknown as OrderView["shipments"][number]), events: events.filter((e) => e.shipment_id === s.id) as unknown as OrderView["shipments"][number]["events"] })),
    payments: payments as unknown as OrderView["payments"],
  };
}

export async function listCustomerOrders(profileId: string) {
  return db()<{ id: string; number: string; status: OrderStatus; total_cents: number; created_at: Date; items: number }[]>`
    select o.id, o.number, o.status, o.total_cents, o.created_at, (select count(*)::int from public.order_items i where i.order_id = o.id) as items
    from public.orders o where o.profile_id = ${profileId} order by o.created_at desc limit 100`;
}
