import { db, type Tx } from "@/lib/db/client";
import { getSupplierAdapter } from "@/lib/integrations/suppliers/registry";
import { SupplierError, type ImportedProduct } from "@/lib/integrations/suppliers/types";
import { setVariantStock } from "@/lib/catalog/admin";
import { slugify } from "@/lib/validation/br";
import { log } from "@/lib/logger";
import type { IntegrationType } from "@/lib/types";

type Supplier = { id: string; name: string; integration_type: IntegrationType; integration_config: Record<string, unknown>; is_active: boolean };

async function loadSupplier(id: string): Promise<Supplier> {
  const [s] = await db()<Supplier[]>`select id, name, integration_type, integration_config, is_active from public.suppliers where id = ${id}`;
  if (!s) throw new Error("Fornecedor não encontrado.");
  return s;
}

async function startRun(supplierId: string, kind: string, actorId: string | null) {
  const [r] = await db()<{ id: string }[]>`insert into public.sync_runs (supplier_id, kind, triggered_by) values (${supplierId}, ${kind}, ${actorId}) returning id`;
  return r.id;
}
async function finishRun(id: string, status: "succeeded" | "partial" | "failed", stats: Record<string, unknown>, error?: string | null) {
  await db()`update public.sync_runs set status = ${status}, stats = ${db().json(stats as never)}, error = ${error ?? null}, finished_at = now() where id = ${id}`;
}

/**
 * Importa um produto do fornecedor como RASCUNHO (nunca publica sozinho): o
 * lojista revisa nome, descrição, fotos e define o preço de venda antes de ativar.
 */
export async function importSupplierProduct(supplierId: string, externalId: string, actorId: string | null): Promise<{ productId: string; created: boolean }> {
  const s = await loadSupplier(supplierId);
  const adapter = getSupplierAdapter(s.integration_type);
  if (!adapter.fetchProduct) throw new Error(`O fornecedor ${s.name} não tem importação por API. Use a importação por CSV.`);
  const run = await startRun(supplierId, "import", actorId);
  try {
    const p = await adapter.fetchProduct(externalId, s.integration_config ?? {});
    const r = await upsertImported(s, p, actorId);
    await finishRun(run, "succeeded", { externalId, productId: r.productId, created: r.created, variants: p.variants.length });
    await db()`update public.suppliers set last_sync_at = now() where id = ${supplierId}`;
    return r;
  } catch (e) {
    await finishRun(run, "failed", { externalId }, (e as Error).message);
    throw e;
  }
}

async function upsertImported(s: Supplier, p: ImportedProduct, actorId: string | null) {
  return db().begin(async (tx: Tx) => {
    const [existing] = await tx<{ id: string }[]>`select id from public.products where supplier_id = ${s.id} and supplier_product_ref = ${p.externalId}`;
    if (existing) {
      await applySupplierData(tx, existing.id, p, s.integration_type, actorId);
      return { productId: existing.id, created: false };
    }
    const base = slugify(p.name).slice(0, 90) || "produto";
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.products where slug like ${base + "%"}`;
    const slug = n ? `${base}-${n + 1}` : base;
    const sku = (p.variants[0]?.sku && p.variants.length === 1 ? p.variants[0].sku : `${s.integration_type.toUpperCase()}-${p.externalId}`).slice(0, 60);
    const [prod] = await tx<{ id: string }[]>`
      insert into public.products (name, slug, sku, description, supplier_id, supplier_product_ref, status, cost_cents, shipping_cost_cents, price_cents)
      values (${p.name.slice(0, 200)}, ${slug}, ${sku}, ${p.description}, ${s.id}, ${p.externalId}, 'draft', ${p.costCents}, ${p.shippingCostCents ?? 0}, 0)
      returning id`;
    for (const [i, url] of p.images.slice(0, 15).entries()) {
      await tx`insert into public.product_images (product_id, url, position) values (${prod.id}, ${url}, ${i})`;
    }
    const variants = p.variants.length ? p.variants : [{ externalId: p.externalId, sku, title: "Padrão", options: {}, costCents: p.costCents, stock: null, image: null }];
    for (const [i, v] of variants.entries()) {
      const vsku = variants.length === 1 ? sku : v.sku.slice(0, 60);
      const [ins] = await tx<{ id: string }[]>`
        insert into public.product_variants (product_id, sku, title, options, supplier_variant_ref, cost_cents, stock_quantity, stock_updated_at, image_url, position)
        values (${prod.id}, ${vsku}, ${v.title.slice(0, 120)}, ${tx.json(v.options)}, ${v.externalId}, ${v.costCents !== p.costCents ? v.costCents : null},
                ${v.stock ?? 0}, now(), ${v.image ?? null}, ${i})
        returning id`;
      await tx`insert into public.stock_history (variant_id, previous_quantity, new_quantity, source) values (${ins.id}, null, ${v.stock ?? 0}, ${"import:" + s.integration_type})`;
    }
    await tx`insert into public.price_history (product_id, cost_cents, shipping_cost_cents, price_cents, source, changed_by, acknowledged_at)
             values (${prod.id}, ${p.costCents}, ${p.shippingCostCents ?? 0}, 0, ${"import:" + s.integration_type}, ${actorId}, now())`;
    return { productId: prod.id, created: true };
  });
}

/**
 * Aplica custo e estoque vindos do fornecedor. NÃO altera o preço de venda:
 * mudança de custo gera alerta para revisão do lojista (o preço é decisão dele).
 */
async function applySupplierData(tx: Tx, productId: string, p: ImportedProduct, source: string, actorId: string | null) {
  const [prod] = await tx<{ cost_cents: number; shipping_cost_cents: number; price_cents: number; promo_price_cents: number | null; status: string }[]>`
    select cost_cents, shipping_cost_cents, price_cents, promo_price_cents, status from public.products where id = ${productId} for update`;
  let costChanged = 0, stockChanged = 0, missing = 0;
  if (p.costCents > 0 && p.costCents !== prod.cost_cents) {
    await tx`update public.products set cost_cents = ${p.costCents} where id = ${productId}`;
    await tx`insert into public.price_history (product_id, cost_cents, shipping_cost_cents, price_cents, promo_price_cents, source, changed_by)
             values (${productId}, ${p.costCents}, ${prod.shipping_cost_cents}, ${prod.price_cents}, ${prod.promo_price_cents}, ${source}, ${actorId})`;
    costChanged++;
  }
  const local = await tx<{ id: string; supplier_variant_ref: string | null; cost_cents: number | null; is_active: boolean }[]>`
    select id, supplier_variant_ref, cost_cents, is_active from public.product_variants where product_id = ${productId}`;
  const remote = new Map(p.variants.map((v) => [v.externalId, v]));
  for (const lv of local) {
    if (!lv.supplier_variant_ref) continue;
    const rv = remote.get(lv.supplier_variant_ref);
    if (!rv) {
      // variação sumiu do fornecedor: zera o estoque para não vender o que não existe
      if (await setVariantStock(tx, lv.id, 0, `${source}:removida`)) stockChanged++;
      missing++;
      continue;
    }
    if (rv.stock != null && (await setVariantStock(tx, lv.id, rv.stock, source))) stockChanged++;
    const vCost = rv.costCents !== p.costCents ? rv.costCents : null;
    if (rv.costCents > 0 && vCost !== lv.cost_cents && !(vCost === null && lv.cost_cents === null)) {
      await tx`update public.product_variants set cost_cents = ${vCost} where id = ${lv.id}`;
      await tx`insert into public.price_history (product_id, variant_id, cost_cents, source, changed_by) values (${productId}, ${lv.id}, ${rv.costCents}, ${source}, ${actorId})`;
      costChanged++;
    }
  }
  return { costChanged, stockChanged, missing };
}

/**
 * Sincroniza custo e estoque de todos os produtos de um fornecedor com API.
 * Respeita o limite de requisições do conector (chamadas sequenciais).
 */
export async function syncSupplier(supplierId: string, actorId: string | null, opts: { limit?: number } = {}) {
  const s = await loadSupplier(supplierId);
  if (!s.is_active) throw new Error("Fornecedor inativo.");
  const adapter = getSupplierAdapter(s.integration_type);
  if (!adapter.fetchProduct) throw new Error(`O fornecedor ${s.name} não tem sincronização por API. Atualize estoque e custo por CSV.`);
  const products = await db()<{ id: string; supplier_product_ref: string }[]>`
    select id, supplier_product_ref from public.products where supplier_id = ${supplierId} and supplier_product_ref is not null and status <> 'archived'
    order by updated_at limit ${opts.limit ?? 500}`;
  const run = await startRun(supplierId, "products", actorId);
  const stats = { total: products.length, ok: 0, failed: 0, costChanged: 0, stockChanged: 0, missingVariants: 0, errors: [] as string[] };
  for (const pr of products) {
    try {
      const data = await adapter.fetchProduct(pr.supplier_product_ref, s.integration_config ?? {});
      const r = await db().begin((tx: Tx) => applySupplierData(tx, pr.id, data, s.integration_type, actorId));
      stats.ok++; stats.costChanged += r.costChanged; stats.stockChanged += r.stockChanged; stats.missingVariants += r.missing;
    } catch (e) {
      stats.failed++;
      if (stats.errors.length < 20) stats.errors.push(`${pr.supplier_product_ref}: ${(e as Error).message}`);
      // credencial inválida: não adianta continuar
      if (e instanceof SupplierError && !e.retryable && /API key|não configurada|cotação/i.test(e.message)) break;
    }
  }
  const status = stats.failed === 0 ? "succeeded" : stats.ok > 0 ? "partial" : "failed";
  await finishRun(run, status, stats, stats.errors[0] ?? null);
  await db()`update public.suppliers set last_sync_at = now() where id = ${supplierId}`;
  if (stats.costChanged > 0) await log("warn", "suppliers", `${s.name}: ${stats.costChanged} custo(s) alterado(s) pelo fornecedor — revise os preços`, { supplierId });
  if (status !== "succeeded") await log(status === "failed" ? "error" : "warn", "suppliers", `Sincronização de ${s.name}: ${stats.failed} falha(s)`, { supplierId, errors: stats.errors.slice(0, 5) });
  return { status, ...stats };
}
