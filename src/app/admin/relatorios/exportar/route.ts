import { assertPermission } from "@/lib/auth/session";
import { ForbiddenError, type Permission } from "@/lib/auth/rbac";
import { audit } from "@/lib/audit";
import { parseRange } from "@/lib/reports/dashboard";
import { REPORTS } from "@/lib/reports/exports";
import { csvResponse, toCSV } from "@/lib/reports/csv";

/** Exportação de relatórios: /admin/relatorios/exportar?tipo=pedidos&formato=csv&de=AAAA-MM-DD&ate=AAAA-MM-DD */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const report = REPORTS[url.searchParams.get("tipo") ?? ""];
  if (!report) return new Response("Relatório desconhecido", { status: 404 });
  let user;
  try { user = await assertPermission(report.permission as Permission); } catch (e) {
    return new Response(e instanceof ForbiddenError ? e.message : "Faça login no painel.", { status: e instanceof ForbiddenError ? 403 : 401 });
  }
  const sp = Object.fromEntries(url.searchParams);
  const range = parseRange(sp, 30);
  const rows = await report.load(range, sp);
  await audit(user, "report.export", "report", report.id, { after: { formato: "csv", de: range.fromStr, ate: range.toStr, linhas: rows.length } });
  return csvResponse(toCSV(rows, report.columns), `${report.id}-${range.fromStr}-a-${range.toStr}.csv`);
}
