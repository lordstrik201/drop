import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { parseRange } from "@/lib/reports/dashboard";
import { cashFlow, financeDre, profitBy, upcoming } from "@/lib/finance/summary";
import { CATEGORY_LABEL, EXPENSE_CATEGORIES, REVENUE_CATEGORIES } from "@/lib/finance/admin";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { DateRangeFilter, Flash, Section, Stat, Table, td } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/ui/dates";
import { expenseStatusAction, revenueStatusAction, saveExpenseAction, saveRevenueAction } from "./actions";

export const metadata = { title: "Financeiro" };
type SP = { aba?: string; de?: string; ate?: string; situacao?: string; ok?: string; erro?: string };
const pct = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(1).replace(".", ",")}%`);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export default async function FinancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireStaffPage("finance.read");
  const sp = await searchParams;
  const tab = sp.aba === "contas" || sp.aba === "lucro" ? sp.aba : "resumo";
  const range = parseRange(sp, 30);
  const canWrite = await can(user, "finance.write");
  const tabs = [["resumo", "Resumo e caixa"], ["contas", "Contas a pagar e receber"], ["lucro", "Lucro por produto e fornecedor"]] as const;
  const q = `de=${range.fromStr}&ate=${range.toStr}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Financeiro</h1>
          <p className="text-sm text-muted">Valores do razão financeiro: vendas aprovadas, custos de fornecedor, taxas, reembolsos e contas lançadas aqui.</p>
        </div>
        {tab !== "contas" && <DateRangeFilter path="/admin/financeiro" from={range.fromStr} to={range.toStr} extra={<input type="hidden" name="aba" value={tab} />} />}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      <nav className="flex flex-wrap gap-2 text-sm">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/admin/financeiro?aba=${k}&${q}`} className={`rounded-lg px-3 py-1.5 ${tab === k ? "bg-ink text-white" : "border border-line"}`}>{label}</Link>
        ))}
      </nav>
      {tab === "resumo" && <Summary range={range} q={q} />}
      {tab === "contas" && <Bills canWrite={canWrite} situacao={sp.situacao === "todas" ? "todas" : "abertas"} />}
      {tab === "lucro" && <Profit range={range} q={q} />}
    </div>
  );
}

async function Summary({ range, q }: { range: ReturnType<typeof parseRange>; q: string }) {
  const [d, flow, next] = await Promise.all([financeDre(range), cashFlow(range), upcoming(30)]);
  const lines: [string, number, string?][] = [
    ["Vendas de produtos", d.sales], ["Frete cobrado", d.shippingRevenue], ["Descontos", d.discounts],
    ["Receita líquida de vendas", d.gross, "strong"],
    ["Custo dos produtos (fornecedor)", d.productCost], ["Frete pago ao fornecedor", d.shippingCost], ["Taxas do meio de pagamento", d.fees],
    ["Reembolsos", d.refunds], ["Contestações (chargeback)", d.chargebacks], ["Comissões", d.commissions],
    ["Outras receitas", d.otherIncome], ["Despesas operacionais pagas", d.otherExpense],
    ["Resultado do período", d.net, "strong"],
  ];
  const totalIn = flow.reduce((a, x) => a + x.inflow, 0), totalOut = flow.reduce((a, x) => a + x.outflow, 0);
  const days = flow.filter((x) => x.inflow || x.outflow);
  const balances = days.reduce<number[]>((acc, x) => [...acc, (acc.at(-1) ?? 0) + x.inflow - x.outflow], []);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Receita líquida de vendas" value={formatBRL(d.gross)} hint={`${d.orders} pedido(s) aprovados`} />
        <Stat label="Resultado" value={formatBRL(d.net)} tone={d.net < 0 ? "danger" : "success"} hint={`margem ${pct(d.marginBps)}`} />
        <Stat label="A liberar no Mercado Pago (30 dias)" value={formatBRL(next.gateway)} />
        <Stat label="Contas a pagar (30 dias)" value={formatBRL(next.payables)} tone={next.overdue_payables ? "danger" : undefined} hint={next.overdue_payables ? `${formatBRL(next.overdue_payables)} vencido` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Demonstrativo de resultado (competência)" actions={<a href={`/admin/relatorios/exportar?tipo=dre&formato=pdf&${q}`} download className="text-sm text-muted hover:text-ink">Baixar PDF</a>}>
          <table className="w-full text-sm">
            <tbody>
              {lines.map(([label, v, s]) => (
                <tr key={label} className={s ? "border-t border-line font-semibold" : ""}>
                  <td className="py-1.5">{label}</td>
                  <td className={`py-1.5 text-right tabular-nums ${v < 0 ? "text-danger" : ""}`}>{formatBRL(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.expectedCosts !== 0 && (
            <p className="mt-3 rounded-lg bg-warning/10 p-2 text-xs">
              Custos previstos ainda não realizados (pedidos pagos aguardando encaminhamento): {formatBRL(d.expectedCosts)}. Eles entram no resultado quando o pedido é enviado ao fornecedor.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">Faturamento não é lucro: o resultado desconta custos, taxas, reembolsos e despesas. Impostos só entram se lançados como conta a pagar.</p>
        </Section>
        <Section title="Fluxo de caixa realizado" actions={<a href={`/admin/relatorios/exportar?tipo=caixa&formato=csv&${q}`} download className="text-sm text-muted hover:text-ink">Baixar CSV</a>}>
          <div className="mb-2 flex gap-4 text-sm"><span>Entradas: <b>{formatBRL(totalIn)}</b></span><span>Saídas: <b>{formatBRL(totalOut)}</b></span><span>Saldo: <b className={totalIn - totalOut < 0 ? "text-danger" : ""}>{formatBRL(totalIn - totalOut)}</b></span></div>
          <div className="max-h-96 overflow-auto">
            <Table head={["Dia", "Entradas", "Saídas", "Saldo acumulado"]} empty="Sem movimento no período.">
              {days.map((x, i) => {
                const running = balances[i];
                return (
                  <tr key={x.day} className="border-t border-line">
                    <td className={td}>{x.day.split("-").reverse().join("/")}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatBRL(x.inflow)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatBRL(x.outflow)}</td>
                    <td className={`${td} text-right tabular-nums ${running < 0 ? "text-danger" : ""}`}>{formatBRL(running)}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted">Vendas entram na data de liberação do Mercado Pago (quando informada); despesas na data do pagamento.</p>
        </Section>
      </div>
    </>
  );
}

type Bill = { id: string; category: string; description: string; amount_cents: number; date: string; status: string; done_at: Date | null; supplier: string | null; notes: string | null };

async function Bills({ canWrite, situacao }: { canWrite: boolean; situacao: "abertas" | "todas" }) {
  const sql = db();
  const all = situacao === "todas";
  const [payables, receivables, suppliers] = await Promise.all([
    sql<Bill[]>`select e.id, e.category, e.description, e.amount_cents, e.due_date::text as date, e.status, e.paid_at as done_at, s.name as supplier, e.notes
                from public.expenses e left join public.suppliers s on s.id = e.supplier_id
                where ${all} or e.status = 'open' order by e.status = 'open' desc, e.due_date limit 300`,
    sql<Bill[]>`select id, category, description, amount_cents, expected_date::text as date, status, received_at as done_at, null as supplier, notes
                from public.revenues where ${all} or status = 'open' order by status = 'open' desc, expected_date limit 300`,
    sql<{ id: string; name: string }[]>`select id, name from public.suppliers order by name`,
  ]);
  const t = today();
  const toggle = <Link href={`/admin/financeiro?aba=contas${all ? "" : "&situacao=todas"}`} className="text-sm text-muted hover:text-ink">{all ? "Mostrar só em aberto" : "Mostrar todas"}</Link>;
  const statusBadge = (b: Bill, kind: "pagar" | "receber") =>
    b.status === "open" ? (b.date < t ? <Badge tone="danger">Vencida</Badge> : <Badge tone="warning">Em aberto</Badge>)
      : b.status === "canceled" ? <Badge>Cancelada</Badge> : <Badge tone="success">{kind === "pagar" ? "Paga" : "Recebida"} {b.done_at ? formatDate(b.done_at) : ""}</Badge>;

  return (
    <>
      <Section title="Contas a pagar" actions={toggle}>
        <div id="pagar" />
        <Table head={["Vencimento", "Descrição", "Categoria", "Valor", "Situação", ""]} empty="Nenhuma conta a pagar.">
          {payables.map((b) => (
            <tr key={b.id} className="border-t border-line">
              <td className={td}>{b.date.split("-").reverse().join("/")}</td>
              <td className={td}>{b.description}{b.supplier && <div className="text-xs text-muted">{b.supplier}</div>}</td>
              <td className={td}>{CATEGORY_LABEL[b.category] ?? b.category}</td>
              <td className={`${td} text-right tabular-nums`}>{formatBRL(b.amount_cents)}</td>
              <td className={td}>{statusBadge(b, "pagar")}</td>
              <td className={td}>{canWrite && <BillActions id={b.id} status={b.status} action={expenseStatusAction} done="pay" doneLabel="Marcar paga" />}</td>
            </tr>
          ))}
        </Table>
        {canWrite && (
          <form action={saveExpenseAction} className="mt-4 grid gap-3 rounded-lg border border-line p-3 md:grid-cols-6">
            <Field label="Descrição" className="md:col-span-2"><Input name="description" required maxLength={200} /></Field>
            <Field label="Categoria"><Select name="category">{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
            <Field label="Valor (R$)"><Input name="amount" required inputMode="decimal" placeholder="0,00" /></Field>
            <Field label="Vencimento"><Input name="due_date" type="date" required defaultValue={t} /></Field>
            <Field label="Fornecedor"><Select name="supplier_id">{[<option key="" value="">—</option>, ...suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)]}</Select></Field>
            <Field label="Observações" className="md:col-span-4"><Input name="notes" maxLength={1000} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paid" /> Já está paga</label>
            <div className="flex items-end"><Button size="sm">Lançar conta a pagar</Button></div>
          </form>
        )}
      </Section>

      <Section title="Contas a receber (fora do Mercado Pago)">
        <div id="receber" />
        <Table head={["Previsão", "Descrição", "Categoria", "Valor", "Situação", ""]} empty="Nenhum valor a receber lançado. Vendas do site entram sozinhas pelo Mercado Pago.">
          {receivables.map((b) => (
            <tr key={b.id} className="border-t border-line">
              <td className={td}>{b.date.split("-").reverse().join("/")}</td>
              <td className={td}>{b.description}</td>
              <td className={td}>{CATEGORY_LABEL[b.category] ?? b.category}</td>
              <td className={`${td} text-right tabular-nums`}>{formatBRL(b.amount_cents)}</td>
              <td className={td}>{statusBadge(b, "receber")}</td>
              <td className={td}>{canWrite && <BillActions id={b.id} status={b.status} action={revenueStatusAction} done="receive" doneLabel="Marcar recebida" />}</td>
            </tr>
          ))}
        </Table>
        {canWrite && (
          <form action={saveRevenueAction} className="mt-4 grid gap-3 rounded-lg border border-line p-3 md:grid-cols-6">
            <Field label="Descrição" className="md:col-span-2"><Input name="description" required maxLength={200} /></Field>
            <Field label="Categoria"><Select name="category">{REVENUE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
            <Field label="Valor (R$)"><Input name="amount" required inputMode="decimal" placeholder="0,00" /></Field>
            <Field label="Previsão"><Input name="expected_date" type="date" required defaultValue={t} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="received" /> Já recebido</label>
            <Field label="Observações" className="md:col-span-5"><Input name="notes" maxLength={1000} /></Field>
            <div className="flex items-end"><Button size="sm">Lançar a receber</Button></div>
          </form>
        )}
      </Section>
    </>
  );
}

function BillActions({ id, status, action, done, doneLabel }: { id: string; status: string; action: (f: FormData) => Promise<never>; done: string; doneLabel: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {status === "open" ? (
        <>
          <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={done} /><Button size="sm" variant="secondary">{doneLabel}</Button></form>
          <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="cancel" /><Button size="sm" variant="ghost">Cancelar</Button></form>
        </>
      ) : status !== "canceled" ? (
        <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="reopen" /><Button size="sm" variant="ghost">Reabrir</Button></form>
      ) : null}
    </div>
  );
}

async function Profit({ range, q }: { range: ReturnType<typeof parseRange>; q: string }) {
  const [products, suppliers] = await Promise.all([profitBy("product", range, 50), profitBy("supplier", range, 50)]);
  const table = (rows: Awaited<ReturnType<typeof profitBy>>, first: string) => (
    <Table head={[first, "Unid.", "Receita", "Descontos", "Custo", "Frete forn.", "Lucro bruto", "Margem"]} empty="Sem vendas aprovadas no período.">
      {rows.map((r) => (
        <tr key={r.id ?? "null"} className="border-t border-line">
          <td className={td}>{r.name}</td>
          <td className={`${td} text-right tabular-nums`}>{r.units}</td>
          <td className={`${td} text-right tabular-nums`}>{formatBRL(r.revenue)}</td>
          <td className={`${td} text-right tabular-nums`}>{formatBRL(r.discounts)}</td>
          <td className={`${td} text-right tabular-nums`}>{formatBRL(r.cost)}</td>
          <td className={`${td} text-right tabular-nums`}>{formatBRL(r.shipping_cost)}</td>
          <td className={`${td} text-right tabular-nums font-semibold ${r.profit < 0 ? "text-danger" : ""}`}>{formatBRL(r.profit)}</td>
          <td className={`${td} text-right tabular-nums`}>{pct(r.margin_bps)}</td>
        </tr>
      ))}
    </Table>
  );
  return (
    <>
      <Section title="Por produto" actions={<a href={`/admin/relatorios/exportar?tipo=lucro_produtos&formato=csv&${q}`} download className="text-sm text-muted hover:text-ink">Baixar CSV</a>}>{table(products, "Produto")}</Section>
      <Section title="Por fornecedor" actions={<a href={`/admin/relatorios/exportar?tipo=lucro_fornecedores&formato=csv&${q}`} download className="text-sm text-muted hover:text-ink">Baixar CSV</a>}>{table(suppliers, "Fornecedor")}</Section>
      <p className="text-xs text-muted">Lucro bruto = receita − descontos − custo do fornecedor − frete do fornecedor. Taxas do meio de pagamento e despesas gerais aparecem no resumo, sem rateio por item.</p>
    </>
  );
}
