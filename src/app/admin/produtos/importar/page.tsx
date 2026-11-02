import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Button, inputClass } from "@/components/ui";
import { Flash, Section } from "@/components/admin/ui";
import { CsvImportForm } from "@/components/admin/import-form";
import { formatDateTime } from "@/lib/ui/dates";
import { importFromApiAction } from "./actions";

export const metadata = { title: "Importar produtos" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireStaffPage("products.write");
  const sp = await searchParams;
  const sql = db();
  const [suppliers, runs] = await Promise.all([
    sql<{ id: string; name: string; integration_type: string }[]>`select id, name, integration_type from public.suppliers where is_active order by name`,
    sql<{ id: string; kind: string; status: string; stats: Record<string, unknown>; error: string | null; started_at: Date; supplier: string | null }[]>`
      select r.id, r.kind, r.status, r.stats, r.error, r.started_at, s.name as supplier from public.sync_runs r left join public.suppliers s on s.id = r.supplier_id
      order by r.started_at desc limit 15`,
  ]);
  const apiSuppliers = suppliers.filter((s) => s.integration_type === "cj");
  return (
    <div className="flex flex-col gap-4">
      <div><Link href="/admin/produtos" className="text-sm text-muted hover:text-ink">← Produtos</Link><h1 className="text-2xl font-bold">Importar produtos</h1></div>
      <Flash msg={sp.ok} error={sp.erro} />
      <Section title="Planilha (CSV)">
        <p className="mb-3 text-sm text-muted">
          Para fornecedores sem API ou cadastro em massa. Baixe o modelo:{" "}
          <a href="/admin/produtos/importar/modelo?tipo=produtos" download className="text-brand underline">produtos</a> ·{" "}
          <a href="/admin/produtos/importar/modelo?tipo=estoque" download className="text-brand underline">estoque</a>.
          Valores em reais com vírgula (129,90). Produtos novos entram como rascunho. Use “Simular” primeiro: se houver qualquer erro, nada é gravado.
        </p>
        <CsvImportForm suppliers={suppliers} />
      </Section>
      <Section title="Pela API do fornecedor">
        {apiSuppliers.length === 0 ? (
          <p className="text-sm text-muted">Nenhum fornecedor com API configurado. Cadastre um fornecedor do tipo CJdropshipping em <Link href="/admin/fornecedores" className="text-brand underline">Fornecedores</Link> e a API key em <Link href="/admin/integracoes" className="text-brand underline">Integrações</Link>.</p>
        ) : (
          <form action={importFromApiAction} className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col gap-1"><span className="font-medium">Fornecedor</span><select name="supplierId" className={inputClass}>{apiSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="font-medium">ID (pid) ou SKU do produto na CJ</span><input name="externalId" required maxLength={120} placeholder="ex.: sku:CJ1234567 ou o pid" className={`${inputClass} w-80`} /></label>
            <Button size="sm">Importar como rascunho</Button>
          </form>
        )}
      </Section>
      <Section title="Últimas importações e sincronizações">
        {runs.length === 0 ? <p className="text-sm text-muted">Nenhuma ainda.</p> : (
          <ul className="flex flex-col gap-1 text-xs">
            {runs.map((r) => <li key={r.id}>{formatDateTime(r.started_at)} · {r.supplier ?? "—"} · {r.kind} · <strong className={r.status === "failed" ? "text-danger" : r.status === "partial" ? "text-warning" : ""}>{r.status}</strong> · {Object.entries(r.stats).filter(([k]) => k !== "errors").map(([k, v]) => `${k}: ${String(v)}`).join(", ")}{r.error && <span className="block text-danger">{r.error}</span>}</li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}
