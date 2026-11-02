"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { importCsv, type ImportKind, type ImportReport } from "@/lib/catalog/csv-import";
import { importSupplierProduct } from "@/lib/suppliers/sync";
import { log } from "@/lib/logger";

export type ImportState = (ImportReport & { mode: "simulacao" | "aplicado" }) | { error: string } | null;

export async function importCsvAction(_prev: ImportState, f: FormData): Promise<ImportState> {
  let u;
  try { u = await assertPermission("products.write"); } catch (e) { return { error: (e as Error).message }; }
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Escolha o arquivo CSV." };
  if (file.size > 4 * 1024 * 1024) return { error: "Arquivo maior que 4 MB: divida em partes." };
  const kind = (str(f, "kind") === "estoque" ? "estoque" : "produtos") as ImportKind;
  const apply = str(f, "mode") === "aplicar";
  const supplierId = /^[0-9a-f-]{36}$/i.test(str(f, "supplierId")) ? str(f, "supplierId") : null;
  try {
    const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
    const r = await importCsv(text, kind, { supplierId, apply, actorId: u.id });
    if (r.applied) {
      await audit(u, "products.csv_import", "product", null, { after: { kind, file: file.name, created: r.created, updated: r.updated } });
      revalidatePath("/", "layout");
    }
    return { ...r, mode: apply ? "aplicado" : "simulacao" };
  } catch (e) {
    await log("error", "import", "Falha na importação de CSV", { error: (e as Error).message });
    return { error: `Falha ao importar: ${(e as Error).message}` };
  }
}

export async function importFromApiAction(f: FormData) {
  return runAdmin("/admin/produtos/importar", async () => {
    const u = await assertPermission("products.write");
    const ref = str(f, "externalId");
    if (!ref) throw new Error("Informe o ID ou SKU do produto no fornecedor.");
    const r = await importSupplierProduct(str(f, "supplierId"), ref, u.id);
    await audit(u, "product.import_api", "product", r.productId, { after: { supplierId: str(f, "supplierId"), ref, created: r.created } });
    redirect(`/admin/produtos/${r.productId}?ok=${encodeURIComponent(r.created ? "Produto importado como rascunho. Revise textos e fotos, defina o preço e ative." : "Produto já existia: custo e estoque atualizados.")}`);
  });
}
