import { requireStaffPage } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Pagination } from "@/components/ui";
import { DateRangeFilter, Table, td } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/ui/dates";
import { parseRange } from "@/lib/reports/dashboard";

export const metadata = { title: "Auditoria" };

type SP = { de?: string; ate?: string; acao?: string; usuario?: string; pagina?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaffPage("audit.read");
  const sp = await searchParams;
  const range = parseRange(sp, 30);
  const page = Math.max(1, Number(sp.pagina) || 1);
  const action = sp.acao?.trim().slice(0, 60) || null;
  const actor = sp.usuario?.trim().toLowerCase().slice(0, 120) || null;
  const sql = db();
  const rows = await sql<{ id: string; actor_email: string | null; action: string; entity: string; entity_id: string | null; before: unknown; after: unknown; created_at: Date; total: number }[]>`
    select id, actor_email, action, entity, entity_id, before, after, created_at, count(*) over()::int as total
    from public.audit_logs
    where created_at >= ${range.from} and created_at < ${range.to}
      ${action ? sql`and action like ${action + "%"}` : sql``}
      ${actor ? sql`and lower(actor_email) like ${"%" + actor + "%"}` : sql``}
    order by created_at desc limit 100 offset ${(page - 1) * 100}`;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "pagina") as [string, string][]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Auditoria</h1>
        <p className="text-sm text-muted">Registro imutável das ações feitas no painel (quem, quando, o quê). Credenciais nunca são gravadas aqui.</p>
      </div>
      <DateRangeFilter path="/admin/auditoria" from={range.fromStr} to={range.toStr} extra={
        <>
          <label className="flex flex-col gap-1 text-xs text-muted">Ação<input name="acao" defaultValue={action ?? ""} placeholder="ex.: order." className="h-9 w-40 rounded-lg border border-line bg-surface px-2 text-sm text-ink" /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Usuário<input name="usuario" defaultValue={actor ?? ""} placeholder="e-mail" className="h-9 w-48 rounded-lg border border-line bg-surface px-2 text-sm text-ink" /></label>
        </>
      } />
      <Table head={["Quando", "Usuário", "Ação", "Registro", "Detalhes"]} empty={rows.length ? false : "Nenhum registro no período."}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={`${td} whitespace-nowrap`}>{formatDateTime(r.created_at)}</td>
            <td className={td}>{r.actor_email ?? "sistema"}</td>
            <td className={`${td} font-mono text-xs`}>{r.action}</td>
            <td className={`${td} text-xs`}>{r.entity}{r.entity_id && <span className="block font-mono text-muted">{r.entity_id}</span>}</td>
            <td className={`${td} text-xs`}>
              {(r.before != null || r.after != null) && (
                <details><summary className="cursor-pointer text-muted">ver</summary>
                  {r.before != null && <pre className="max-w-md overflow-x-auto whitespace-pre-wrap">antes: {JSON.stringify(r.before, null, 1)}</pre>}
                  {r.after != null && <pre className="max-w-md overflow-x-auto whitespace-pre-wrap">depois: {JSON.stringify(r.after, null, 1)}</pre>}
                </details>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={rows[0]?.total ?? 0} perPage={100} hrefFor={(p) => `/admin/auditoria?${qs}&pagina=${p}`} />
    </div>
  );
}
