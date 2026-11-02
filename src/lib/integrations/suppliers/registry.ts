import type { IntegrationType } from "@/lib/types";
import { manualAdapter } from "./manual";
import { cjAdapter } from "./cj";
import type { SupplierAdapter } from "./types";

const adapters: Partial<Record<IntegrationType, SupplierAdapter>> = {
  manual: manualAdapter,
  csv: manualAdapter,
  cj: cjAdapter(),
  // Dropi: sem documentação pública oficial da API (nov/2026) → operação manual/CSV.
  dropi: manualAdapter,
};

/** Permite registrar conectores (ex.: CJ) e substituí-los em testes. */
export function registerSupplierAdapter(type: IntegrationType, adapter: SupplierAdapter) {
  adapters[type] = adapter;
}

export function getSupplierAdapter(type: IntegrationType): SupplierAdapter {
  return adapters[type] ?? manualAdapter;
}
