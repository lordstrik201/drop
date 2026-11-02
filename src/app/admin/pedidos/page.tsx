import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/orders/status";
import { Badge, Pagination } from "@/components/ui";
import { DateRangeFilter, Table, td } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/ui/dates";
import { parseRange } from "@/lib/reports/dashboard";
import type { OrderStatus } from "@/lib/types";

type SP = { status?: string; q?: string; de?: string; ate?: string; pagina?: string };

export default async function OrdersAdmin({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaffPage("orders.read");
  const sp = await searchParams;
  const range = parseRange(sp, 90);
  const status = sp.status && sp.status in ORDER_STATUS_LABELS ? (sp.status as OrderStatus) : null;
  const q = sp.q?.trim().slice(0, 100) || null;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const sql = db();
  const conds = [sql`o.created_at >= ${range.from} and o.created_at < ${range.to}`];
  if (status) conds.push(sql`o.status = ${status}`);
  if (q) conds.push(/^\d+$/.test(q) ? sql`o.number = ${Number(q)}` : sql`(lower(o.customer_email) like ${"%" + q.toLowerCase() + "%"} or lower(o.customer_name) like ${"%" + q.toLowerCase() + "%"})`);
  const where = conds.reduce((a, c) => sql`${a} and ${c}`);
  const rows = await sql<{ id: string; number: string; created_at: Date; customer_name: string; customer_email: string; status: OrderStatus; total_cents: number; items: number; requires_manual_approval: boolean; total: number }[]>`
    select o.id, o.number, o.created_at, o.customer_name, o.customer_email, o.status, o.total_cents, o.requires_manual_approval,
           (select sum(quantity)::int from public.order_items i where i.order_id = o.id) as items, count(*) over()::int as total
    from public.orders o where ${where} order by o.created_at desc limit 50 offset ${(page - 1) * 50}`;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "pagina") as [string, string][]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <a href={`/admin/relatorios/exportar?tipo=pedidos&formato=csv&de=${range.fromStr}&ate=${range.toStr}${status ? `&status=${status}` : ""}`} className="text-sm text-brand underline">Exportar CSV</a>
      </div>
      <DateRangeFilter path="/admin/pedidos" from={range.fromStr} to={range.toStr} extra={
        <>
          <label className="flex flex-col gap-1 text-xs text-muted">Status
            <select name="status" defaultValue={status ?? ""} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink">
              <option value="">Todos</option>{Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Busca<input name="q" defaultValue={q ?? ""} placeholder="Nº, nome ou e-mail" className="h-9 w-48 rounded-lg border border-line bg-surface px-2 text-sm text-ink" /></label>
        </>
      } />
      <Table head={["Pedido", "Data", "Cliente", "Itens", "Total", "Status"]} empty={rows.length ? false : "Nenhum pedido encontrado com esses filtros."}>
        {rows.map((o) => (
          <tr key={o.id} className="hover:bg-bg/60">
            <td className={td}><Link href={`/admin/pedidos/${o.id}`} className="font-semibold text-brand hover:underline">#{o.number}</Link></td>
            <td className={td}>{formatDateTime(o.created_at)}</td>
            <td className={td}><span className="block">{o.customer_name}</span><span className="text-xs text-muted">{o.customer_email}</span></td>
            <td className={td}>{o.items}</td>
            <td className={`${td} font-semibold tabular-nums`}>{formatBRL(o.total_cents)}</td>
            <td className={td}><Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>{o.status === "awaiting_supplier" && o.requires_manual_approval && <span className="ml-1 text-xs text-warning">aprovar</span>}</td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={rows[0]?.total ?? 0} perPage={50} hrefFor={(p) => `/admin/pedidos?${qs}&pagina=${p}`} />
    </div>
  );
}
