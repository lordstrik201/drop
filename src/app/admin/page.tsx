import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/session";
import { dashboardMetrics, parseRange } from "@/lib/reports/dashboard";
import { BarChart, DateRangeFilter, Section, Stat, Table, td } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { db } from "@/lib/db/client";
import { Alert } from "@/components/ui";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  await requireStaffPage("dashboard.view");
  const range = parseRange(await searchParams);
  const m = await dashboardMetrics(range);
  const [alerts] = await db()`
    select
      (select count(*)::int from public.integrations where provider in ('mercadopago') and status in ('not_configured', 'error')) as payment_off,
      (select count(*)::int from public.supplier_orders where status in ('failed')) as forward_failed,
      (select count(*)::int from public.jobs where status = 'dead') as dead_jobs,
      (select count(*)::int from public.orders where status = 'under_review') as review`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-sm text-muted">Valores do período por data do pedido; vendas do dia e do mês por data de aprovação.</p></div>
        <DateRangeFilter path="/admin" from={range.fromStr} to={range.toStr} />
      </div>
      {(alerts.payment_off > 0 || alerts.forward_failed > 0 || alerts.dead_jobs > 0 || alerts.review > 0) && (
        <div className="flex flex-col gap-2">
          {alerts.payment_off > 0 && <Alert tone="warning">Mercado Pago não está conectado: a loja não consegue receber pagamentos. <Link className="underline" href="/admin/integracoes">Configurar</Link></Alert>}
          {alerts.review > 0 && <Alert tone="danger">{alerts.review} pedido(s) em análise precisam de decisão. <Link className="underline" href="/admin/pedidos?status=under_review">Ver</Link></Alert>}
          {alerts.forward_failed > 0 && <Alert tone="danger">{alerts.forward_failed} encaminhamento(s) a fornecedor falharam. <Link className="underline" href="/admin/encaminhamento">Ver</Link></Alert>}
          {alerts.dead_jobs > 0 && <Alert tone="warning">{alerts.dead_jobs} tarefa(s) automática(s) falharam definitivamente. <Link className="underline" href="/admin/monitoramento">Ver</Link></Alert>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Faturamento no período" value={formatBRL(m.revenue)} hint={`${m.counts.paid} pedidos pagos`} />
        <Stat label="Vendas hoje" value={formatBRL(m.today.revenue)} hint={`${m.today.orders} pedidos`} />
        <Stat label="Vendas no mês" value={formatBRL(m.month.revenue)} hint={`${m.month.orders} pedidos`} />
        <Stat label="Ticket médio" value={formatBRL(m.avgTicket)} />
        <Stat label="Lucro bruto estimado" value={formatBRL(m.grossProfit)} hint="Vendas + frete − descontos − custos de produto e frete" tone={m.grossProfit < 0 ? "danger" : undefined} />
        <Stat label="Lucro líquido estimado" value={formatBRL(m.netProfit)} hint={`Após taxas (${formatBRL(-m.fees)}), reembolsos e despesas (${formatBRL(m.expenses)})`} tone={m.netProfit < 0 ? "danger" : "success"} />
        <Stat label="Taxa de conversão" value={m.conversion == null ? "—" : `${(m.conversion * 100).toFixed(1)}%`} hint="Pedidos pagos ÷ carrinhos com itens" />
        <Stat label="Clientes novos" value={m.newCustomers} />
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
        {[
          ["Aguardando pagamento", m.counts.pending, "pending_payment"], ["Pagos a encaminhar", m.counts.toFulfill, "awaiting_supplier"],
          ["No fornecedor", m.counts.atSupplier, "sent_to_supplier"], ["Enviados", m.counts.shipped, "shipped"], ["Entregues", m.counts.delivered, "delivered"],
          ["Cancelados", m.counts.canceled, "canceled"], ["Reembolsados", m.counts.refunded, "refunded"], ["Em análise", m.counts.review, "under_review"], ["Total", m.counts.all, ""],
        ].map(([l, v, s]) => (
          <Link key={String(l)} href={`/admin/pedidos?status=${s}&de=${range.fromStr}&ate=${range.toStr}`} className="rounded-xl border border-line bg-surface p-3 hover:border-brand">
            <p className="text-[11px] text-muted">{l}</p><p className="text-xl font-bold tabular-nums">{v}</p>
          </Link>
        ))}
      </div>
      <Section title="Faturamento por dia (R$)">
        <BarChart data={m.series.map((s) => ({ x: s.day, y: s.revenue }))} format={formatBRL} label="Faturamento diário no período" />
      </Section>
      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">Produtos mais vendidos</h2>
          <Table head={["Produto", "Qtd.", "Receita", "Lucro bruto"]} empty={m.top.length ? false : "Sem vendas no período."}>
            {m.top.map((t) => <tr key={t.name}><td className={td}>{t.name}</td><td className={td}>{t.qty}</td><td className={td}>{formatBRL(t.revenue)}</td><td className={td}>{formatBRL(t.profit)}</td></tr>)}
          </Table>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Produtos com maior margem (catálogo ativo)</h2>
          <Table head={["Produto", "Preço", "Custo + frete", "Margem"]} empty={m.margin.length ? false : "Nenhum produto ativo."}>
            {m.margin.map((t) => <tr key={t.name}><td className={td}>{t.name}</td><td className={td}>{formatBRL(t.price)}</td><td className={td}>{formatBRL(t.cost)}</td><td className={td}>{(t.margin_bps / 100).toFixed(1)}%</td></tr>)}
          </Table>
          <p className="mt-1 text-xs text-muted">Margem antes da taxa do meio de pagamento.</p>
        </div>
      </div>
    </div>
  );
}
