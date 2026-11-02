import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/settings";
import { getCredentials, missingFields } from "@/lib/integrations/credentials";
import { listPaymentMethods, type MpPaymentMethod } from "@/lib/integrations/payments/mercadopago";
import { PAYMENT_STATUS_LABELS } from "@/lib/orders/status";
import { Badge, Button, Pagination } from "@/components/ui";
import { DateRangeFilter, Flash, Section, Stat, Table, td } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/ui/dates";
import { parseRange } from "@/lib/reports/dashboard";
import type { PaymentStatus } from "@/lib/types";
import { reconcileAction, savePaymentSettingsAction } from "./actions";

export const metadata = { title: "Pagamentos" };
const TYPE_LABEL: Record<string, string> = { credit_card: "Cartão de crédito", debit_card: "Cartão de débito", bank_transfer: "Pix / transferência", ticket: "Boleto", account_money: "Saldo Mercado Pago", prepaid_card: "Cartão pré-pago", atm: "Caixa eletrônico", digital_currency: "Moeda digital", digital_wallet: "Carteira digital" };
const METHOD_LABEL: Record<string, string> = { pix: "Pix", credit_card: "Crédito", debit_card: "Débito", ticket: "Boleto", bank_transfer: "Transferência", account_money: "Saldo MP" };
type SP = { status?: string; de?: string; ate?: string; pagina?: string; ok?: string; erro?: string };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireStaffPage("finance.read");
  const sp = await searchParams;
  const sql = db();
  const range = parseRange(sp, 30);
  const status = sp.status && sp.status in PAYMENT_STATUS_LABELS ? (sp.status as PaymentStatus) : null;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const [cfg, canConfig, canWrite, totals, rows, issues] = await Promise.all([
    getSetting("payments"), can(user, "settings.write"), can(user, "orders.write"),
    sql<{ approved: number; gross: number; fees: number; net: number; refunded: number; pending: number; rejected: number; to_release: number }[]>`
      select count(*) filter (where status in ('approved','partially_refunded'))::int as approved,
             coalesce(sum(amount_cents) filter (where status in ('approved','partially_refunded','refunded')), 0)::int as gross,
             coalesce(sum(fee_cents) filter (where status in ('approved','partially_refunded','refunded')), 0)::int as fees,
             coalesce(sum(net_cents) filter (where status in ('approved','partially_refunded')), 0)::int as net,
             coalesce(sum(refunded_cents), 0)::int as refunded,
             count(*) filter (where status in ('pending','in_process','authorized') and provider_payment_id is not null)::int as pending,
             count(*) filter (where status = 'rejected')::int as rejected,
             coalesce(sum(net_cents) filter (where status in ('approved','partially_refunded') and money_release_date > now()), 0)::int as to_release
      from public.payments where created_at >= ${range.from} and created_at < ${range.to}`,
    sql<{ id: string; order_id: string; number: string; method: string | null; status: PaymentStatus; status_detail: string | null; amount_cents: number; fee_cents: number; refunded_cents: number; installments: number | null; provider_payment_id: string | null; created_at: Date; money_release_date: Date | null; live_mode: boolean | null; total: number }[]>`
      select p.id, p.order_id, o.number, p.method, p.status, p.status_detail, p.amount_cents, p.fee_cents, p.refunded_cents, p.installments, p.provider_payment_id,
             p.created_at, p.money_release_date, p.live_mode, count(*) over()::int as total
      from public.payments p join public.orders o on o.id = p.order_id
      where p.created_at >= ${range.from} and p.created_at < ${range.to} and p.provider_payment_id is not null ${status ? sql`and p.status = ${status}` : sql``}
      order by p.created_at desc limit 50 offset ${(page - 1) * 50}`,
    // Conciliação: situações que não deveriam existir e precisam de olho humano
    sql<{ kind: string; order_id: string; number: string; detail: string }[]>`
      select 'Pago no Mercado Pago, pedido não confirmado' as kind, o.id as order_id, o.number::text, p.provider_payment_id as detail
        from public.payments p join public.orders o on o.id = p.order_id
       where p.status in ('approved','partially_refunded') and o.status in ('pending_payment','canceled')
      union all
      select 'Pedido em análise', o.id, o.number::text, coalesce((select note from public.order_status_history h where h.order_id = o.id order by h.created_at desc limit 1), '')
        from public.orders o where o.status = 'under_review'
      union all
      select 'Reembolso com falha', r.order_id, o.number::text, coalesce(r.error, '') from public.refunds r join public.orders o on o.id = r.order_id where r.status = 'failed'
      union all
      select 'Contestação (chargeback)', p.order_id, o.number::text, p.provider_payment_id from public.payments p join public.orders o on o.id = p.order_id where p.status = 'charged_back'
      limit 50`,
  ]);
  const t = totals[0];
  let creds: Record<string, string> = {};
  try { creds = await getCredentials("mercadopago"); } catch { creds = {}; }
  const configured = missingFields("mercadopago", creds).length === 0;
  let methods: MpPaymentMethod[] | null = null;
  let methodsError: string | null = null;
  if (configured && canConfig) {
    try { methods = (await listPaymentMethods(creds.accessToken)).filter((m) => m.status === "active"); } catch (e) { methodsError = (e as Error).message; }
  }
  const types = methods ? Array.from(new Set(methods.map((m) => m.payment_type_id))) : [];
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["pagina", "ok", "erro"].includes(k)) as [string, string][]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Pagamentos</h1><p className="text-sm text-muted">Mercado Pago Checkout Pro: Pix, cartão de crédito e débito. Nenhum dado de cartão passa pela loja.</p></div>
        {canWrite && configured && <form action={reconcileAction}><Button size="sm" variant="secondary">Conferir pendentes no Mercado Pago</Button></form>}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      {!configured && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Mercado Pago aguardando credenciais: o checkout mostra “pagamento indisponível” até lá. <Link href="/admin/integracoes" className="underline">Configurar</Link></div>}
      {process.env.APP_ENV === "production" && creds.accessToken?.startsWith("TEST-") && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">Ambiente de produção usando credencial de TESTE do Mercado Pago: pagamentos não serão reais.</div>}

      {issues.length > 0 && (
        <Section title={`Conciliação: ${issues.length} item(ns) para revisar`}>
          <ul className="flex flex-col gap-1 text-sm">{issues.map((i, k) => <li key={k}><Badge tone="danger">{i.kind}</Badge> <Link href={`/admin/pedidos/${i.order_id}`} className="text-brand underline">#{i.number}</Link> <span className="text-xs text-muted">{i.detail}</span></li>)}</ul>
        </Section>
      )}

      <DateRangeFilter path="/admin/pagamentos" from={range.fromStr} to={range.toStr} extra={
        <label className="flex flex-col gap-1 text-xs text-muted">Status
          <select name="status" defaultValue={status ?? ""} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink"><option value="">Todos</option>{Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
      } />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Aprovados" value={t.approved} />
        <Stat label="Valor bruto" value={<span className="text-lg">{formatBRL(t.gross)}</span>} />
        <Stat label="Taxas do gateway" value={<span className="text-lg">{formatBRL(t.fees)}</span>} />
        <Stat label="Líquido" value={<span className="text-lg">{formatBRL(t.net)}</span>} />
        <Stat label="A liberar" value={<span className="text-lg">{formatBRL(t.to_release)}</span>} hint="ainda retido no Mercado Pago" />
        <Stat label="Reembolsado" value={<span className="text-lg">{formatBRL(t.refunded)}</span>} />
        <Stat label="Pendentes / recusados" value={`${t.pending} / ${t.rejected}`} />
      </div>
      <Table head={["Data", "Pedido", "Forma", "Valor", "Taxa", "Status", "Liberação", "ID Mercado Pago"]} empty={rows.length ? false : "Nenhum pagamento no período."}>
        {rows.map((p) => (
          <tr key={p.id}>
            <td className={`${td} whitespace-nowrap`}>{formatDateTime(p.created_at)}</td>
            <td className={td}><Link href={`/admin/pedidos/${p.order_id}`} className="font-semibold text-brand hover:underline">#{p.number}</Link></td>
            <td className={td}>{p.method ? METHOD_LABEL[p.method] ?? p.method : "—"}{p.installments && p.installments > 1 ? ` ${p.installments}x` : ""}</td>
            <td className={`${td} tabular-nums`}>{formatBRL(p.amount_cents)}{p.refunded_cents > 0 && <span className="block text-xs text-muted">estornado {formatBRL(p.refunded_cents)}</span>}</td>
            <td className={`${td} tabular-nums text-muted`}>{formatBRL(p.fee_cents)}</td>
            <td className={td}><Badge tone={p.status === "approved" ? "success" : ["rejected", "charged_back"].includes(p.status) ? "danger" : "neutral"}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>{p.status_detail && <span className="block text-xs text-muted">{p.status_detail}</span>}{p.live_mode === false && <span className="block text-xs font-semibold text-warning">teste</span>}</td>
            <td className={td}>{p.money_release_date ? formatDate(p.money_release_date) : "—"}</td>
            <td className={`${td} font-mono text-xs`}>{p.provider_payment_id}</td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={rows[0]?.total ?? 0} perPage={50} hrefFor={(n) => `/admin/pagamentos?${qs}&pagina=${n}`} />

      {canConfig && (
        <section id="config" className="scroll-mt-20 rounded-xl border border-line bg-surface">
          <header className="border-b border-line px-4 py-3"><h2 className="font-semibold">Meios de pagamento oferecidos</h2><p className="text-xs text-muted">Lista obtida da sua conta Mercado Pago. O saldo em conta Mercado Pago não pode ser ocultado (regra do Mercado Pago).</p></header>
          <form action={savePaymentSettingsAction} className="flex flex-col gap-3 p-4 text-sm">
            {methodsError && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-900">Não foi possível consultar os meios de pagamento: {methodsError}</p>}
            {!configured && <p className="text-xs text-muted">Disponível depois de configurar as credenciais do Mercado Pago.</p>}
            {types.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {types.map((tp) => (
                  <label key={tp} className="flex items-start gap-2">
                    <input type="hidden" name="offered" value={tp} />
                    <input type="checkbox" name="enabled" value={tp} defaultChecked={!cfg.excluded_payment_types.includes(tp)} disabled={tp === "account_money"} className="mt-1" />
                    <span>{TYPE_LABEL[tp] ?? tp}<span className="block text-xs text-muted">{methods!.filter((m) => m.payment_type_id === tp).map((m) => m.name).slice(0, 8).join(", ")}</span></span>
                  </label>
                ))}
              </div>
            )}
            <label className="flex w-60 flex-col gap-1"><span className="font-medium">Parcelas máximas no cartão</span>
              <select name="max_installments" defaultValue={cfg.max_installments} className="h-10 rounded-lg border border-line bg-surface px-3">{Array.from({ length: 36 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "À vista (1x)" : `Até ${n}x`}</option>)}</select>
              <span className="text-xs text-muted">Juros e taxas de parcelamento seguem as condições da sua conta Mercado Pago.</span>
            </label>
            <div><Button size="sm">Salvar</Button></div>
          </form>
        </section>
      )}
    </div>
  );
}
