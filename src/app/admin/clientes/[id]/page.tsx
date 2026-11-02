import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/orders/status";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui";
import { Flash, Section, Stat } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatCEP, formatCPF, formatPhone } from "@/lib/validation/br";
import { formatDate, formatDateTime } from "@/lib/ui/dates";
import type { OrderStatus } from "@/lib/types";
import { anonymizeCustomerAction, blockCustomerAction, supportNoteAction } from "../actions";

export const metadata = { title: "Cliente" };
const NOTE_KIND: Record<string, string> = { note: "Anotação", contact: "Contato", complaint: "Reclamação", return: "Troca/devolução" };
const PRIVACY_KIND: Record<string, string> = { export: "Cópia dos dados", delete: "Exclusão dos dados", correct: "Correção", revoke_consent: "Revogar consentimento" };

export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("customers.read");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = db();
  const [p] = await sql<{ id: string; email: string; full_name: string | null; phone: string | null; cpf: string | null; birth_date: Date | null; role: string; is_blocked: boolean; marketing_consent: boolean; marketing_consent_at: Date | null; created_at: Date }[]>`
    select * from public.profiles where id = ${id}`;
  if (!p) notFound();
  const [orders, addresses, notes, privacy, messages, perms] = await Promise.all([
    sql<{ id: string; number: string; status: OrderStatus; total_cents: number; created_at: Date; paid_at: Date | null }[]>`select id, number, status, total_cents, created_at, paid_at from public.orders where profile_id = ${id} order by created_at desc`,
    sql<{ id: string; label: string | null; recipient_name: string; cep: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; is_default: boolean }[]>`select * from public.addresses where profile_id = ${id} order by is_default desc, created_at`,
    sql<{ id: string; kind: string; body: string; created_at: Date; author: string | null; order_number: string | null }[]>`
      select n.id, n.kind, n.body, n.created_at, a.email as author, o.number as order_number from public.support_notes n
      left join public.profiles a on a.id = n.author_id left join public.orders o on o.id = n.order_id where n.profile_id = ${id} order by n.created_at desc`,
    sql<{ id: string; kind: string; status: string; notes: string | null; created_at: Date }[]>`select id, kind, status, notes, created_at from public.privacy_requests where profile_id = ${id} order by created_at desc`,
    sql<{ id: string; subject: string; status: string; created_at: Date }[]>`select id, subject, status, created_at from public.contact_messages where profile_id = ${id} or lower(email) = lower(${p.email}) order by created_at desc limit 20`,
    Promise.all([can(user, "customers.write"), can(user, "customers.export")]),
  ]);
  const [canWrite, canExport] = perms;
  const paid = orders.filter((o) => o.paid_at && o.status !== "refunded");
  const spent = paid.reduce((a, o) => a + o.total_cents, 0);
  const openDelete = privacy.some((r) => r.kind === "delete" && r.status === "open");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/clientes" className="text-sm text-muted hover:text-ink">← Clientes</Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">{p.full_name ?? p.email}{p.is_blocked && <Badge tone="danger">bloqueado</Badge>}{p.role !== "customer" && <Badge tone="info">equipe</Badge>}</h1>
        <p className="text-sm text-muted">Cliente desde {formatDate(p.created_at)}</p>
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      {openDelete && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">O cliente pediu a <strong>exclusão dos dados</strong> (LGPD). Responda em até 15 dias: use “Eliminar dados pessoais” abaixo.</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pedidos pagos" value={paid.length} />
        <Stat label="Total gasto" value={formatBRL(spent)} />
        <Stat label="Ticket médio" value={paid.length ? formatBRL(Math.round(spent / paid.length)) : "—"} />
        <Stat label="Marketing" value={<span className="text-base">{p.marketing_consent ? "Autorizado" : "Não autorizado"}</span>} hint={p.marketing_consent_at ? `desde ${formatDateTime(p.marketing_consent_at)}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Section title="Pedidos">
            {orders.length === 0 ? <p className="text-sm text-muted">Nenhum pedido.</p> : (
              <ul className="divide-y divide-line text-sm">
                {orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><Link href={`/admin/pedidos/${o.id}`} className="font-semibold text-brand hover:underline">#{o.number}</Link> <span className="text-muted">· {formatDateTime(o.created_at)}</span></span>
                    <span className="flex items-center gap-2"><span className="tabular-nums">{formatBRL(o.total_cents)}</span><Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Histórico de atendimento">
            {canWrite && (
              <form action={supportNoteAction} className="mb-4 grid gap-2 sm:grid-cols-[10rem_8rem_1fr]">
                <input type="hidden" name="profileId" value={p.id} />
                <Select name="kind" defaultValue="contact">{Object.entries(NOTE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                <Input name="orderNumber" placeholder="Pedido (opc.)" inputMode="numeric" />
                <Textarea name="body" rows={2} required maxLength={4000} placeholder="O que foi tratado com o cliente" className="sm:col-span-3" />
                <div><Button size="sm" variant="secondary">Registrar</Button></div>
              </form>
            )}
            {notes.length === 0 ? <p className="text-sm text-muted">Sem registros.</p> : (
              <ul className="flex flex-col gap-3 text-sm">
                {notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-line pl-3">
                    <p className="text-xs text-muted">{formatDateTime(n.created_at)} · <Badge tone={n.kind === "complaint" ? "danger" : n.kind === "return" ? "warning" : "neutral"}>{NOTE_KIND[n.kind]}</Badge>{n.order_number && ` · pedido #${n.order_number}`} · {n.author ?? "—"}</p>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {messages.length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold uppercase text-muted">Mensagens pelo formulário de contato</h3>
                <ul className="text-sm">{messages.map((m) => <li key={m.id}><Link href={`/admin/atendimento?id=${m.id}`} className="text-brand hover:underline">{m.subject}</Link> <span className="text-xs text-muted">· {formatDateTime(m.created_at)} · {m.status}</span></li>)}</ul>
              </>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Section title="Dados">
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted">E-mail</dt><dd className="break-all"><a href={`mailto:${p.email}`} className="text-brand underline">{p.email}</a></dd>
              <dt className="text-muted">Telefone</dt><dd>{p.phone ? formatPhone(p.phone) : "—"}</dd>
              <dt className="text-muted">CPF</dt><dd>{p.cpf ? formatCPF(p.cpf) : "—"}</dd>
              <dt className="text-muted">Nascimento</dt><dd>{p.birth_date ? formatDate(p.birth_date) : "—"}</dd>
            </dl>
            {addresses.length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold uppercase text-muted">Endereços</h3>
                <ul className="flex flex-col gap-2 text-sm">{addresses.map((a) => <li key={a.id}>{a.label && <strong>{a.label}: </strong>}{a.street}, {a.number}{a.complement && ` ${a.complement}`} · {a.district} · {a.city}/{a.state} · {formatCEP(a.cep)}</li>)}</ul>
              </>
            )}
          </Section>

          <Section title="Privacidade (LGPD)">
            {privacy.length > 0 && <ul className="mb-3 text-xs">{privacy.map((r) => <li key={r.id}>{formatDate(r.created_at)} · {PRIVACY_KIND[r.kind]} · <Badge tone={r.status === "open" ? "warning" : "neutral"}>{r.status === "open" ? "aberta" : r.status === "done" ? "atendida" : "recusada"}</Badge></li>)}</ul>}
            <div className="flex flex-col gap-3">
              {canExport && <a href={`/admin/clientes/${p.id}/exportar`} className="text-sm text-brand underline">Baixar cópia dos dados (JSON)</a>}
              {canWrite && p.role === "customer" && (
                <form action={blockCustomerAction}>
                  <input type="hidden" name="profileId" value={p.id} /><input type="hidden" name="block" value={p.is_blocked ? "0" : "1"} />
                  <Button size="sm" variant="secondary">{p.is_blocked ? "Desbloquear acesso" : "Bloquear acesso"}</Button>
                </form>
              )}
              {canWrite && p.role === "customer" && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-danger">Eliminar dados pessoais</summary>
                  <form action={anonymizeCustomerAction} className="mt-2 flex flex-col gap-2 text-xs">
                    <p className="text-muted">Apaga a conta, endereços e anotações e anonimiza avaliações e mensagens. Pedidos e notas financeiras são mantidos por obrigação legal (fiscal e CDC). <strong>Não pode ser desfeito.</strong></p>
                    <input type="hidden" name="profileId" value={p.id} />
                    <Input name="note" placeholder="Motivo / protocolo do pedido do titular" maxLength={300} />
                    <Input name="confirmEmail" placeholder={`Digite ${p.email} para confirmar`} required autoComplete="off" />
                    <Button size="sm" variant="danger">Eliminar definitivamente</Button>
                  </form>
                </details>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
