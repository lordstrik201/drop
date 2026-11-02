import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Badge, LinkButton, Stars } from "@/components/ui";
import { Flash, Table, td } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/ui/dates";
import { INTEGRATION_LABEL } from "@/lib/suppliers/admin";

export const metadata = { title: "Fornecedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("suppliers.read");
  const sp = await searchParams;
  const [rows, canWrite] = await Promise.all([
    db()<{ id: string; name: string; integration_type: string; integration_status: string; is_active: boolean; requires_manual_approval: boolean; internal_rating: number | null; last_sync_at: Date | null; products: number; open_orders: number; issues: number }[]>`
      select s.id, s.name, s.integration_type, s.integration_status, s.is_active, s.requires_manual_approval, s.internal_rating, s.last_sync_at,
             (select count(*)::int from public.products p where p.supplier_id = s.id and p.status = 'active') as products,
             (select count(*)::int from public.supplier_orders so where so.supplier_id = s.id and so.status in ('awaiting_approval','pending','failed','submitting')) as open_orders,
             (select count(*)::int from public.supplier_issues i where i.supplier_id = s.id and i.status = 'open') as issues
      from public.suppliers s order by s.is_active desc, s.name`,
    can(user, "suppliers.write"),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Fornecedores</h1>
        {canWrite && <LinkButton href="/admin/fornecedores/novo" size="sm">Novo fornecedor</LinkButton>}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      <Table head={["Fornecedor", "Integração", "Produtos ativos", "A encaminhar", "Ocorrências", "Avaliação", "Última sincronização"]} empty={rows.length ? false : "Nenhum fornecedor cadastrado."}>
        {rows.map((s) => (
          <tr key={s.id} className={s.is_active ? "" : "opacity-60"}>
            <td className={td}><Link href={`/admin/fornecedores/${s.id}`} className="font-medium text-brand hover:underline">{s.name}</Link>{!s.is_active && <Badge className="ml-2">inativo</Badge>}{s.requires_manual_approval && <span className="block text-xs text-muted">aprovação manual</span>}</td>
            <td className={td}>{INTEGRATION_LABEL[s.integration_type] ?? s.integration_type}{s.integration_type === "cj" && <Badge tone={s.integration_status === "connected" ? "success" : s.integration_status === "error" ? "danger" : "warning"} className="ml-2">{s.integration_status === "connected" ? "conectado" : s.integration_status === "error" ? "erro" : "não testado"}</Badge>}</td>
            <td className={`${td} tabular-nums`}>{s.products}</td>
            <td className={`${td} tabular-nums`}>{s.open_orders ? <Link href={`/admin/encaminhamento?fornecedor=${s.id}`} className="font-semibold text-warning underline">{s.open_orders}</Link> : 0}</td>
            <td className={`${td} tabular-nums ${s.issues ? "font-semibold text-danger" : ""}`}>{s.issues}</td>
            <td className={td}>{s.internal_rating ? <Stars value={s.internal_rating} /> : "—"}</td>
            <td className={td}>{s.last_sync_at ? formatDateTime(s.last_sync_at) : "—"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
