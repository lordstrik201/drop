import { db } from "@/lib/db/client";
import { centsCell, type CsvColumn } from "@/lib/reports/csv";
import { ORDER_STATUS_LABELS } from "@/lib/orders/status";
import type { OrderStatus } from "@/lib/types";
import { cashFlow, financeDre, profitBy, type ProfitRow } from "@/lib/finance/summary";
import { CATEGORY_LABEL } from "@/lib/finance/admin";

type Range = { from: Date; to: Date; fromStr: string; toStr: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportDef = { id: string; title: string; description: string; permission: string; load: (r: Range, sp: Record<string, string>) => Promise<any[]>; columns: CsvColumn<any>[] };

const sp_dt = (d: Date | null) => (d ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d) : "");

type OrderRow = {
  number: string; created_at: Date; paid_at: Date | null; status: OrderStatus; customer_name: string; customer_email: string;
  city: string; state: string; items: number; subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number;
  coupon_code: string | null; method: string | null; fee: number; cost: number; refunded: number;
};

export const REPORTS: Record<string, ReportDef> = {
  pedidos: {
    id: "pedidos", title: "Pedidos", description: "Todos os pedidos criados no período, com valores, custo, taxa e margem.", permission: "orders.read",
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

  dre: {
    id: "dre", title: "Demonstrativo de resultado", description: "Receitas, custos, taxas, reembolsos e despesas pagas (competência).", permission: "finance.read",
    load: async (r) => {
      const d = await financeDre(r);
      return [
        ["Vendas de produtos", d.sales], ["Frete cobrado", d.shippingRevenue], ["Descontos", d.discounts], ["Receita líquida de vendas", d.gross],
        ["Custo dos produtos", d.productCost], ["Frete pago ao fornecedor", d.shippingCost], ["Taxas do meio de pagamento", d.fees],
        ["Reembolsos", d.refunds], ["Contestações", d.chargebacks], ["Comissões", d.commissions], ["Outras receitas", d.otherIncome],
        ["Despesas operacionais pagas", d.otherExpense], ["Resultado do período", d.net], ["Custos previstos (não realizados)", d.expectedCosts],
      ].map(([linha, valor]) => ({ linha, valor }));
    },
    columns: [
      { header: "linha", value: (x: { linha: string }) => x.linha },
      { header: "valor", value: (x: { valor: number }) => centsCell(x.valor) },
    ],
  },
  caixa: {
    id: "caixa", title: "Fluxo de caixa", description: "Entradas e saídas realizadas por dia, pela data de liberação do dinheiro.", permission: "finance.read",
    load: async (r) => {
      let saldo = 0;
      return (await cashFlow(r)).map((x) => ({ ...x, saldo: (saldo += x.inflow - x.outflow) }));
    },
    columns: [
      { header: "dia", value: (x: { day: string }) => x.day.split("-").reverse().join("/") },
      { header: "entradas", value: (x: { inflow: number }) => centsCell(x.inflow) },
      { header: "saidas", value: (x: { outflow: number }) => centsCell(x.outflow) },
      { header: "saldo_acumulado", value: (x: { saldo: number }) => centsCell(x.saldo) },
    ],
  },
  lancamentos: {
    id: "lancamentos", title: "Lançamentos financeiros", description: "Razão completo: cada receita, custo, taxa e reembolso com o pedido de origem.", permission: "finance.read",
    load: async (r) => db()`
      select fe.occurred_at, fe.available_at, fe.kind::text, fe.status, fe.amount_cents, fe.description, o.number::text as pedido, s.name as fornecedor, p.name as produto
      from public.financial_entries fe left join public.orders o on o.id = fe.order_id
      left join public.suppliers s on s.id = fe.supplier_id left join public.products p on p.id = fe.product_id
      where fe.occurred_at >= ${r.from} and fe.occurred_at < ${r.to} order by fe.occurred_at`,
    columns: [
      { header: "data", value: (x: { occurred_at: Date }) => sp_dt(x.occurred_at) },
      { header: "disponivel_em", value: (x: { available_at: Date | null }) => sp_dt(x.available_at) },
      { header: "tipo", value: (x: { kind: string }) => LEDGER_LABEL[x.kind] ?? x.kind },
      { header: "situacao", value: (x: { status: string }) => ({ realized: "realizado", expected: "previsto", canceled: "cancelado" })[x.status] ?? x.status },
      { header: "valor", value: (x: { amount_cents: number }) => centsCell(x.amount_cents) },
      { header: "pedido", value: (x: { pedido: string | null }) => x.pedido },
      { header: "fornecedor", value: (x: { fornecedor: string | null }) => x.fornecedor },
      { header: "produto", value: (x: { produto: string | null }) => x.produto },
      { header: "descricao", value: (x: { description: string | null }) => x.description },
    ],
  },
  lucro_produtos: {
    id: "lucro_produtos", title: "Lucro por produto", description: "Receita, custo e lucro bruto de cada produto vendido.", permission: "finance.read",
    load: (r) => profitBy("product", r, 5000), columns: profitColumns("produto"),
  },
  lucro_fornecedores: {
    id: "lucro_fornecedores", title: "Lucro por fornecedor", description: "Receita, custo e lucro bruto agrupados por fornecedor.", permission: "finance.read",
    load: (r) => profitBy("supplier", r, 5000), columns: profitColumns("fornecedor"),
  },
  contas_pagar: {
    id: "contas_pagar", title: "Contas a pagar", description: "Contas com vencimento no período (abertas, pagas e canceladas).", permission: "finance.read",
    load: async (r) => db()`
      select e.due_date::text as data, e.description, e.category, e.amount_cents, e.status, e.paid_at, s.name as fornecedor
      from public.expenses e left join public.suppliers s on s.id = e.supplier_id
      where e.due_date >= ${r.fromStr}::date and e.due_date <= ${r.toStr}::date order by e.due_date`,
    columns: billColumns({ open: "em aberto", paid: "paga", canceled: "cancelada" }, true),
  },
  contas_receber: {
    id: "contas_receber", title: "Contas a receber", description: "Valores fora do Mercado Pago com previsão no período.", permission: "finance.read",
    load: async (r) => db()`
      select expected_date::text as data, description, category, amount_cents, status, received_at as paid_at, null as fornecedor
      from public.revenues where expected_date >= ${r.fromStr}::date and expected_date <= ${r.toStr}::date order by expected_date`,
    columns: billColumns({ open: "em aberto", received: "recebida", canceled: "cancelada" }, false),
  },
  produtos_vendidos: {
    id: "produtos_vendidos", title: "Produtos mais vendidos", description: "Quantidade e faturamento por variação em pedidos pagos.", permission: "reports.read",
    load: async (r) => db()`
      select i.product_name, i.variant_title, i.sku, sum(i.quantity)::int as unidades, sum(i.unit_price_cents * i.quantity)::bigint::float8 as receita
      from public.order_items i join public.orders o on o.id = i.order_id
      where o.paid_at >= ${r.from} and o.paid_at < ${r.to} and o.status not in ('canceled', 'refunded')
      group by 1, 2, 3 order by unidades desc`,
    columns: [
      { header: "produto", value: (x: { product_name: string }) => x.product_name },
      { header: "variacao", value: (x: { variant_title: string | null }) => x.variant_title },
      { header: "sku", value: (x: { sku: string }) => x.sku },
      { header: "unidades", value: (x: { unidades: number }) => x.unidades },
      { header: "receita", value: (x: { receita: number }) => centsCell(x.receita) },
    ],
  },
  cupons: {
    id: "cupons", title: "Uso de cupons", description: "Cupons usados em pedidos no período e desconto concedido.", permission: "reports.read",
    load: async (r) => db()`
      select c.code, count(cr.id)::int as usos, coalesce(sum(cr.discount_cents), 0)::bigint::float8 as desconto,
             coalesce(sum(o.total_cents) filter (where o.paid_at is not null), 0)::bigint::float8 as vendas_pagas
      from public.coupon_redemptions cr join public.coupons c on c.id = cr.coupon_id join public.orders o on o.id = cr.order_id
      where cr.created_at >= ${r.from} and cr.created_at < ${r.to} group by c.code order by usos desc`,
    columns: [
      { header: "cupom", value: (x: { code: string }) => x.code },
      { header: "usos", value: (x: { usos: number }) => x.usos },
      { header: "desconto", value: (x: { desconto: number }) => centsCell(x.desconto) },
      { header: "vendas_pagas", value: (x: { vendas_pagas: number }) => centsCell(x.vendas_pagas) },
    ],
  },
};

const LEDGER_LABEL: Record<string, string> = {
  sale_revenue: "Venda", shipping_revenue: "Frete cobrado", discount: "Desconto", product_cost: "Custo do produto", shipping_cost: "Frete do fornecedor",
  gateway_fee: "Taxa do pagamento", refund: "Reembolso", chargeback: "Contestação", commission: "Comissão", other_income: "Outra receita", other_expense: "Despesa",
};

function profitColumns(first: string): CsvColumn<ProfitRow>[] {
  return [
    { header: first, value: (x) => x.name },
    { header: "unidades", value: (x) => x.units },
    { header: "receita", value: (x) => centsCell(x.revenue) },
    { header: "descontos", value: (x) => centsCell(x.discounts) },
    { header: "custo", value: (x) => centsCell(x.cost) },
    { header: "frete_fornecedor", value: (x) => centsCell(x.shipping_cost) },
    { header: "lucro_bruto", value: (x) => centsCell(x.profit) },
    { header: "margem", value: (x) => (x.margin_bps === null ? "" : `${(x.margin_bps / 100).toFixed(1).replace(".", ",")}%`) },
  ];
}

type BillRow = { data: string; description: string; category: string; amount_cents: number; status: string; paid_at: Date | null; fornecedor: string | null };
function billColumns(labels: Record<string, string>, withSupplier: boolean): CsvColumn<BillRow>[] {
  return [
    { header: "data", value: (x) => x.data.split("-").reverse().join("/") },
    { header: "descricao", value: (x) => x.description },
    { header: "categoria", value: (x) => CATEGORY_LABEL[x.category] ?? x.category },
    { header: "valor", value: (x) => centsCell(x.amount_cents) },
    { header: "situacao", value: (x) => labels[x.status] ?? x.status },
    { header: "liquidado_em", value: (x) => sp_dt(x.paid_at) },
    ...(withSupplier ? [{ header: "fornecedor", value: (x: BillRow) => x.fornecedor }] : []),
  ];
}
