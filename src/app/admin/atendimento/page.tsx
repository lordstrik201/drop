import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Badge, Button, Input } from "@/components/ui";
import { Flash, Table, td } from "@/components/admin/ui";
import { formatDateTime, nowMs } from "@/lib/ui/dates";
import { formatPhone } from "@/lib/validation/br";
import { contactStatusAction, privacyRequestStatusAction } from "./actions";

export const metadata = { title: "Atendimento" };
const ST: Record<string, [string, "warning" | "info" | "neutral"]> = { new: ["Nova", "warning"], in_progress: ["Em atendimento", "info"], resolved: ["Resolvida", "neutral"] };
const PRIVACY_KIND: Record<string, string> = { export: "Cópia dos dados", delete: "Exclusão dos dados", correct: "Correção de dados", revoke_consent: "Revogar consentimento" };

type SP = { aba?: string; status?: string; id?: string; ok?: string; erro?: string };

export default async function SupportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireStaffPage("customers.read");
  const sp = await searchParams;
  const tab = sp.aba === "lgpd" ? "lgpd" : "mensagens";
  const canWrite = await can(user, "customers.write");
  const sql = db();
  const [counts] = await sql<{ msgs: number; lgpd: number; overdue: number }[]>`
    select (select count(*)::int from public.contact_messages where status <> 'resolved') as msgs,
           (select count(*)::int from public.privacy_requests where status = 'open') as lgpd,
           (select count(*)::int from public.privacy_requests where status = 'open' and created_at < now() - interval '10 days') as overdue`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Atendimento</h1>
      <Flash msg={sp.ok} error={sp.erro} />
      {counts.overdue > 0 && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{counts.overdue} solicitação(ões) LGPD abertas há mais de 10 dias. O prazo de resposta ao titular é de 15 dias.</div>}
      <nav className="flex gap-1 border-b border-line text-sm">
        <Link href="/admin/atendimento" className={`-mb-px border-b-2 px-3 py-2 ${tab === "mensagens" ? "border-brand font-semibold" : "border-transparent text-muted"}`}>Mensagens ({counts.msgs})</Link>
        <Link href="/admin/atendimento?aba=lgpd" className={`-mb-px border-b-2 px-3 py-2 ${tab === "lgpd" ? "border-brand font-semibold" : "border-transparent text-muted"}`}>Solicitações LGPD ({counts.lgpd})</Link>
      </nav>
      {tab === "mensagens" ? <Messages sp={sp} canWrite={canWrite} /> : <Privacy canWrite={canWrite} />}
    </div>
  );
}

async function Messages({ sp, canWrite }: { sp: SP; canWrite: boolean }) {
  const sql = db();
  const status = sp.status && sp.status in ST ? sp.status : null;
  const rows = await sql<{ id: string; name: string; email: string; phone: string | null; order_number: string | null; subject: string; message: string; status: string; created_at: Date; profile_id: string | null; order_id: string | null }[]>`
    select m.*, o.id as order_id from public.contact_messages m left join public.orders o on o.number = m.order_number
    where ${status ? sql`m.status = ${status}` : sql`m.status <> 'resolved' or m.id::text = ${sp.id ?? ""}`}
    order by m.created_at desc limit 100`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 text-sm">
        {[[null, "Abertas"], ["new", "Novas"], ["in_progress", "Em atendimento"], ["resolved", "Resolvidas"]].map(([k, l]) => (
          <Link key={l} href={`/admin/atendimento${k ? `?status=${k}` : ""}`} className={`rounded-full border px-3 py-1 ${status === k ? "border-brand bg-brand/10" : "border-line"}`}>{l}</Link>
        ))}
      </div>
      {rows.length === 0 && <p className="py-8 text-center text-sm text-muted">Nenhuma mensagem.</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((m) => (
          <li key={m.id} id={m.id} className={`rounded-xl border bg-surface p-4 ${sp.id === m.id ? "border-brand" : "border-line"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{m.subject}</strong>
              <Badge tone={ST[m.status][1]}>{ST[m.status][0]}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted">
              {formatDateTime(m.created_at)} · {m.profile_id ? <Link href={`/admin/clientes/${m.profile_id}`} className="underline">{m.name}</Link> : m.name} · <a href={`mailto:${m.email}?subject=${encodeURIComponent("Re: " + m.subject)}`} className="underline">{m.email}</a>
              {m.phone && ` · ${formatPhone(m.phone)}`}
              {m.order_number && <> · pedido {m.order_id ? <Link href={`/admin/pedidos/${m.order_id}`} className="underline">#{m.order_number}</Link> : `#${m.order_number} (não encontrado)`}</>}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{m.message}</p>
            {canWrite && (
              <div className="mt-3 flex gap-2">
                {(["in_progress", "resolved", "new"] as const).filter((s) => s !== m.status).map((s) => (
                  <form key={s} action={contactStatusAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value={s} /><Button size="sm" variant={s === "resolved" ? "primary" : "secondary"}>{s === "resolved" ? "Marcar resolvida" : s === "in_progress" ? "Em atendimento" : "Reabrir"}</Button></form>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">A resposta ao cliente é feita pelo seu e-mail (link no endereço). Registre o contato na ficha do cliente para manter o histórico.</p>
    </div>
  );
}

async function Privacy({ canWrite }: { canWrite: boolean }) {
  const rows = await db()<{ id: string; profile_id: string | null; email: string; kind: string; status: string; notes: string | null; created_at: Date; resolved_at: Date | null }[]>`
    select * from public.privacy_requests order by (status = 'open') desc, created_at desc limit 200`;
  return (
    <Table head={["Recebida", "Titular", "Pedido", "Status", "Observações", ""]} empty={rows.length ? false : "Nenhuma solicitação."}>
      {rows.map((r) => {
        const days = Math.floor((nowMs() - new Date(r.created_at).getTime()) / 86400000);
        return (
          <tr key={r.id}>
            <td className={td}>{formatDateTime(r.created_at)}{r.status === "open" && <span className={`block text-xs ${days >= 10 ? "text-danger" : "text-muted"}`}>há {days} dia(s)</span>}</td>
            <td className={td}>{r.profile_id ? <Link href={`/admin/clientes/${r.profile_id}`} className="text-brand underline">{r.email}</Link> : r.email}</td>
            <td className={td}>{PRIVACY_KIND[r.kind]}</td>
            <td className={td}><Badge tone={r.status === "open" ? "warning" : "neutral"}>{r.status === "open" ? "Aberta" : r.status === "done" ? "Atendida" : "Recusada"}</Badge></td>
            <td className={`${td} max-w-xs whitespace-pre-wrap text-xs`}>{r.notes}</td>
            <td className={td}>
              {canWrite && r.status === "open" && (r.kind === "delete" || r.kind === "export"
                ? r.profile_id && <Link href={`/admin/clientes/${r.profile_id}`} className="text-sm text-brand underline">{r.kind === "delete" ? "Atender na ficha" : "Gerar cópia na ficha"}</Link>
                : (
                  <form action={privacyRequestStatusAction} className="flex flex-col gap-1">
                    <input type="hidden" name="id" value={r.id} />
                    <Input name="note" placeholder="Observação (obrigatória para recusar)" className="h-8 text-xs" maxLength={500} />
                    <span className="flex gap-1">
                      <Button size="sm" name="status" value="done">Atendida</Button>
                      <Button size="sm" variant="secondary" name="status" value="rejected">Recusar</Button>
                    </span>
                  </form>
                ))}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}
