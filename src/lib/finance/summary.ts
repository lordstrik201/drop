import { db } from "@/lib/db/client";
import type { Range } from "@/lib/reports/dashboard";

/**
 * Demonstrativo de resultado por competência (data do fato), a partir do razão.
 * Considera somente lançamentos realizados; custos "previstos" (pedido pago ainda
 * não encaminhado) aparecem à parte, para não confundir faturamento com lucro.
 */
export type Dre = {
  sales: number; shippingRevenue: number; discounts: number; gross: number;
  productCost: number; shippingCost: number; fees: number; refunds: number; chargebacks: number; commissions: number;
  otherIncome: number; otherExpense: number; net: number; marginBps: number | null;
  expectedCosts: number; orders: number;
};

export async function financeDre(r: Range): Promise<Dre> {
  const rows = await db()<{ kind: string; status: string; total: number }[]>`
    select kind::text, status, coalesce(sum(amount_cents), 0)::bigint::float8 as total
    from public.financial_entries where occurred_at >= ${r.from} and occurred_at < ${r.to} and status <> 'canceled'
    group by kind, status`;
  const [{ orders }] = await db()<{ orders: number }[]>`
    select count(distinct order_id)::int as orders from public.financial_entries
    where kind = 'sale_revenue' and status = 'realized' and occurred_at >= ${r.from} and occurred_at < ${r.to}`;
  const sum = (k: string) => rows.filter((x) => x.kind === k && x.status === "realized").reduce((a, x) => a + Number(x.total), 0);
  const d = {
    sales: sum("sale_revenue"), shippingRevenue: sum("shipping_revenue"), discounts: sum("discount"),
    productCost: sum("product_cost"), shippingCost: sum("shipping_cost"), fees: sum("gateway_fee"), refunds: sum("refund"),
    chargebacks: sum("chargeback"), commissions: sum("commission"), otherIncome: sum("other_income"), otherExpense: sum("other_expense"),
  };
  const gross = d.sales + d.shippingRevenue + d.discounts;
  const net = gross + d.productCost + d.shippingCost + d.fees + d.refunds + d.chargebacks + d.commissions + d.otherIncome + d.otherExpense;
  const expectedCosts = rows.filter((x) => x.status === "expected").reduce((a, x) => a + Number(x.total), 0);
  return { ...d, gross, net, marginBps: gross > 0 ? Math.round((net / gross) * 10000) : null, expectedCosts, orders };
}

/**
 * Fluxo de caixa por dia: entradas e saídas realizadas pela data de
 * disponibilidade do dinheiro (liberação do gateway) ou do fato.
 */
export async function cashFlow(r: Range) {
  return db()<{ day: string; inflow: number; outflow: number }[]>`
    with d as (
      select generate_series((${r.from}::timestamptz at time zone 'America/Sao_Paulo')::date,
                             ((${r.to}::timestamptz - interval '1 second') at time zone 'America/Sao_Paulo')::date, interval '1 day')::date as day
    ), e as (
      select (coalesce(available_at, occurred_at) at time zone 'America/Sao_Paulo')::date as day, amount_cents
      from public.financial_entries
      where status = 'realized' and coalesce(available_at, occurred_at) >= ${r.from} and coalesce(available_at, occurred_at) < ${r.to}
    )
    select d.day::text, coalesce(sum(e.amount_cents) filter (where e.amount_cents > 0), 0)::bigint::float8 as inflow,
           coalesce(-sum(e.amount_cents) filter (where e.amount_cents < 0), 0)::bigint::float8 as outflow
    from d left join e on e.day = d.day group by d.day order by d.day`;
}

/** Valores a receber/pagar nos próximos dias (gateway, contas e custos previstos). */
export async function upcoming(days = 30) {
  const [r] = await db()<{ gateway: number; receivables: number; payables: number; overdue_payables: number; expected_costs: number }[]>`
    select
      coalesce((select sum(net_cents) from public.payments where status in ('approved','partially_refunded') and money_release_date > now()
                and money_release_date < now() + make_interval(days => ${days})), 0)::bigint::float8 as gateway,
      coalesce((select sum(amount_cents) from public.revenues where status = 'open' and expected_date < current_date + ${days}::int), 0)::bigint::float8 as receivables,
      coalesce((select sum(amount_cents) from public.expenses where status = 'open' and due_date < current_date + ${days}::int), 0)::bigint::float8 as payables,
      coalesce((select sum(amount_cents) from public.expenses where status = 'open' and due_date < (now() at time zone 'America/Sao_Paulo')::date), 0)::bigint::float8 as overdue_payables,
      coalesce((select -sum(amount_cents) from public.financial_entries where status = 'expected'), 0)::bigint::float8 as expected_costs`;
  return r;
}

export type ProfitRow = { id: string | null; name: string; units: number; revenue: number; discounts: number; cost: number; shipping_cost: number; profit: number; margin_bps: number | null };

/**
 * Lucro bruto por produto ou fornecedor: receita − descontos − custo − frete
 * do fornecedor (realizados ou previstos). Taxa do gateway e despesas gerais
 * não são rateadas por item; aparecem no demonstrativo geral.
 */
export async function profitBy(dim: "product" | "supplier", r: Range, limit = 100): Promise<ProfitRow[]> {
  const sql = db();
  const col = dim === "product" ? sql`fe.product_id` : sql`fe.supplier_id`;
  const name = dim === "product"
    ? sql`coalesce((select p.name from public.products p where p.id = g.id), 'Produto removido')`
    : sql`coalesce((select s.name from public.suppliers s where s.id = g.id), 'Sem fornecedor')`;
  const rows = await sql<ProfitRow[]>`
    with g as (
      select ${col} as id,
        coalesce(sum(fe.amount_cents) filter (where fe.kind = 'sale_revenue'), 0)::bigint::float8 as revenue,
        coalesce(-sum(fe.amount_cents) filter (where fe.kind = 'discount'), 0)::bigint::float8 as discounts,
        coalesce(-sum(fe.amount_cents) filter (where fe.kind = 'product_cost'), 0)::bigint::float8 as cost,
        coalesce(-sum(fe.amount_cents) filter (where fe.kind = 'shipping_cost'), 0)::bigint::float8 as shipping_cost
      from public.financial_entries fe
      where fe.status <> 'canceled' and fe.kind in ('sale_revenue','discount','product_cost','shipping_cost')
        and fe.occurred_at >= ${r.from} and fe.occurred_at < ${r.to}
      group by 1
    )
    select g.id, ${name} as name,
      coalesce((select sum(i.quantity) from public.order_items i join public.financial_entries s on s.dedupe_key = 'sale:' || i.id::text
                where ${dim === "product" ? sql`i.product_id` : sql`i.supplier_id`} is not distinct from g.id and s.status <> 'canceled'
                  and s.occurred_at >= ${r.from} and s.occurred_at < ${r.to}), 0)::int as units,
      g.revenue, g.discounts, g.cost, g.shipping_cost,
      (g.revenue - g.discounts - g.cost - g.shipping_cost) as profit
    from g order by profit desc limit ${limit}`;
  return rows.map((x) => ({ ...x, margin_bps: x.revenue - x.discounts > 0 ? Math.round((x.profit / (x.revenue - x.discounts)) * 10000) : null }));
}
