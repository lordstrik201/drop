import { assertPermission } from "@/lib/auth/session";
import { ForbiddenError, type Permission } from "@/lib/auth/rbac";
import { audit } from "@/lib/audit";
import { parseRange } from "@/lib/reports/dashboard";
import { REPORTS } from "@/lib/reports/exports";
import { csvResponse, toCSV } from "@/lib/reports/csv";
import { pdfResponse, toPDF } from "@/lib/reports/pdf";

/** Exportação de relatórios: /admin/relatorios/exportar?tipo=pedidos&formato=csv|pdf&de=AAAA-MM-DD&ate=AAAA-MM-DD */
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
  const format = url.searchParams.get("formato") === "pdf" ? "pdf" : "csv";
  await audit(user, "report.export", "report", report.id, { after: { formato: format, de: range.fromStr, ate: range.toStr, linhas: rows.length } });
  const name = `${report.id}-${range.fromStr}-a-${range.toStr}`;
  if (format === "pdf") {
    const br = (d: string) => d.split("-").reverse().join("/");
    const bytes = await toPDF({ title: report.title, subtitle: `Período: ${br(range.fromStr)} a ${br(range.toStr)} · ${rows.length} linha(s) · valores em R$`, rows, columns: report.columns,
      footer: `Gerado em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date())} por ${user.email}` });
    return pdfResponse(bytes, `${name}.pdf`);
  }
  return csvResponse(toCSV(rows, report.columns), `${name}.csv`);
}
