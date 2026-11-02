import "server-only";
import { db } from "@/lib/db/client";

export type Range = { from: Date; to: Date };

const PAID = ["paid", "awaiting_supplier", "sent_to_supplier", "preparing", "shipped", "in_transit", "delivered"];

/**
 * Indicadores do dashboard. Faturamento = soma dos pedidos com pagamento
 * aprovado (não inclui pendentes/cancelados/reembolsados). Lucro vem do razão
 * financeiro (receitas − custos − taxas − reembolsos), nunca do faturamento.
 */
export async function dashboardMetrics(r: Range) {
  const sql = db();
  const [kpi] = await sql`
    select
      coalesce(sum(total_cents) filter (where status = any(${PAID}::order_status[])), 0)::bigint as revenue,
      count(*) filter (where status = any(${PAID}::order_status[]))::int as paid_orders,
      count(*)::int as all_orders,
      count(*) filter (where status = 'pending_payment')::int as pending,
      count(*) filter (where status in ('paid', 'awaiting_supplier'))::int as to_fulfill,
      count(*) filter (where status in ('sent_to_supplier', 'preparing'))::int as at_supplier,
      count(*) filter (where status in ('shipped', 'in_transit'))::int as shipped,
      count(*) filter (where status = 'delivered')::int as delivered,
      count(*) filter (where status = 'canceled')::int as canceled,
      count(*) filter (where status = 'refunded')::int as refunded,
      count(*) filter (where status = 'under_review')::int as review
    from public.orders where created_at >= ${r.from} and created_at < ${r.to}`;
  const [today] = await sql`
    select coalesce(sum(total_cents), 0)::bigint as revenue, count(*)::int as n from public.orders
    where status = any(${PAID}::order_status[]) and paid_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`;
  const [month] = await sql`
    select coalesce(sum(total_cents), 0)::bigint as revenue, count(*)::int as n from public.orders
    where status = any(${PAID}::order_status[]) and paid_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`;
  const [ledger] = await sql`
    select
      coalesce(sum(amount_cents) filter (where kind in ('sale_revenue', 'shipping_revenue', 'discount', 'product_cost', 'shipping_cost')), 0)::bigint as gross_profit,
      coalesce(sum(amount_cents), 0)::bigint as net_profit,
      coalesce(sum(amount_cents) filter (where kind = 'gateway_fee'), 0)::bigint as fees
    from public.financial_entries where status <> 'canceled' and occurred_at >= ${r.from} and occurred_at < ${r.to}`;
  const [{ expenses }] = await sql`select coalesce(sum(amount_cents), 0)::bigint as expenses from public.expenses where status <> 'canceled' and due_date >= ${r.from}::date and due_date < ${r.to}::date`;
  const [carts] = await sql`select count(*)::int as n from public.carts c where c.created_at >= ${r.from} and c.created_at < ${r.to} and (c.status = 'converted' or exists (select 1 from public.cart_items ci where ci.cart_id = c.id))`;
  const [{ new_customers }] = await sql`select count(*)::int as new_customers from public.profiles where role = 'customer' and created_at >= ${r.from} and created_at < ${r.to}`;
  const top = await sql<{ name: string; qty: number; revenue: number; profit: number }[]>`
    select i.product_name as name, sum(i.quantity)::int as qty, sum(i.total_cents)::bigint as revenue,
           sum(i.total_cents - (i.unit_cost_cents + i.unit_shipping_cost_cents) * i.quantity)::bigint as profit
    from public.order_items i join public.orders o on o.id = i.order_id
    where o.status = any(${PAID}::order_status[]) and o.created_at >= ${r.from} and o.created_at < ${r.to}
    group by i.product_name order by qty desc limit 8`;
  const margin = await sql<{ name: string; price: number; cost: number; margin_bps: number }[]>`
    select p.name, p.price_cents as price, (p.cost_cents + p.shipping_cost_cents) as cost,
           case when p.price_cents > 0 then ((p.price_cents - p.cost_cents - p.shipping_cost_cents) * 10000 / p.price_cents) else 0 end::int as margin_bps
    from public.products p where p.status = 'active' order by margin_bps desc limit 8`;
  const series = await sql<{ day: string; revenue: number; orders: number }[]>`
    with days as (
      select generate_series(date_trunc('day', ${r.from}::timestamptz at time zone 'America/Sao_Paulo'), date_trunc('day', (${r.to}::timestamptz - interval '1 second') at time zone 'America/Sao_Paulo'), interval '1 day')::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(o.total_cents), 0)::bigint as revenue, count(o.id)::int as orders
    from days d left join public.orders o on (o.paid_at at time zone 'America/Sao_Paulo')::date = d.day and o.status = any(${PAID}::order_status[])
    group by d.day order by d.day`;

  const revenue = Number(kpi.revenue);
  return {
    revenue,
    today: { revenue: Number(today.revenue), orders: today.n },
    month: { revenue: Number(month.revenue), orders: month.n },
    counts: { all: kpi.all_orders, paid: kpi.paid_orders, pending: kpi.pending, toFulfill: kpi.to_fulfill, atSupplier: kpi.at_supplier, shipped: kpi.shipped, delivered: kpi.delivered, canceled: kpi.canceled, refunded: kpi.refunded, review: kpi.review },
    grossProfit: Number(ledger.gross_profit),
    netProfit: Number(ledger.net_profit) - Number(expenses),
    fees: Number(ledger.fees),
    expenses: Number(expenses),
    avgTicket: kpi.paid_orders ? Math.round(revenue / kpi.paid_orders) : 0,
    conversion: carts.n ? kpi.paid_orders / carts.n : null,
    newCustomers: new_customers,
    top: top.map((t) => ({ ...t, revenue: Number(t.revenue), profit: Number(t.profit) })),
    margin,
    series: series.map((s) => ({ day: s.day, revenue: Number(s.revenue), orders: s.orders })),
  };
}

export function parseRange(sp: { de?: string; ate?: string }, defaultDays = 30): Range & { fromStr: string; toStr: string } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const toStr = sp.ate && iso.test(sp.ate) ? sp.ate : today;
  const fallbackFrom = new Date(new Date(`${toStr}T12:00:00-03:00`).getTime() - (defaultDays - 1) * 86400000);
  const fromStr = sp.de && iso.test(sp.de) ? sp.de : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(fallbackFrom);
  const from = new Date(`${fromStr}T00:00:00-03:00`);
  const to = new Date(new Date(`${toStr}T00:00:00-03:00`).getTime() + 86400000);
  if (to <= from) return { from: new Date(to.getTime() - 86400000), to, fromStr: toStr, toStr };
  return { from, to, fromStr, toStr };
}
