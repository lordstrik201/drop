import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Badge, Button } from "@/components/ui";
import { Flash, Stat, Table, td } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/ui/dates";
import { cancelJobAction, retryJobAction, runJobsNowAction } from "./actions";

export const metadata = { title: "Monitoramento" };

const JOB_LABEL: Record<string, string> = {
  "supplier.forward": "Encaminhar ao fornecedor", "payment.sync": "Sincronizar pagamento", "notify.order": "E-mail ao cliente", "orders.expire": "Expirar pedidos não pagos", "suppliers.sync_all": "Agendar sincronização de fornecedores", "supplier.sync": "Sincronizar fornecedor",
};
type SP = { aba?: string; nivel?: string; fonte?: string; ok?: string; erro?: string };

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireStaffPage("monitoring.read");
  const sp = await searchParams;
  const tab = ["tarefas", "webhooks", "logs"].includes(sp.aba ?? "") ? sp.aba! : "tarefas";
  const sql = db();
  const canRetry = await can(user, "monitoring.retry");
  const [counts, lastRun, integ, dbPing] = await Promise.all([
    sql<{ status: string; n: number }[]>`select status, count(*)::int as n from public.jobs where created_at > now() - interval '7 days' or status in ('queued','failed','dead','running') group by status`,
    sql<{ at: Date | null }[]>`select max(finished_at) as at from public.jobs`,
    sql<{ provider: string; status: string }[]>`select provider, status from public.integrations where status = 'error'`,
    sql<{ ms: number }[]>`select 1 as ms`.then(() => true).catch(() => false),
  ]);
  const c = Object.fromEntries(counts.map((r) => [r.status, r.n])) as Record<string, number>;
  const stuck = await sql<{ n: number }[]>`select count(*)::int as n from public.jobs where status = 'queued' and run_at < now() - interval '15 minutes'`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monitoramento e diagnóstico</h1>
          <p className="text-sm text-muted">Fila de tarefas, webhooks recebidos e logs técnicos (dados sensíveis são mascarados).</p>
        </div>
        {canRetry && <form action={runJobsNowAction}><Button size="sm" variant="secondary">Processar fila agora</Button></form>}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Banco de dados" value={dbPing ? "OK" : "Falha"} tone={dbPing ? "success" : "danger"} />
        <Stat label="Na fila" value={c.queued ?? 0} hint={stuck[0].n ? `${stuck[0].n} atrasada(s) — verifique o agendador` : "aguardando execução"} tone={stuck[0].n ? "warning" : undefined} />
        <Stat label="Com falha (vão repetir)" value={c.failed ?? 0} tone={c.failed ? "warning" : undefined} />
        <Stat label="Esgotadas" value={c.dead ?? 0} tone={c.dead ? "danger" : undefined} hint="precisam de ação manual" />
        <Stat label="Última execução" value={<span className="text-base">{lastRun[0].at ? formatDateTime(lastRun[0].at) : "nunca"}</span>} />
      </div>
      {integ.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Integrações com erro: {integ.map((i) => i.provider).join(", ")}. <Link href="/admin/integracoes" className="underline">Ver integrações</Link>
        </div>
      )}
      <nav className="flex gap-1 border-b border-line text-sm">
        {[["tarefas", "Tarefas"], ["webhooks", "Webhooks"], ["logs", "Logs"]].map(([k, l]) => (
          <Link key={k} href={`/admin/monitoramento?aba=${k}`} className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? "border-brand font-semibold" : "border-transparent text-muted hover:text-ink"}`}>{l}</Link>
        ))}
      </nav>
      {tab === "tarefas" && <Jobs canRetry={canRetry} />}
      {tab === "webhooks" && <Webhooks />}
      {tab === "logs" && <Logs level={sp.nivel} source={sp.fonte} />}
    </div>
  );
}

async function Jobs({ canRetry }: { canRetry: boolean }) {
  const rows = await db()<{ id: string; type: string; status: string; attempts: number; max_attempts: number; run_at: Date; last_error: string | null; updated_at: Date; payload: Record<string, unknown> }[]>`
    select id, type, status, attempts, max_attempts, run_at, last_error, updated_at, payload from public.jobs
    order by case status when 'dead' then 0 when 'failed' then 1 when 'running' then 2 when 'queued' then 3 else 4 end, updated_at desc limit 100`;
  return (
    <Table head={["Tarefa", "Status", "Tentativas", "Próxima execução", "Erro", ""]} empty={rows.length ? false : "Nenhuma tarefa registrada."}>
      {rows.map((j) => (
        <tr key={j.id}>
          <td className={td}><span className="font-medium">{JOB_LABEL[j.type] ?? j.type}</span><span className="block text-xs text-muted">{typeof j.payload.orderId === "string" ? <Link href={`/admin/pedidos/${j.payload.orderId}`} className="underline">ver pedido</Link> : j.type}</span></td>
          <td className={td}><Badge tone={j.status === "dead" ? "danger" : j.status === "failed" ? "warning" : j.status === "succeeded" ? "success" : "neutral"}>{{ queued: "Na fila", running: "Executando", succeeded: "Concluída", failed: "Falhou", dead: "Esgotada", canceled: "Cancelada" }[j.status] ?? j.status}</Badge></td>
          <td className={`${td} tabular-nums`}>{j.attempts}/{j.max_attempts}</td>
          <td className={td}>{["queued", "failed"].includes(j.status) ? formatDateTime(j.run_at) : "—"}</td>
          <td className={`${td} max-w-sm text-xs text-red-800`}>{j.last_error}</td>
          <td className={td}>
            {canRetry && (
              <div className="flex gap-1">
                {["failed", "dead", "canceled"].includes(j.status) && <form action={retryJobAction}><input type="hidden" name="jobId" value={j.id} /><Button size="sm" variant="secondary">Reexecutar</Button></form>}
                {["queued", "failed", "dead"].includes(j.status) && <form action={cancelJobAction}><input type="hidden" name="jobId" value={j.id} /><Button size="sm" variant="ghost">Cancelar</Button></form>}
              </div>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

async function Webhooks() {
  const rows = await db()<{ id: string; provider: string; event_type: string | null; resource_id: string | null; signature_valid: boolean; status: string; error: string | null; received_at: Date; attempts: number }[]>`
    select id, provider, event_type, resource_id, signature_valid, status, error, received_at, attempts from public.webhook_events order by received_at desc limit 100`;
  return (
    <Table head={["Recebido", "Origem", "Evento", "Recurso", "Assinatura", "Status", "Erro"]} empty={rows.length ? false : "Nenhum webhook recebido ainda. Após configurar o Mercado Pago, os avisos de pagamento aparecem aqui."}>
      {rows.map((w) => (
        <tr key={w.id}>
          <td className={td}>{formatDateTime(w.received_at)}</td>
          <td className={td}>{w.provider}</td>
          <td className={td}>{w.event_type ?? "—"}</td>
          <td className={`${td} font-mono text-xs`}>{w.resource_id ?? "—"}</td>
          <td className={td}><Badge tone={w.signature_valid ? "success" : "danger"}>{w.signature_valid ? "válida" : "inválida"}</Badge></td>
          <td className={td}><Badge tone={w.status === "processed" ? "success" : w.status === "failed" || w.status === "rejected" ? "danger" : "neutral"}>{w.status}</Badge></td>
          <td className={`${td} max-w-xs text-xs text-red-800`}>{w.error}</td>
        </tr>
      ))}
    </Table>
  );
}

async function Logs({ level, source }: { level?: string; source?: string }) {
  const sql = db();
  const lv = ["info", "warn", "error"].includes(level ?? "") ? level! : null;
  const src = source && /^[\w.-]{1,40}$/.test(source) ? source : null;
  const [rows, sources] = await Promise.all([
    sql<{ id: string; level: string; source: string; message: string; context: unknown; created_at: Date }[]>`
      select id, level, source, message, context, created_at from public.app_logs
      where true ${lv ? sql`and level = ${lv}` : sql``} ${src ? sql`and source = ${src}` : sql``}
      order by created_at desc limit 200`,
    sql<{ source: string }[]>`select distinct source from public.app_logs order by source`,
  ]);
  return (
    <div className="flex flex-col gap-3">
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="aba" value="logs" />
        <select name="nivel" defaultValue={lv ?? ""} className="h-9 rounded-lg border border-line bg-surface px-2"><option value="">Todos os níveis</option><option value="error">Erro</option><option value="warn">Alerta</option><option value="info">Info</option></select>
        <select name="fonte" defaultValue={src ?? ""} className="h-9 rounded-lg border border-line bg-surface px-2"><option value="">Todas as origens</option>{sources.map((s) => <option key={s.source} value={s.source}>{s.source}</option>)}</select>
        <Button size="sm" variant="secondary">Filtrar</Button>
      </form>
      <Table head={["Quando", "Nível", "Origem", "Mensagem"]} empty={rows.length ? false : "Nenhum log."}>
        {rows.map((l) => (
          <tr key={l.id}>
            <td className={`${td} whitespace-nowrap`}>{formatDateTime(l.created_at)}</td>
            <td className={td}><Badge tone={l.level === "error" ? "danger" : l.level === "warn" ? "warning" : "neutral"}>{l.level}</Badge></td>
            <td className={td}>{l.source}</td>
            <td className={`${td} text-xs`}>{l.message}{l.context != null && <details><summary className="cursor-pointer text-muted">contexto</summary><pre className="max-w-xl overflow-x-auto whitespace-pre-wrap">{JSON.stringify(l.context, null, 2)}</pre></details>}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
