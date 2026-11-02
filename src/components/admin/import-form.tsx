"use client";

import { useActionState } from "react";
import { importCsvAction, type ImportState } from "@/app/admin/produtos/importar/actions";

export function CsvImportForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importCsvAction, null);
  const sel = "h-10 rounded-lg border border-line bg-surface px-3 text-sm";
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1"><span className="font-medium">Tipo</span>
            <select name="kind" className={sel} defaultValue="produtos"><option value="produtos">Produtos e variações</option><option value="estoque">Somente estoque e custo</option></select>
          </label>
          <label className="flex flex-col gap-1"><span className="font-medium">Fornecedor (para produtos)</span>
            <select name="supplierId" className={sel} defaultValue=""><option value="">Selecione…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1"><span className="font-medium">Arquivo CSV</span><input type="file" name="file" accept=".csv,text/csv" required className="text-sm" /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button name="mode" value="simular" disabled={pending} className="h-9 rounded-lg border border-line bg-surface px-3 font-medium hover:bg-bg disabled:opacity-50">{pending ? "Processando…" : "Simular (não grava)"}</button>
          <button name="mode" value="aplicar" disabled={pending} className="h-9 rounded-lg bg-brand px-3 font-semibold text-brand-contrast disabled:opacity-50">Importar</button>
        </div>
      </form>
      {state && "error" in state && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p>}
      {state && "rows" in state && (
        <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
          <p className="font-semibold">
            {state.ok
              ? state.mode === "aplicado" ? `Importado: ${state.created} produto(s) novo(s), ${state.updated} atualizado(s).` : `Simulação sem erros: ${state.created} produto(s) seriam criados e ${state.updated} atualizados. Clique em Importar para gravar.`
              : `${state.errors.length} erro(s) encontrados em ${state.rows} linha(s). Nada foi gravado.`}
          </p>
          {state.warnings.map((w, i) => <p key={i} className="text-xs">{w}</p>)}
          {state.errors.length > 0 && <ul className="mt-1 max-h-64 overflow-y-auto text-xs">{state.errors.slice(0, 200).map((e, i) => <li key={i}>Linha {e.line}: {e.message}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
