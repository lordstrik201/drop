import { db, type Tx } from "@/lib/db/client";
import { parseCSV } from "@/lib/reports/csv";
import { parseBRL } from "@/lib/money";
import { slugify } from "@/lib/validation/br";
import { parseOptions, setVariantStock } from "./admin";

/**
 * Importação por CSV (fornecedores sem API ou planilhas do próprio lojista).
 *
 * Modelo "produtos" — uma linha por variação:
 *   sku*, nome*, sku_produto, variacao, opcoes, preco, custo, frete_fornecedor, estoque,
 *   categoria, marca, descricao, imagens (URLs separadas por |), ref_fornecedor, ref_variacao,
 *   peso_g, comprimento_cm, largura_cm, altura_cm, prazo_min, prazo_max
 *   Linhas com o mesmo sku_produto viram variações do mesmo produto.
 *
 * Modelo "estoque" — atualiza variações existentes:
 *   sku (ou ref_variacao)*, estoque, custo
 *
 * Produtos novos entram como RASCUNHO. Tudo roda em uma transação: se houver
 * qualquer erro, nada é gravado e o relatório mostra as linhas com problema.
 */
export type ImportKind = "produtos" | "estoque";
export type ImportReport = { ok: boolean; applied: boolean; rows: number; created: number; updated: number; errors: { line: number; message: string }[]; warnings: string[] };

export const PRODUCT_COLUMNS = ["sku", "nome", "sku_produto", "variacao", "opcoes", "preco", "custo", "frete_fornecedor", "estoque", "categoria", "marca", "descricao", "imagens", "ref_fornecedor", "ref_variacao", "peso_g", "comprimento_cm", "largura_cm", "altura_cm", "prazo_min", "prazo_max"];
export const STOCK_COLUMNS = ["sku", "ref_variacao", "estoque", "custo"];
const MAX_ROWS = 5000;

const norm = (h: string) => slugify(h).replace(/-/g, "_");

class RowError extends Error {}
function money(v: string | undefined, label: string): number | null {
  if (v == null || v.trim() === "") return null;
  try { const c = parseBRL(v); if (c < 0) throw new Error(); return c; } catch { throw new RowError(`${label} inválido: "${v}"`); }
}
function int(v: string | undefined, label: string, max = 1_000_000): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  if (!Number.isInteger(n) || n < 0 || n > max) throw new RowError(`${label} inválido: "${v}"`);
  return n;
}
function dec(v: string | undefined, label: string): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 9999) throw new RowError(`${label} inválido: "${v}"`);
  return n;
}
const SKU_RE = /^[\w.\-/]{1,60}$/;

export async function importCsv(text: string, kind: ImportKind, opts: { supplierId: string | null; apply: boolean; actorId: string | null }): Promise<ImportReport> {
  const table = parseCSV(text);
  const report: ImportReport = { ok: false, applied: false, rows: 0, created: 0, updated: 0, errors: [], warnings: [] };
  if (table.length < 2) { report.errors.push({ line: 1, message: "Arquivo vazio ou sem linhas de dados." }); return report; }
  const header = table[0].map(norm);
  const known = kind === "produtos" ? PRODUCT_COLUMNS : STOCK_COLUMNS;
  const unknown = header.filter((h) => h && !known.includes(h));
  if (unknown.length) report.warnings.push(`Colunas ignoradas: ${unknown.join(", ")}`);
  if (kind === "produtos" && (!header.includes("sku") || !header.includes("nome"))) { report.errors.push({ line: 1, message: "Colunas obrigatórias: sku e nome." }); return report; }
  if (kind === "estoque" && !header.includes("sku") && !header.includes("ref_variacao")) { report.errors.push({ line: 1, message: "Informe a coluna sku ou ref_variacao." }); return report; }
  const rows = table.slice(1).map((cells, i) => ({ line: i + 2, r: Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? "").trim()])) as Record<string, string> }));
  report.rows = rows.length;
  if (rows.length > MAX_ROWS) { report.errors.push({ line: 1, message: `Máximo de ${MAX_ROWS} linhas por arquivo.` }); return report; }
  if (kind === "produtos" && !opts.supplierId) { report.errors.push({ line: 1, message: "Escolha o fornecedor dos produtos." }); return report; }

  const ROLLBACK = new Error("dry-run");
  try {
    await db().begin(async (tx: Tx) => {
      if (kind === "estoque") await applyStock(tx, rows, report);
      else await applyProducts(tx, rows, opts.supplierId!, report, opts.actorId);
      if (report.errors.length || !opts.apply) throw ROLLBACK; // simulação ou erro: desfaz tudo
    });
    report.applied = true;
  } catch (e) {
    // "csv-abort": erro de banco já registrado no relatório (a transação foi desfeita)
    if (e !== ROLLBACK && (e as Error).message !== "csv-abort") throw e;
  }
  report.ok = report.errors.length === 0;
  if (opts.actorId && report.applied) {
    await db()`insert into public.sync_runs (supplier_id, kind, status, stats, finished_at, triggered_by)
               values (${opts.supplierId}, 'csv', 'succeeded', ${db().json({ kind, rows: report.rows, created: report.created, updated: report.updated })}, now(), ${opts.actorId})`;
  }
  return report;
}

async function applyStock(tx: Tx, rows: { line: number; r: Record<string, string> }[], report: ImportReport) {
  for (const { line, r } of rows) {
    try {
      const [v] = r.sku
        ? await tx<{ id: string; product_id: string; cost_cents: number | null }[]>`select id, product_id, cost_cents from public.product_variants where upper(sku) = upper(${r.sku})`
        : await tx<{ id: string; product_id: string; cost_cents: number | null }[]>`select id, product_id, cost_cents from public.product_variants where supplier_variant_ref = ${r.ref_variacao}`;
      if (!v) throw new RowError(`Variação não encontrada (${r.sku || r.ref_variacao}).`);
      const stock = int(r.estoque, "estoque");
      const cost = money(r.custo, "custo");
      if (stock == null && cost == null) throw new RowError("Nada para atualizar (estoque e custo vazios).");
      if (stock != null) await setVariantStock(tx, v.id, stock, "csv");
      if (cost != null && cost !== v.cost_cents) {
        await tx`update public.product_variants set cost_cents = ${cost} where id = ${v.id}`;
        await tx`insert into public.price_history (product_id, variant_id, cost_cents, source) values (${v.product_id}, ${v.id}, ${cost}, 'csv')`;
      }
      report.updated++;
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      report.errors.push({ line, message: e.message });
    }
  }
}

async function applyProducts(tx: Tx, rows: { line: number; r: Record<string, string> }[], supplierId: string, report: ImportReport, actorId: string | null) {
  const cats = await tx<{ id: string; slug: string; name: string }[]>`select id, slug, lower(name) as name from public.categories`;
  const seenSku = new Set<string>();
  const groups = new Map<string, { line: number; r: Record<string, string> }[]>();
  for (const row of rows) {
    const key = (row.r.sku_produto || row.r.sku).toUpperCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  for (const items of groups.values()) {
    const first = items[0];
    const productSku = first.r.sku_produto || first.r.sku; // grafia original do arquivo
    try {
      for (const { line, r } of items) {
        if (!r.sku || !SKU_RE.test(r.sku)) throw new RowError(`linha ${line}: SKU inválido "${r.sku}"`);
        if (seenSku.has(r.sku.toUpperCase())) throw new RowError(`linha ${line}: SKU repetido no arquivo (${r.sku})`);
        seenSku.add(r.sku.toUpperCase());
      }
      if (!SKU_RE.test(productSku)) throw new RowError(`sku_produto inválido "${productSku}"`);
      const r = first.r;
      if (!r.nome || r.nome.length < 2) throw new RowError("nome obrigatório");
      let categoryId: string | null = null;
      if (r.categoria) {
        const c = cats.find((x) => x.slug === slugify(r.categoria) || x.name === r.categoria.toLowerCase());
        if (!c) throw new RowError(`categoria "${r.categoria}" não existe (crie em Catálogo → Categorias)`);
        categoryId = c.id;
      }
      const images = (r.imagens || "").split("|").map((u) => u.trim()).filter(Boolean);
      const badImg = images.find((u) => !/^https:\/\/\S+$/.test(u));
      if (badImg) throw new RowError(`imagem deve começar com https:// ("${badImg.slice(0, 60)}")`);
      const fields = {
        name: r.nome.slice(0, 200), description: r.descricao || null, brand: r.marca || null, category_id: categoryId,
        supplier_product_ref: r.ref_fornecedor || null,
        price: money(r.preco, "preco"), cost: money(r.custo, "custo"), ship: money(r.frete_fornecedor, "frete_fornecedor"),
        weight: int(r.peso_g, "peso_g"), length: dec(r.comprimento_cm, "comprimento_cm"), width: dec(r.largura_cm, "largura_cm"), height: dec(r.altura_cm, "altura_cm"),
        lmin: int(r.prazo_min, "prazo_min", 180), lmax: int(r.prazo_max, "prazo_max", 180),
      };
      const [existing] = await tx<{ id: string; supplier_id: string | null; price_cents: number; cost_cents: number; shipping_cost_cents: number }[]>`
        select id, supplier_id, price_cents, cost_cents, shipping_cost_cents from public.products where upper(sku) = upper(${productSku})`;
      let productId: string;
      if (existing) {
        if (existing.supplier_id && existing.supplier_id !== supplierId) throw new RowError(`SKU ${productSku} já pertence a outro fornecedor`);
        productId = existing.id;
        await tx`update public.products set
                   name = ${fields.name}, description = coalesce(${fields.description}, description), brand = coalesce(${fields.brand}, brand),
                   category_id = coalesce(${fields.category_id}, category_id), supplier_id = ${supplierId},
                   supplier_product_ref = coalesce(${fields.supplier_product_ref}, supplier_product_ref),
                   price_cents = coalesce(${fields.price}, price_cents), cost_cents = coalesce(${fields.cost}, cost_cents),
                   shipping_cost_cents = coalesce(${fields.ship}, shipping_cost_cents), weight_grams = coalesce(${fields.weight}, weight_grams),
                   length_cm = coalesce(${fields.length}, length_cm), width_cm = coalesce(${fields.width}, width_cm), height_cm = coalesce(${fields.height}, height_cm),
                   lead_time_min_days = coalesce(${fields.lmin}, lead_time_min_days), lead_time_max_days = coalesce(${fields.lmax}, lead_time_max_days)
                 where id = ${productId}`;
        if ((fields.price != null && fields.price !== existing.price_cents) || (fields.cost != null && fields.cost !== existing.cost_cents) || (fields.ship != null && fields.ship !== existing.shipping_cost_cents)) {
          await tx`insert into public.price_history (product_id, cost_cents, shipping_cost_cents, price_cents, source, changed_by)
                   values (${productId}, ${fields.cost ?? existing.cost_cents}, ${fields.ship ?? existing.shipping_cost_cents}, ${fields.price ?? existing.price_cents}, 'csv', ${actorId})`;
        }
        report.updated++;
      } else {
        const base = slugify(fields.name).slice(0, 90) || "produto";
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.products where slug = ${base} or slug like ${base + "-%"}`;
        const [ins] = await tx<{ id: string }[]>`
          insert into public.products (name, slug, sku, description, brand, category_id, supplier_id, supplier_product_ref, status,
            price_cents, cost_cents, shipping_cost_cents, weight_grams, length_cm, width_cm, height_cm, lead_time_min_days, lead_time_max_days)
          values (${fields.name}, ${n ? `${base}-${n + 1}` : base}, ${productSku}, ${fields.description}, ${fields.brand}, ${fields.category_id}, ${supplierId},
            ${fields.supplier_product_ref}, 'draft', ${fields.price ?? 0}, ${fields.cost ?? 0}, ${fields.ship ?? 0}, ${fields.weight}, ${fields.length}, ${fields.width},
            ${fields.height}, ${fields.lmin}, ${fields.lmax})
          returning id`;
        productId = ins.id;
        await tx`insert into public.price_history (product_id, cost_cents, shipping_cost_cents, price_cents, source, changed_by)
                 values (${productId}, ${fields.cost ?? 0}, ${fields.ship ?? 0}, ${fields.price ?? 0}, 'csv', ${actorId})`;
        report.created++;
      }
      if (images.length) {
        const have = new Set((await tx<{ url: string }[]>`select url from public.product_images where product_id = ${productId}`).map((x) => x.url));
        let pos = have.size;
        for (const url of images) if (!have.has(url)) await tx`insert into public.product_images (product_id, url, position) values (${productId}, ${url}, ${pos++})`;
      }
      for (const [i, { r: vr }] of items.entries()) {
        const stock = int(vr.estoque, "estoque");
        const vPrice = items.length > 1 ? money(vr.preco, "preco") : null;
        const vCost = items.length > 1 ? money(vr.custo, "custo") : null;
        const title = vr.variacao || (items.length > 1 ? vr.sku : "Padrão");
        const options = parseOptions(vr.opcoes || "");
        const [v] = await tx<{ id: string; product_id: string }[]>`select id, product_id from public.product_variants where upper(sku) = upper(${vr.sku})`;
        if (v && v.product_id !== productId) throw new RowError(`SKU de variação ${vr.sku} já existe em outro produto`);
        if (v) {
          await tx`update public.product_variants set title = ${title.slice(0, 120)}, options = ${tx.json(options)},
                     supplier_variant_ref = coalesce(${vr.ref_variacao || null}, supplier_variant_ref),
                     price_cents = coalesce(${vPrice}, price_cents), cost_cents = coalesce(${vCost}, cost_cents) where id = ${v.id}`;
          if (stock != null) await setVariantStock(tx, v.id, stock, "csv");
        } else {
          const [nv] = await tx<{ id: string }[]>`
            insert into public.product_variants (product_id, sku, title, options, supplier_variant_ref, price_cents, cost_cents, stock_quantity, stock_updated_at, position)
            values (${productId}, ${vr.sku}, ${title.slice(0, 120)}, ${tx.json(options)}, ${vr.ref_variacao || null}, ${vPrice}, ${vCost}, ${stock ?? 0}, now(), ${i})
            returning id`;
          await tx`insert into public.stock_history (variant_id, previous_quantity, new_quantity, source) values (${nv.id}, null, ${stock ?? 0}, 'csv')`;
        }
      }
    } catch (e) {
      if (!(e instanceof RowError)) {
        const pe = e as { code?: string; message?: string };
        if (pe.code === "23505") { report.errors.push({ line: first.line, message: `SKU ou endereço duplicado (${productSku})` }); throw new Error("csv-abort"); }
        throw e;
      }
      report.errors.push({ line: first.line, message: e.message });
    }
  }
}
