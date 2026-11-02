import { requireStaffPage, loadPermissionMap } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/auth/rbac";
import { Badge, Button, Input, Select } from "@/components/ui";
import { Flash, Section, Table, td } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/ui/dates";
import type { AppRole } from "@/lib/types";
import { setRoleAction } from "./actions";

export const metadata = { title: "Usuários" };

const ROLE_HELP: Record<string, string> = {
  admin: "Acesso total, inclusive usuários e credenciais.",
  manager: "Tudo, exceto usuários e credenciais de integração.",
  support: "Clientes, atendimento, avaliações e acompanhamento de pedidos.",
  operator: "Catálogo, fornecedores, pedidos, encaminhamento e envio.",
};

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("users.manage");
  const sp = await searchParams;
  const [staff, map, perms] = await Promise.all([
    db()<{ id: string; email: string; full_name: string | null; role: AppRole; is_blocked: boolean; last_action: Date | null }[]>`
      select p.id, p.email, p.full_name, p.role, p.is_blocked, (select max(created_at) from public.audit_logs a where a.actor_id = p.id) as last_action
      from public.profiles p where p.role <> 'customer' order by p.role, p.email`,
    loadPermissionMap(),
    db()<{ code: string; description: string }[]>`select code, description from public.permissions order by code`,
  ]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Usuários e permissões</h1>
        <p className="text-sm text-muted">Para dar acesso, a pessoa cria a conta na loja e você atribui um papel aqui. Toda alteração fica na auditoria.</p>
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      <Section title="Dar acesso ao painel">
        <form action={setRoleAction} className="flex flex-wrap items-end gap-2">
          <Input name="email" type="email" required placeholder="email@da.pessoa" className="w-72" />
          <Select name="role" defaultValue="operator" className="w-48">{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
          <Button size="sm">Conceder acesso</Button>
        </form>
      </Section>
      <Table head={["Usuário", "Papel", "Última ação no painel", "Alterar"]}>
        {staff.map((s) => (
          <tr key={s.id}>
            <td className={td}><span className="font-medium">{s.full_name ?? s.email}</span><span className="block text-xs text-muted">{s.email}</span>{s.is_blocked && <Badge tone="danger">bloqueado</Badge>}</td>
            <td className={td}><Badge tone={s.role === "admin" ? "brand" : "neutral"}>{ROLE_LABELS[s.role]}</Badge></td>
            <td className={td}>{s.last_action ? formatDateTime(s.last_action) : "—"}</td>
            <td className={td}>
              {s.id === user.id ? <span className="text-xs text-muted">você</span> : (
                <form action={setRoleAction} className="flex gap-2">
                  <input type="hidden" name="profileId" value={s.id} />
                  <Select name="role" defaultValue={s.role} className="h-8 w-40 text-xs">{[...STAFF_ROLES, "customer" as AppRole].map((r) => <option key={r} value={r}>{r === "customer" ? "Remover acesso" : ROLE_LABELS[r]}</option>)}</Select>
                  <Button size="sm" variant="secondary">Salvar</Button>
                </form>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <Section title="O que cada papel pode fazer">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="py-1 pr-2">Permissão</th>{STAFF_ROLES.map((r) => <th key={r} className="px-2 py-1 text-center">{ROLE_LABELS[r]}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {perms.map((p) => (
                <tr key={p.code}><td className="py-1 pr-2">{p.description} <span className="text-muted">({p.code})</span></td>{STAFF_ROLES.map((r) => <td key={r} className="px-2 py-1 text-center">{map.get(r)?.has(p.code) ? "✓" : ""}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 text-xs text-muted">{STAFF_ROLES.map((r) => <li key={r}><strong>{ROLE_LABELS[r]}:</strong> {ROLE_HELP[r]}</li>)}</ul>
      </Section>
    </div>
  );
}
