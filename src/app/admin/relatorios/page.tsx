import { requireStaffPage, can } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/rbac";
import { REPORTS } from "@/lib/reports/exports";
import { parseRange } from "@/lib/reports/dashboard";
import { DateRangeFilter, Section } from "@/components/admin/ui";

export const metadata = { title: "Relatórios" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string }> }) {
  const user = await requireStaffPage("reports.read");
  const sp = await searchParams;
  const range = parseRange(sp, 30);
  const allowed = await Promise.all(Object.values(REPORTS).map(async (r) => ((await can(user, r.permission as Permission)) ? r : null)));
  const reports = allowed.filter((r) => r !== null);
  const canCustomers = await can(user, "customers.read");
  const q = `de=${range.fromStr}&ate=${range.toStr}`;
  const link = "rounded-lg border border-line px-3 py-1.5 text-sm font-medium hover:bg-bg";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Relatórios</h1>
          <p className="text-sm text-muted">Escolha o período e baixe em CSV (Excel, separador “;”) ou PDF. Cada download fica registrado na auditoria.</p>
        </div>
        <DateRangeFilter path="/admin/relatorios" from={range.fromStr} to={range.toStr} />
      </div>
      <Section>
        <ul className="divide-y divide-line">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-semibold">{r.title}</div>
                <div className="text-sm text-muted">{r.description}</div>
              </div>
              <div className="flex gap-2">
                <a href={`/admin/relatorios/exportar?tipo=${r.id}&formato=csv&${q}`} download className={link}>CSV</a>
                <a href={`/admin/relatorios/exportar?tipo=${r.id}&formato=pdf&${q}`} download className={link}>PDF</a>
              </div>
            </li>
          ))}
          {canCustomers && (
            <li className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-semibold">Clientes</div>
                <div className="text-sm text-muted">Cadastro e totais de compra. A versão “com consentimento” traz só quem aceitou comunicações (LGPD).</div>
              </div>
              <div className="flex gap-2">
                <a href="/admin/clientes/exportar" download className={link}>CSV</a>
                <a href="/admin/clientes/exportar?consentimento=1" download className={link}>CSV com consentimento</a>
              </div>
            </li>
          )}
        </ul>
      </Section>
    </div>
  );
}
