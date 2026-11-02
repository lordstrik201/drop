import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/settings";
import { computeMargin } from "@/lib/catalog/pricing";
import { Badge, Button, LinkButton, Pagination } from "@/components/ui";
import { Flash, Table, td } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import type { ProductStatus } from "@/lib/types";
import { bulkProductsAction } from "./actions";
import { PRODUCT_STATUS_LABEL } from "@/lib/catalog/labels";

export const metadata = { title: "Produtos" };
const STATUS_LABEL = PRODUCT_STATUS_LABEL;
type SP = { q?: string; status?: string; fornecedor?: string; categoria?: string; alerta?: string; pagina?: string; ok?: string; erro?: string };
const uuid = (s?: string) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null);

export default async function ProductsAdmin({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireStaffPage("products.read");
  const sp = await searchParams;
  const sql = db();
  const q = sp.q?.trim().slice(0, 100) || null;
  const status = sp.status && sp.status in STATUS_LABEL ? sp.status : null;
  const supplier = uuid(sp.fornecedor), category = uuid(sp.categoria);
  const alert = ["sem_estoque", "margem_baixa", "preco_fornecedor"].includes(sp.alerta ?? "") ? sp.alerta! : null;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const [pricing, canWrite, suppliers, categories] = await Promise.all([
    getSetting("pricing"), can(user, "products.write"),
    sql<{ id: string; name: string }[]>`select id, name from public.suppliers order by name`,
    sql<{ id: string; name: string }[]>`select id, name from public.categories order by name`,
  ]);
  const conds = [sql`true`];
  if (q) conds.push(sql`(p.name ilike ${"%" + q + "%"} or upper(p.sku) like ${"%" + q.toUpperCase() + "%"} or p.supplier_product_ref = ${q}
                         or exists (select 1 from public.product_variants v where v.product_id = p.id and upper(v.sku) like ${"%" + q.toUpperCase() + "%"}))`);
  if (status) conds.push(sql`p.status = ${status}`); else conds.push(sql`p.status <> 'archived'`);
  if (supplier) conds.push(sql`p.supplier_id = ${supplier}`);
  if (category) conds.push(sql`p.category_id = ${category}`);
  if (alert === "sem_estoque") conds.push(sql`p.status = 'active' and not exists (select 1 from public.product_variants v where v.product_id = p.id and v.is_active and v.stock_quantity > 0)`);
  if (alert === "preco_fornecedor") conds.push(sql`exists (select 1 from public.price_history h where h.product_id = p.id and h.acknowledged_at is null and h.source not in ('manual','duplicate','bulk_percent','bulk_margin'))`);
  if (alert === "margem_baixa") {
    // margem = (preço − custo − frete − taxa) / preço
    conds.push(sql`p.status = 'active' and p.price_cents > 0 and
      (p.price_cents - p.cost_cents - p.shipping_cost_cents - (p.price_cents * ${pricing.estimated_fee_bps} / 10000) - ${pricing.estimated_fee_fixed_cents}) * 10000 / p.price_cents < ${pricing.min_margin_alert_bps}`);
  }
  const where = conds.reduce((a, c) => sql`${a} and ${c}`);
  const rows = await sql<{ id: string; name: string; sku: string; status: ProductStatus; price_cents: number; promo_price_cents: number | null; cost_cents: number; shipping_cost_cents: number; stock: number; variants: number; image: string | null; supplier: string | null; category: string | null; sold_count: number; total: number }[]>`
    select p.id, p.name, p.sku, p.status, p.price_cents, p.promo_price_cents, p.cost_cents, p.shipping_cost_cents, p.sold_count,
           coalesce((select sum(stock_quantity) from public.product_variants v where v.product_id = p.id and v.is_active), 0)::int as stock,
           (select count(*)::int from public.product_variants v where v.product_id = p.id) as variants,
           (select url from public.product_images i where i.product_id = p.id order by position limit 1) as image,
           s.name as supplier, c.name as category, count(*) over()::int as total
    from public.products p left join public.suppliers s on s.id = p.supplier_id left join public.categories c on c.id = p.category_id
    where ${where} order by p.updated_at desc limit 50 offset ${(page - 1) * 50}`;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["pagina", "ok", "erro"].includes(k)) as [string, string][]);
  const backUrl = `/admin/produtos?${qs}`;
  const sel = "h-9 rounded-lg border border-line bg-surface px-2 text-sm";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Produtos</h1>
        {canWrite && <span className="flex gap-2"><LinkButton href="/admin/produtos/importar" variant="secondary" size="sm">Importar</LinkButton><LinkButton href="/admin/produtos/novo" size="sm">Novo produto</LinkButton></span>}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      {pricing.estimated_fee_bps === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">A taxa do gateway está em 0% nas configurações: a margem exibida ignora a taxa do Mercado Pago. <Link href="/admin/configuracoes#pricing" className="underline">Ajustar</Link></p>}
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="Nome, SKU ou ref. do fornecedor" className={`${sel} w-64`} />
        <select name="status" defaultValue={status ?? ""} className={sel}><option value="">Todos (exceto arquivados)</option>{Object.entries(STATUS_LABEL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <select name="fornecedor" defaultValue={supplier ?? ""} className={sel}><option value="">Fornecedor</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select name="categoria" defaultValue={category ?? ""} className={sel}><option value="">Categoria</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="alerta" defaultValue={alert ?? ""} className={sel}><option value="">Sem alerta</option><option value="sem_estoque">Ativos sem estoque</option><option value="margem_baixa">Margem baixa</option><option value="preco_fornecedor">Custo alterado pelo fornecedor</option></select>
        <Button size="sm" variant="secondary">Filtrar</Button>
      </form>
      <form action={bulkProductsAction} className="flex flex-col gap-3">
        <input type="hidden" name="back" value={backUrl} />
        {canWrite && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2 text-sm">
            <span className="text-xs text-muted">Com os selecionados:</span>
            <select name="op" className={sel} defaultValue="active">
              <option value="active">Ativar</option><option value="inactive">Desativar</option><option value="draft">Voltar para rascunho</option><option value="archived">Arquivar</option>
              <option value="percent">Reajustar preço em % (valor)</option><option value="margin">Recalcular preço para margem % (valor)</option><option value="category">Mudar categoria (escolha abaixo)</option>
            </select>
            <input name="value" placeholder="valor (ex.: 10 ou -5)" className={`${sel} w-40`} list="cats" />
            <datalist id="cats">{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</datalist>
            <Button size="sm" variant="secondary">Aplicar</Button>
          </div>
        )}
        <Table head={["", "Produto", "Fornecedor", "Preço", "Custo + frete", "Margem est.", "Estoque", "Vendidos", "Status"]} empty={rows.length ? false : "Nenhum produto encontrado."}>
          {rows.map((p) => {
            const price = p.promo_price_cents ?? p.price_cents;
            const m = computeMargin({ price, cost: p.cost_cents, shippingCost: p.shipping_cost_cents, feeBps: pricing.estimated_fee_bps, feeFixed: pricing.estimated_fee_fixed_cents });
            const low = price > 0 && m.marginBps < pricing.min_margin_alert_bps;
            return (
              <tr key={p.id} className="hover:bg-bg/60">
                <td className={td}>{canWrite && <input type="checkbox" name="ids" value={p.id} aria-label={`Selecionar ${p.name}`} />}</td>
                <td className={td}>
                  <Link href={`/admin/produtos/${p.id}`} className="flex items-center gap-3">
                    {p.image ? <img src={p.image} alt="" className="size-10 rounded object-cover" /> : <span className="size-10 rounded bg-bg" />}
                    <span><span className="font-medium text-brand hover:underline">{p.name}</span><span className="block text-xs text-muted">SKU {p.sku}{p.variants > 1 && ` · ${p.variants} variações`}{p.category && ` · ${p.category}`}</span></span>
                  </Link>
                </td>
                <td className={`${td} text-xs`}>{p.supplier ?? <span className="text-danger">sem fornecedor</span>}</td>
                <td className={`${td} tabular-nums`}>{formatBRL(price)}{p.promo_price_cents != null && <span className="block text-xs text-muted line-through">{formatBRL(p.price_cents)}</span>}</td>
                <td className={`${td} tabular-nums text-muted`}>{formatBRL(p.cost_cents + p.shipping_cost_cents)}</td>
                <td className={`${td} tabular-nums ${low ? "font-semibold text-danger" : ""}`}>{price > 0 ? `${(m.marginBps / 100).toFixed(1).replace(".", ",")}%` : "—"}</td>
                <td className={`${td} tabular-nums ${p.stock === 0 && p.status === "active" ? "font-semibold text-danger" : ""}`}>{p.stock}</td>
                <td className={`${td} tabular-nums`}>{p.sold_count}</td>
                <td className={td}><Badge tone={STATUS_LABEL[p.status][1]}>{STATUS_LABEL[p.status][0]}</Badge></td>
              </tr>
            );
          })}
        </Table>
      </form>
      <Pagination page={page} total={rows[0]?.total ?? 0} perPage={50} hrefFor={(n) => `/admin/produtos?${qs}&pagina=${n}`} />
    </div>
  );
}
