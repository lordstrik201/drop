import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getCredentials } from "@/lib/integrations/credentials";
import { ISSUE_KINDS, INTEGRATION_LABEL, supplierStats } from "@/lib/suppliers/admin";
import { Badge, Button, inputClass } from "@/components/ui";
import { Flash, Section, Stat } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatCNPJ, formatPhone } from "@/lib/validation/br";
import { formatDateTime } from "@/lib/ui/dates";
import { issueAction, resolveIssueAction, saveSupplierAction, syncSupplierAction, testSupplierAction } from "../actions";

export const metadata = { title: "Fornecedor" };
type S = {
  id: string; name: string; company_name: string | null; cnpj: string | null; contact_name: string | null; email: string | null; phone: string | null; address: string | null;
  website: string | null; avg_processing_days: number | null; avg_delivery_days: number | null; return_policy: string | null; integration_type: string; integration_status: string;
  integration_config: { usd_brl_rate?: number; logistic_name?: string; from_country_code?: string; warehouse_country?: string }; requires_manual_approval: boolean;
  internal_rating: number | null; notes: string | null; is_active: boolean; last_sync_at: Date | null;
};

function F({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return <label className={`flex flex-col gap-1 text-sm ${className ?? ""}`}><span className="font-medium">{label}</span>{children}{hint && <span className="text-xs text-muted">{hint}</span>}</label>;
}

export default async function SupplierDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("suppliers.read");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const isNew = id === "novo";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = db();
  const [s] = isNew ? [null] : await sql<S[]>`select * from public.suppliers where id = ${id}`;
  if (!isNew && !s) notFound();
  const canWrite = await can(user, "suppliers.write");
  const [stats, issues, orders] = s ? await Promise.all([
    supplierStats(s.id),
    sql<{ id: string; kind: string; description: string; status: string; created_at: Date; number: string | null; order_id: string | null }[]>`
      select i.id, i.kind, i.description, i.status, i.created_at, o.number, o.id as order_id from public.supplier_issues i left join public.orders o on o.id = i.order_id
      where i.supplier_id = ${s.id} order by (i.status = 'open') desc, i.created_at desc limit 30`,
    sql<{ id: string; order_id: string; number: string; status: string; external_order_id: string | null; created_at: Date; total_cost_cents: number }[]>`
      select so.id, so.order_id, o.number, so.status, so.external_order_id, so.created_at, so.total_cost_cents from public.supplier_orders so join public.orders o on o.id = so.order_id
      where so.supplier_id = ${s.id} order by so.created_at desc limit 20`,
  ]) : [null, [], []];
  const cjKey = s?.integration_type === "cj" ? !!(await getCredentials("cj").catch(() => ({} as Record<string, string>))).apiKey : false;
  const cfg = s?.integration_config ?? {};
  const dis = !canWrite;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/fornecedores" className="text-sm text-muted hover:text-ink">← Fornecedores</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">{s?.name ?? "Novo fornecedor"}{s && !s.is_active && <Badge>inativo</Badge>}</h1>
          {s && <p className="text-sm text-muted">{INTEGRATION_LABEL[s.integration_type]}{s.last_sync_at && ` · última sincronização ${formatDateTime(s.last_sync_at)}`}</p>}
        </div>
        {s && canWrite && s.integration_type === "cj" && (
          <div className="flex gap-2">
            <form action={testSupplierAction}><input type="hidden" name="supplierId" value={s.id} /><Button size="sm" variant="secondary" disabled={!cjKey}>Testar conexão</Button></form>
            <form action={syncSupplierAction}><input type="hidden" name="supplierId" value={s.id} /><Button size="sm" disabled={!cjKey}>Sincronizar custo e estoque</Button></form>
          </div>
        )}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      {s?.integration_type === "cj" && !cjKey && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Aguardando a API key da CJ em <Link href="/admin/integracoes" className="underline">Integrações</Link>.</p>}
      {s?.integration_type === "dropi" && <p className="rounded-lg bg-bg px-3 py-2 text-sm text-muted">A Dropi não publica documentação oficial de API. Os pedidos ficam na fila de encaminhamento manual (com CSV) e o estoque é atualizado por planilha. Se a Dropi fornecer a documentação de integração, o conector pode ser adicionado.</p>}

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Stat label="Produtos ativos" value={`${stats.active}/${stats.products}`} />
          <Stat label="Pedidos (90 dias)" value={stats.orders} />
          <Stat label="Com falha" value={stats.failed} tone={stats.failed ? "danger" : undefined} />
          <Stat label="Tempo até encaminhar" value={stats.avg_submit_h != null ? `${stats.avg_submit_h.toString().replace(".", ",")} h` : "—"} />
          <Stat label="Tempo até postar" value={stats.avg_ship_d != null ? `${stats.avg_ship_d.toString().replace(".", ",")} d` : "—"} />
          <Stat label="Atrasados sem rastreio" value={stats.delayed} tone={stats.delayed ? "warning" : undefined} />
          <Stat label="Custo pago (90 dias)" value={<span className="text-lg">{formatBRL(stats.cost_90d)}</span>} />
        </div>
      )}

      <form action={saveSupplierAction} className="grid gap-4 lg:grid-cols-3">
        {s && <input type="hidden" name="supplierId" value={s.id} />}
        <Section title="Cadastro" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Nome"><input name="name" defaultValue={s?.name} required maxLength={120} disabled={dis} className={inputClass} /></F>
            <F label="Razão social"><input name="company_name" defaultValue={s?.company_name ?? ""} maxLength={200} disabled={dis} className={inputClass} /></F>
            <F label="CNPJ"><input name="cnpj" defaultValue={s?.cnpj ? formatCNPJ(s.cnpj) : ""} maxLength={18} disabled={dis} className={inputClass} /></F>
            <F label="Contato"><input name="contact_name" defaultValue={s?.contact_name ?? ""} maxLength={120} disabled={dis} className={inputClass} /></F>
            <F label="E-mail"><input name="email" type="email" defaultValue={s?.email ?? ""} disabled={dis} className={inputClass} /></F>
            <F label="Telefone / WhatsApp"><input name="phone" defaultValue={s?.phone ? formatPhone(s.phone) : ""} maxLength={20} disabled={dis} className={inputClass} /></F>
            <F label="Endereço" className="sm:col-span-2"><input name="address" defaultValue={s?.address ?? ""} maxLength={300} disabled={dis} className={inputClass} /></F>
            <F label="Site"><input name="website" type="url" defaultValue={s?.website ?? ""} placeholder="https://" disabled={dis} className={inputClass} /></F>
            <F label="Avaliação interna (1 a 5)"><select name="internal_rating" defaultValue={s?.internal_rating ?? ""} disabled={dis} className={inputClass}><option value="">Sem avaliação</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}</select></F>
            <F label="Prazo médio de processamento (dias)" hint="Somado ao prazo do frete na estimativa exibida ao cliente."><input name="avg_processing_days" defaultValue={s?.avg_processing_days ?? ""} inputMode="numeric" disabled={dis} className={inputClass} /></F>
            <F label="Prazo médio de entrega (dias)"><input name="avg_delivery_days" defaultValue={s?.avg_delivery_days ?? ""} inputMode="numeric" disabled={dis} className={inputClass} /></F>
            <F label="Política de troca e devolução" className="sm:col-span-2"><textarea name="return_policy" defaultValue={s?.return_policy ?? ""} rows={3} maxLength={4000} disabled={dis} className={`${inputClass} h-auto py-2`} /></F>
            <F label="Observações internas" className="sm:col-span-2"><textarea name="notes" defaultValue={s?.notes ?? ""} rows={3} maxLength={4000} disabled={dis} className={`${inputClass} h-auto py-2`} /></F>
          </div>
        </Section>
        <div className="flex flex-col gap-4">
          <Section title="Operação">
            <div className="flex flex-col gap-3">
              <F label="Integração"><select name="integration_type" defaultValue={s?.integration_type ?? "manual"} disabled={dis} className={inputClass}>{["manual", "csv", "cj", "dropi"].map((k) => <option key={k} value={k}>{INTEGRATION_LABEL[k]}</option>)}</select></F>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="requires_manual_approval" defaultChecked={s?.requires_manual_approval ?? true} disabled={dis} className="mt-1" /><span>Exigir aprovação manual antes de encaminhar pedidos<span className="block text-xs text-muted">Recomendado. Sem isso, pedidos pagos seguem sozinhos se o encaminhamento automático estiver ligado em Configurações.</span></span></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={s?.is_active ?? true} disabled={dis} /> Ativo (desativar tira os produtos dele da loja)</label>
            </div>
          </Section>
          <Section title="Configuração CJdropshipping">
            <div className="flex flex-col gap-3">
              <F label="Cotação USD → BRL" hint="A CJ cobra em dólar. Atualize quando o câmbio mudar; os custos são convertidos com este valor."><input name="usd_brl_rate" defaultValue={cfg.usd_brl_rate ?? ""} inputMode="decimal" placeholder="ex.: 5,45" disabled={dis} className={inputClass} /></F>
              <F label="Método logístico (logisticName)" hint="Nome exato do frete da CJ usado nos pedidos (veja no painel da CJ)."><input name="logistic_name" defaultValue={cfg.logistic_name ?? ""} maxLength={80} disabled={dis} className={inputClass} /></F>
              <F label="País do armazém de origem"><input name="from_country_code" defaultValue={cfg.from_country_code ?? ""} maxLength={2} placeholder="CN ou BR" disabled={dis} className={inputClass} /></F>
              <F label="Contar estoque só deste país" hint="Ex.: BR para vender apenas o que está em armazém nacional."><input name="warehouse_country" defaultValue={cfg.warehouse_country ?? ""} maxLength={2} placeholder="vazio = todos" disabled={dis} className={inputClass} /></F>
              <p className="text-xs text-muted">Pedidos são criados na CJ <strong>sem pagamento automático</strong>: você confere e paga no painel da CJ.</p>
            </div>
          </Section>
          {canWrite && <Button>{s ? "Salvar fornecedor" : "Cadastrar fornecedor"}</Button>}
        </div>
      </form>

      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Ocorrências">
            {canWrite && (
              <form action={issueAction} className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
                <input type="hidden" name="supplierId" value={s.id} />
                <select name="kind" className={inputClass}>{Object.entries(ISSUE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="orderNumber" placeholder="Pedido (opcional)" inputMode="numeric" className={inputClass} />
                <textarea name="description" required rows={2} maxLength={2000} placeholder="O que aconteceu" className={`${inputClass} h-auto py-2 sm:col-span-3`} />
                <div><Button size="sm" variant="secondary">Registrar ocorrência</Button></div>
              </form>
            )}
            {issues.length === 0 ? <p className="text-sm text-muted">Nenhuma ocorrência.</p> : (
              <ul className="flex flex-col gap-2 text-sm">
                {issues.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-2">
                    <span><Badge tone={i.status === "open" ? "danger" : "neutral"}>{ISSUE_KINDS[i.kind]}</Badge> <span className="text-xs text-muted">{formatDateTime(i.created_at)}{i.number && <> · <Link href={`/admin/pedidos/${i.order_id}`} className="underline">#{i.number}</Link></>}</span><span className="block">{i.description}</span></span>
                    {canWrite && i.status === "open" && <form action={resolveIssueAction}><input type="hidden" name="supplierId" value={s.id} /><input type="hidden" name="issueId" value={i.id} /><button className="text-xs text-brand underline">resolver</button></form>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Últimos pedidos ao fornecedor">
            {orders.length === 0 ? <p className="text-sm text-muted">Nenhum pedido ainda.</p> : (
              <ul className="flex flex-col gap-1 text-sm">{orders.map((o) => <li key={o.id} className="flex justify-between gap-2"><span><Link href={`/admin/pedidos/${o.order_id}`} className="text-brand underline">#{o.number}</Link> <span className="text-xs text-muted">{formatDateTime(o.created_at)}{o.external_order_id && ` · ${o.external_order_id}`}</span></span><span className="text-xs">{o.status} · {formatBRL(o.total_cost_cents)}</span></li>)}</ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
