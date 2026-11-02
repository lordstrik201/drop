import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Badge, Pagination } from "@/components/ui";
import { Flash, Table, td } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/ui/dates";

export const metadata = { title: "Clientes" };
type SP = { q?: string; filtro?: string; pagina?: string; ok?: string; erro?: string };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireStaffPage("customers.read");
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase().slice(0, 100) || null;
  const filter = ["compradores", "marketing", "bloqueados"].includes(sp.filtro ?? "") ? sp.filtro! : null;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const sql = db();
  const canExport = await can(user, "customers.export");
  const rows = await sql<{ id: string; email: string; full_name: string | null; phone: string | null; created_at: Date; is_blocked: boolean; marketing_consent: boolean; orders: number; spent: number; last_order: Date | null; total: number }[]>`
    with c as (
      select p.id, p.email, p.full_name, p.phone, p.created_at, p.is_blocked, p.marketing_consent,
             count(o.id) filter (where o.paid_at is not null)::int as orders,
             coalesce(sum(o.total_cents) filter (where o.paid_at is not null and o.status <> 'refunded'), 0)::int as spent,
             max(o.created_at) as last_order
      from public.profiles p left join public.orders o on o.profile_id = p.id
      where p.role = 'customer'
        ${q ? sql`and (lower(p.email) like ${"%" + q + "%"} or lower(coalesce(p.full_name, '')) like ${"%" + q + "%"} or p.phone like ${"%" + q.replace(/\D/g, "") + "%"} and ${q.replace(/\D/g, "").length >= 4})` : sql``}
        ${filter === "marketing" ? sql`and p.marketing_consent` : filter === "bloqueados" ? sql`and p.is_blocked` : sql``}
      group by p.id
    )
    select *, count(*) over()::int as total from c
    ${filter === "compradores" ? sql`where orders > 0` : sql``}
    order by ${filter === "compradores" ? sql`spent desc` : sql`created_at desc`}
    limit 50 offset ${(page - 1) * 50}`;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["pagina", "ok", "erro"].includes(k)) as [string, string][]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Clientes</h1>
        {canExport && (
          <span className="flex gap-3 text-sm">
            {/* downloads de arquivo (rotas de API), não navegação: <a> é o correto */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/admin/clientes/exportar" className="text-brand underline">Exportar CSV</a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/admin/clientes/exportar?consentimento=1" className="text-brand underline" title="Somente clientes que autorizaram receber marketing">Exportar lista de marketing (com consentimento)</a>
          </span>
        )}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Nome, e-mail ou telefone" className="h-9 w-64 rounded-lg border border-line bg-surface px-2" />
        <select name="filtro" defaultValue={filter ?? ""} className="h-9 rounded-lg border border-line bg-surface px-2">
          <option value="">Todos</option><option value="compradores">Compradores (por valor gasto)</option><option value="marketing">Aceitam marketing</option><option value="bloqueados">Bloqueados</option>
        </select>
        <button className="h-9 rounded-lg bg-brand px-3 font-semibold text-brand-contrast">Buscar</button>
      </form>
      <Table head={["Cliente", "Cadastro", "Pedidos pagos", "Total gasto", "Último pedido", ""]} empty={rows.length ? false : "Nenhum cliente encontrado."}>
        {rows.map((c) => (
          <tr key={c.id} className="hover:bg-bg/60">
            <td className={td}><Link href={`/admin/clientes/${c.id}`} className="font-medium text-brand hover:underline">{c.full_name ?? "(sem nome)"}</Link><span className="block text-xs text-muted">{c.email}</span></td>
            <td className={td}>{formatDate(c.created_at)}</td>
            <td className={`${td} tabular-nums`}>{c.orders}</td>
            <td className={`${td} tabular-nums`}>{formatBRL(c.spent)}</td>
            <td className={td}>{c.last_order ? formatDate(c.last_order) : "—"}</td>
            <td className={td}><span className="flex gap-1">{c.is_blocked && <Badge tone="danger">bloqueado</Badge>}{c.marketing_consent && <Badge tone="info">marketing</Badge>}</span></td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={rows[0]?.total ?? 0} perPage={50} hrefFor={(p) => `/admin/clientes?${qs}&pagina=${p}`} />
    </div>
  );
}
