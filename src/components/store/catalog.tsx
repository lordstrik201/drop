import Link from "next/link";
import { listBrands, listProducts, type ProductQuery, type ProductSort } from "@/lib/catalog/queries";
import { ProductGrid } from "./product-card";
import { EmptyState, Pagination, inputClass } from "@/components/ui";
import { parseBRL } from "@/lib/money";

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SORTS: Record<ProductSort, string> = {
  relevance: "Relevância", bestsellers: "Mais vendidos", price_asc: "Menor preço", price_desc: "Maior preço",
  newest: "Lançamentos", rating: "Melhor avaliados", discount: "Maior desconto",
};

export function parseCatalogQuery(sp: SearchParams, base: Partial<ProductQuery> = {}): ProductQuery {
  const money = (v?: string) => {
    if (!v) return undefined;
    try { return parseBRL(v); } catch { return undefined; }
  };
  const sort = one(sp.ordem) as ProductSort | undefined;
  return {
    ...base,
    q: one(sp.q)?.slice(0, 100),
    minPrice: money(one(sp.min)),
    maxPrice: money(one(sp.max)),
    inStock: one(sp.estoque) === "1",
    onSale: base.onSale || one(sp.oferta) === "1",
    featured: one(sp.destaque) === "1",
    brand: one(sp.marca)?.slice(0, 80),
    minRating: one(sp.nota) ? Math.min(5, Math.max(1, Number(one(sp.nota)) || 0)) : undefined,
    sort: sort && sort in SORTS ? sort : undefined,
    page: Math.max(1, Number(one(sp.pagina)) || 1),
    perPage: 24,
  };
}

export async function Catalog({ path, sp, base = {}, title, description }: { path: string; sp: SearchParams; base?: Partial<ProductQuery>; title: string; description?: string | null }) {
  const q = parseCatalogQuery(sp, base);
  const [{ items, total }, brands] = await Promise.all([listProducts(q), listBrands(base.categorySlug)]);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const s = one(v); if (s && k !== "pagina") params.set(k, s); }
  const hrefFor = (p: number) => { const x = new URLSearchParams(params); x.set("pagina", String(p)); return `${path}?${x}`; };
  const hidden = (name: string) => { const v = one(sp[name]); return v ? <input type="hidden" name={name} value={v} /> : null; };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        <p className="mt-1 text-sm text-muted">{total} {total === 1 ? "produto" : "produtos"}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside aria-label="Filtros">
          <details className="rounded-xl border border-line bg-surface p-4 lg:open:block" open>
            <summary className="cursor-pointer text-sm font-semibold lg:pointer-events-none lg:list-none">Filtros</summary>
            <form method="get" action={path} className="mt-4 flex flex-col gap-4 text-sm">
              {hidden("q")}
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 font-medium">Preço (R$)</legend>
                <div className="flex gap-2">
                  <input aria-label="Preço mínimo" name="min" inputMode="decimal" placeholder="Mín." defaultValue={one(sp.min)} className={inputClass} />
                  <input aria-label="Preço máximo" name="max" inputMode="decimal" placeholder="Máx." defaultValue={one(sp.max)} className={inputClass} />
                </div>
              </fieldset>
              {brands.length > 0 && (
                <label className="flex flex-col gap-1 font-medium">Marca
                  <select name="marca" defaultValue={one(sp.marca) ?? ""} className={inputClass}>
                    <option value="">Todas</option>
                    {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 font-medium">Avaliação
                <select name="nota" defaultValue={one(sp.nota) ?? ""} className={inputClass}>
                  <option value="">Qualquer</option>
                  <option value="4">4 estrelas ou mais</option>
                  <option value="3">3 estrelas ou mais</option>
                </select>
              </label>
              <label className="flex items-center gap-2"><input type="checkbox" name="estoque" value="1" defaultChecked={one(sp.estoque) === "1"} /> Somente disponíveis</label>
              {!base.onSale && <label className="flex items-center gap-2"><input type="checkbox" name="oferta" value="1" defaultChecked={one(sp.oferta) === "1"} /> Em oferta</label>}
              <label className="flex flex-col gap-1 font-medium">Ordenar por
                <select name="ordem" defaultValue={q.sort ?? "relevance"} className={inputClass}>
                  {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <button type="submit" className="h-10 flex-1 rounded-lg bg-brand font-semibold text-brand-contrast">Aplicar</button>
                <Link href={one(sp.q) ? `${path}?q=${encodeURIComponent(one(sp.q)!)}` : path} className="flex h-10 items-center rounded-lg border border-line px-3">Limpar</Link>
              </div>
            </form>
          </details>
        </aside>
        <section aria-label="Resultados">
          {items.length ? (
            <>
              <ProductGrid items={items} />
              <Pagination page={q.page ?? 1} total={total} perPage={q.perPage ?? 24} hrefFor={hrefFor} />
            </>
          ) : (
            <EmptyState title="Nenhum produto encontrado" description={q.q ? `Não encontramos resultados para "${q.q}". Tente outras palavras ou remova filtros.` : "Tente remover alguns filtros."} />
          )}
        </section>
      </div>
    </div>
  );
}
