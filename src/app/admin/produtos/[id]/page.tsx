import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/settings";
import { computeMargin, priceForMargin } from "@/lib/catalog/pricing";
import { PRODUCT_STATUS_LABEL } from "@/lib/catalog/labels";
import { isMediaConfigured } from "@/lib/storage/media";
import { Badge, Button, inputClass } from "@/components/ui";
import { Flash, Section } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/ui/dates";
import type { ProductStatus } from "@/lib/types";
import {
  ackPriceAlertsAction, deleteImageAction, deleteProductAction, deleteVariantAction, duplicateProductAction, imageOrderAction,
  productImageAction, saveProductAction, saveVariantAction,
} from "../actions";

export const metadata = { title: "Produto" };

type P = {
  id: string; name: string; slug: string; sku: string; short_description: string | null; description: string | null; brand: string | null;
  category_id: string | null; supplier_id: string | null; supplier_product_ref: string | null; status: ProductStatus; is_featured: boolean;
  cost_cents: number; shipping_cost_cents: number; price_cents: number; compare_at_cents: number | null; promo_price_cents: number | null;
  promo_starts_at: Date | null; promo_ends_at: Date | null; target_margin_bps: number | null; weight_grams: number | null;
  length_cm: string | null; width_cm: string | null; height_cm: string | null; lead_time_min_days: number | null; lead_time_max_days: number | null;
  seo_title: string | null; seo_description: string | null; sold_count: number; rating_avg: string; rating_count: number;
};
type V = { id: string; sku: string; title: string; options: Record<string, string>; supplier_variant_ref: string | null; cost_cents: number | null; shipping_cost_cents: number | null; price_cents: number | null; promo_price_cents: number | null; stock_quantity: number; stock_updated_at: Date | null; image_url: string | null; position: number; is_active: boolean };

const reais = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
const localDT = (d: Date | null) => (d ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d).replace(" ", "T") : "");

function F({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return <label className={`flex flex-col gap-1 text-sm ${className ?? ""}`}><span className="font-medium">{label}</span>{children}{hint && <span className="text-xs text-muted">{hint}</span>}</label>;
}

export default async function ProductEdit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("products.read");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const isNew = id === "novo";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = db();
  const [p] = isNew ? [null] : await sql<P[]>`select * from public.products where id = ${id}`;
  if (!isNew && !p) notFound();
  const [suppliers, categories, pricing, canWrite, canDelete] = await Promise.all([
    sql<{ id: string; name: string; avg_processing_days: number | null; avg_delivery_days: number | null }[]>`select id, name, avg_processing_days, avg_delivery_days from public.suppliers where is_active or id = ${p?.supplier_id ?? null} order by name`,
    sql<{ id: string; name: string; parent: string | null }[]>`select c.id, c.name, pc.name as parent from public.categories c left join public.categories pc on pc.id = c.parent_id order by coalesce(pc.name, c.name), c.parent_id nulls first, c.name`,
    getSetting("pricing"), can(user, "products.write"), can(user, "products.delete"),
  ]);
  const [images, variants, prices, stock] = p ? await Promise.all([
    sql<{ id: string; url: string; alt: string | null }[]>`select id, url, alt from public.product_images where product_id = ${p.id} order by position, created_at`,
    sql<V[]>`select * from public.product_variants where product_id = ${p.id} order by position, created_at`,
    sql<{ id: string; variant_sku: string | null; cost_cents: number | null; shipping_cost_cents: number | null; price_cents: number | null; promo_price_cents: number | null; source: string; created_at: Date; acknowledged_at: Date | null; who: string | null }[]>`
      select h.id, v.sku as variant_sku, h.cost_cents, h.shipping_cost_cents, h.price_cents, h.promo_price_cents, h.source, h.created_at, h.acknowledged_at, pr.email as who
      from public.price_history h left join public.product_variants v on v.id = h.variant_id left join public.profiles pr on pr.id = h.changed_by
      where h.product_id = ${p.id} order by h.created_at desc limit 30`,
    sql<{ sku: string; previous_quantity: number | null; new_quantity: number; source: string; created_at: Date }[]>`
      select v.sku, s.previous_quantity, s.new_quantity, s.source, s.created_at from public.stock_history s join public.product_variants v on v.id = s.variant_id
      where v.product_id = ${p.id} order by s.created_at desc limit 30`,
  ]) : [[], [], [], []];

  const sellPrice = p ? (p.promo_price_cents ?? p.price_cents) : 0;
  const margin = p ? computeMargin({ price: sellPrice, cost: p.cost_cents, shippingCost: p.shipping_cost_cents, feeBps: pricing.estimated_fee_bps, feeFixed: pricing.estimated_fee_fixed_cents }) : null;
  const targetBps = p?.target_margin_bps ?? pricing.default_target_margin_bps;
  let suggested: number | null = null;
  try { suggested = p && p.cost_cents > 0 ? priceForMargin(p.cost_cents, p.shipping_cost_cents, targetBps, pricing.estimated_fee_bps, pricing.estimated_fee_fixed_cents) : null; } catch { suggested = null; }
  const unackSupplierPrice = prices.some((h) => !h.acknowledged_at && !["manual", "duplicate", "bulk_percent", "bulk_margin"].includes(h.source));
  const dis = !canWrite;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/produtos" className="text-sm text-muted hover:text-ink">← Produtos</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">{p ? p.name : "Novo produto"}{p && <Badge tone={PRODUCT_STATUS_LABEL[p.status][1]}>{PRODUCT_STATUS_LABEL[p.status][0]}</Badge>}</h1>
          {p && <p className="text-sm text-muted">{p.sold_count} vendido(s) · nota {Number(p.rating_avg).toFixed(1).replace(".", ",")} ({p.rating_count})</p>}
        </div>
        {p && (
          <div className="flex flex-wrap gap-2">
            {p.status === "active" && <a href={`/produto/${p.slug}`} target="_blank" rel="noreferrer" className="self-center text-sm text-brand underline">Ver na loja ↗</a>}
            {canWrite && <form action={duplicateProductAction}><input type="hidden" name="productId" value={p.id} /><Button size="sm" variant="secondary">Duplicar</Button></form>}
          </div>
        )}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      {unackSupplierPrice && p && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>O fornecedor alterou custo ou estoque deste produto. Revise o preço de venda no histórico abaixo.</span>
          {canWrite && <form action={ackPriceAlertsAction}><input type="hidden" name="productId" value={p.id} /><Button size="sm" variant="secondary">Marcar como revisado</Button></form>}
        </div>
      )}

      <form action={saveProductAction} className="grid gap-4 lg:grid-cols-3">
        {p && <input type="hidden" name="productId" value={p.id} />}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Section title="Informações">
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Nome" className="sm:col-span-2"><input name="name" defaultValue={p?.name} required maxLength={200} disabled={dis} className={inputClass} /></F>
              <F label="SKU"><input name="sku" defaultValue={p?.sku} required maxLength={60} disabled={dis} className={inputClass} /></F>
              <F label="Endereço na loja (slug)" hint="Vazio = gerado pelo nome"><input name="slug" defaultValue={p?.slug} maxLength={120} disabled={dis} className={inputClass} /></F>
              <F label="Marca"><input name="brand" defaultValue={p?.brand ?? ""} maxLength={80} disabled={dis} className={inputClass} /></F>
              <F label="Categoria">
                <select name="category_id" defaultValue={p?.category_id ?? ""} disabled={dis} className={inputClass}><option value="">Sem categoria</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.parent ? `${c.parent} › ${c.name}` : c.name}</option>)}</select>
              </F>
              <F label="Resumo" className="sm:col-span-2"><input name="short_description" defaultValue={p?.short_description ?? ""} maxLength={300} disabled={dis} className={inputClass} /></F>
              <F label="Descrição" className="sm:col-span-2" hint="Linhas com “## ” viram títulos, “- ” vira lista, **negrito**. Não prometa prazo de entrega que o fornecedor não garante.">
                <textarea name="description" defaultValue={p?.description ?? ""} rows={10} maxLength={50000} disabled={dis} className={`${inputClass} h-auto py-2`} />
              </F>
            </div>
          </Section>

          <Section title="Preço e margem">
            <div className="grid gap-3 sm:grid-cols-3">
              <F label="Custo do produto (R$)"><input name="cost_cents" defaultValue={reais(p?.cost_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Custo do frete do fornecedor (R$)"><input name="shipping_cost_cents" defaultValue={reais(p?.shipping_cost_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Margem-alvo (%)" hint={`Padrão: ${(pricing.default_target_margin_bps / 100).toString().replace(".", ",")}%`}><input name="target_margin_bps" defaultValue={p?.target_margin_bps != null ? String(p.target_margin_bps / 100).replace(".", ",") : ""} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Preço de venda (R$)"><input name="price_cents" defaultValue={reais(p?.price_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Preço “de” (R$, opcional)" hint="Só use se o produto já foi vendido por esse valor (CDC art. 37)."><input name="compare_at_cents" defaultValue={reais(p?.compare_at_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Preço promocional (R$)"><input name="promo_price_cents" defaultValue={reais(p?.promo_price_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Promoção começa"><input type="datetime-local" name="promo_starts_at" defaultValue={localDT(p?.promo_starts_at ?? null)} disabled={dis} className={inputClass} /></F>
              <F label="Promoção termina"><input type="datetime-local" name="promo_ends_at" defaultValue={localDT(p?.promo_ends_at ?? null)} disabled={dis} className={inputClass} /></F>
            </div>
            {p && margin && (
              <div className="mt-4 grid gap-2 rounded-lg bg-bg p-3 text-sm sm:grid-cols-4">
                <span><span className="block text-xs text-muted">Preço cobrado</span>{formatBRL(sellPrice)}</span>
                <span><span className="block text-xs text-muted">Taxa estimada</span>{formatBRL(margin.fee)}</span>
                <span><span className="block text-xs text-muted">Lucro por unidade</span><strong className={margin.profit < 0 ? "text-danger" : ""}>{formatBRL(margin.profit)}</strong></span>
                <span><span className="block text-xs text-muted">Margem</span><strong className={margin.marginBps < pricing.min_margin_alert_bps ? "text-danger" : "text-success"}>{(margin.marginBps / 100).toFixed(1).replace(".", ",")}%</strong></span>
                {suggested != null && <span className="text-xs text-muted sm:col-span-4">Preço sugerido para {(targetBps / 100).toString().replace(".", ",")}% de margem: <strong className="text-ink">{formatBRL(suggested)}</strong> (salve para recalcular após mudar o custo).</span>}
              </div>
            )}
          </Section>

          <Section title="Entrega e dimensões">
            <div className="grid gap-3 sm:grid-cols-3">
              <F label="Peso (g)"><input name="weight_grams" defaultValue={p?.weight_grams ?? ""} inputMode="numeric" disabled={dis} className={inputClass} /></F>
              <F label="Comprimento (cm)"><input name="length_cm" defaultValue={p?.length_cm ?? ""} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Largura (cm)"><input name="width_cm" defaultValue={p?.width_cm ?? ""} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Altura (cm)"><input name="height_cm" defaultValue={p?.height_cm ?? ""} inputMode="decimal" disabled={dis} className={inputClass} /></F>
              <F label="Prazo mínimo (dias úteis)" hint="Vazio = usa o prazo médio do fornecedor"><input name="lead_time_min_days" defaultValue={p?.lead_time_min_days ?? ""} inputMode="numeric" disabled={dis} className={inputClass} /></F>
              <F label="Prazo máximo (dias úteis)"><input name="lead_time_max_days" defaultValue={p?.lead_time_max_days ?? ""} inputMode="numeric" disabled={dis} className={inputClass} /></F>
            </div>
            <p className="mt-2 text-xs text-muted">Peso e dimensões são obrigatórios para cotar frete no Melhor Envio. O prazo é exibido como estimativa.</p>
          </Section>

          <Section title="SEO">
            <div className="grid gap-3">
              <F label="Título para buscadores"><input name="seo_title" defaultValue={p?.seo_title ?? ""} maxLength={70} disabled={dis} className={inputClass} /></F>
              <F label="Descrição para buscadores"><input name="seo_description" defaultValue={p?.seo_description ?? ""} maxLength={170} disabled={dis} className={inputClass} /></F>
            </div>
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Section title="Publicação">
            <div className="flex flex-col gap-3">
              <F label="Status" hint={isNew ? "Produtos novos começam como rascunho." : "Para ativar: preço, fornecedor, imagem e variação ativa."}>
                <select name="status" defaultValue={p?.status ?? "draft"} disabled={dis} className={inputClass}>{Object.entries(PRODUCT_STATUS_LABEL).map(([k, [l]]) => <option key={k} value={k} disabled={isNew && k === "active"}>{l}</option>)}</select>
              </F>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_featured" defaultChecked={p?.is_featured} disabled={dis} /> Destaque na página inicial</label>
              {canWrite && <Button>{isNew ? "Criar produto" : "Salvar alterações"}</Button>}
            </div>
          </Section>
          <Section title="Fornecedor">
            <div className="flex flex-col gap-3">
              <F label="Fornecedor"><select name="supplier_id" defaultValue={p?.supplier_id ?? ""} disabled={dis} className={inputClass}><option value="">Selecione…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></F>
              <F label="Código do produto no fornecedor" hint="ID/SKU usado para pedir ao fornecedor e sincronizar estoque."><input name="supplier_product_ref" defaultValue={p?.supplier_product_ref ?? ""} maxLength={120} disabled={dis} className={inputClass} /></F>
              {p?.supplier_id && <Link href={`/admin/fornecedores/${p.supplier_id}`} className="text-sm text-brand underline">Ver fornecedor</Link>}
            </div>
          </Section>
        </div>
      </form>

      {p && (
        <>
          <Section title={`Imagens (${images.length})`}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {images.map((img, i) => (
                <li key={img.id} className="flex flex-col gap-1 rounded-lg border border-line p-2">
                  <img src={img.url} alt={img.alt ?? ""} className="aspect-square w-full rounded object-cover" />
                  {i === 0 && <span className="text-center text-xs text-muted">Principal</span>}
                  {canWrite && (
                    <div className="flex justify-between gap-1">
                      <form action={imageOrderAction}><input type="hidden" name="productId" value={p.id} /><input type="hidden" name="imageId" value={img.id} /><input type="hidden" name="dir" value="up" /><button disabled={i === 0} className="px-2 text-sm disabled:opacity-30" aria-label="Mover para a esquerda">←</button></form>
                      <form action={deleteImageAction}><input type="hidden" name="productId" value={p.id} /><input type="hidden" name="imageId" value={img.id} /><button className="text-xs text-danger underline">remover</button></form>
                      <form action={imageOrderAction}><input type="hidden" name="productId" value={p.id} /><input type="hidden" name="imageId" value={img.id} /><input type="hidden" name="dir" value="down" /><button disabled={i === images.length - 1} className="px-2 text-sm disabled:opacity-30" aria-label="Mover para a direita">→</button></form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {canWrite && (
              <form action={productImageAction} className="mt-4 flex flex-wrap items-end gap-2 text-sm">
                <input type="hidden" name="productId" value={p.id} />
                {isMediaConfigured()
                  ? <F label="Enviar arquivo (JPG, PNG, WebP, até 4 MB)"><input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif" className="text-sm" /></F>
                  : <p className="w-full text-xs text-muted">Envio de arquivos disponível após configurar o Supabase Storage. Por enquanto, informe a URL https da imagem (ex.: a do fornecedor).</p>}
                <F label="ou URL da imagem"><input name="url" type="url" placeholder="https://…" className={`${inputClass} w-72`} /></F>
                <F label="Texto alternativo"><input name="alt" maxLength={150} placeholder="Descreva a imagem" className={`${inputClass} w-56`} /></F>
                <Button size="sm" variant="secondary">Adicionar imagem</Button>
              </form>
            )}
          </Section>

          <Section title={`Variações e estoque (${variants.length})`}>
            <p className="mb-3 text-xs text-muted">Estoque é o disponível no fornecedor. Campos de preço e custo vazios usam os valores do produto. Opções no formato “Cor: Azul; Tamanho: M”.</p>
            <div className="flex flex-col gap-3">
              {[...variants, null].map((v) => (
                canWrite || v ? (
                  <form key={v?.id ?? "new"} action={saveVariantAction} className={`grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-6 ${v ? "border-line" : "border-dashed border-brand/50"} ${v && !v.is_active ? "opacity-60" : ""}`}>
                    <input type="hidden" name="productId" value={p.id} />
                    {v && <input type="hidden" name="variantId" value={v.id} />}
                    {!v && <p className="text-xs font-semibold sm:col-span-6">Nova variação</p>}
                    <F label="Nome"><input name="title" defaultValue={v?.title ?? ""} required maxLength={120} disabled={dis} className={inputClass} /></F>
                    <F label="SKU"><input name="sku" defaultValue={v?.sku ?? ""} required maxLength={60} disabled={dis} className={inputClass} /></F>
                    <F label="Opções" className="sm:col-span-2"><input name="options" defaultValue={v ? Object.entries(v.options).map(([k, x]) => `${k}: ${x}`).join("; ") : ""} disabled={dis} className={inputClass} /></F>
                    <F label="Estoque" hint={v?.stock_updated_at ? `atualizado ${formatDateTime(v.stock_updated_at)}` : undefined}><input name="stock_quantity" defaultValue={v?.stock_quantity ?? 0} inputMode="numeric" disabled={dis} className={inputClass} /></F>
                    <F label="Ref. no fornecedor"><input name="supplier_variant_ref" defaultValue={v?.supplier_variant_ref ?? ""} maxLength={120} disabled={dis} className={inputClass} /></F>
                    <F label="Preço (R$)"><input name="price_cents" defaultValue={reais(v?.price_cents)} placeholder={reais(p.price_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
                    <F label="Promo (R$)"><input name="promo_price_cents" defaultValue={reais(v?.promo_price_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
                    <F label="Custo (R$)"><input name="cost_cents" defaultValue={reais(v?.cost_cents)} placeholder={reais(p.cost_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
                    <F label="Frete forn. (R$)"><input name="shipping_cost_cents" defaultValue={reais(v?.shipping_cost_cents)} placeholder={reais(p.shipping_cost_cents)} inputMode="decimal" disabled={dis} className={inputClass} /></F>
                    <F label="Imagem (URL)"><input name="image_url" defaultValue={v?.image_url ?? ""} disabled={dis} className={inputClass} /></F>
                    <F label="Ordem"><input name="position" defaultValue={v?.position ?? variants.length} inputMode="numeric" disabled={dis} className={inputClass} /></F>
                    <div className="flex flex-wrap items-center gap-3 sm:col-span-6">
                      <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={v?.is_active ?? true} disabled={dis} /> Ativa</label>
                      {canWrite && <Button size="sm" variant={v ? "secondary" : "primary"}>{v ? "Salvar variação" : "Adicionar variação"}</Button>}
                      {canWrite && v && variants.length > 1 && <button formAction={deleteVariantAction} className="text-xs text-danger underline">Excluir</button>}
                    </div>
                  </form>
                ) : null
              ))}
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Histórico de preço e custo">
              {prices.length === 0 ? <p className="text-sm text-muted">Sem alterações.</p> : (
                <ul className="flex flex-col gap-1 text-xs">
                  {prices.map((h) => (
                    <li key={h.id} className={!h.acknowledged_at && !["manual", "duplicate", "bulk_percent", "bulk_margin"].includes(h.source) ? "font-semibold text-warning" : ""}>
                      {formatDateTime(h.created_at)} · {h.variant_sku ?? "produto"} · {h.source}{h.who && ` (${h.who})`}: preço {h.price_cents != null ? formatBRL(h.price_cents) : "—"}{h.promo_price_cents != null && ` / promo ${formatBRL(h.promo_price_cents)}`} · custo {h.cost_cents != null ? formatBRL(h.cost_cents) : "—"} + frete {h.shipping_cost_cents != null ? formatBRL(h.shipping_cost_cents) : "—"}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Histórico de estoque">
              {stock.length === 0 ? <p className="text-sm text-muted">Sem movimentações.</p> : (
                <ul className="flex flex-col gap-1 text-xs">{stock.map((s, i) => <li key={i}>{formatDateTime(s.created_at)} · {s.sku}: {s.previous_quantity ?? "—"} → <strong>{s.new_quantity}</strong> ({s.source})</li>)}</ul>
              )}
            </Section>
          </div>

          {canDelete && (
            <Section title="Excluir">
              <form action={deleteProductAction} className="flex flex-wrap items-center gap-3 text-sm">
                <input type="hidden" name="productId" value={p.id} />
                <span className="text-muted">{p.sold_count > 0 ? "Produto com vendas: será arquivado (some da loja, histórico preservado)." : "Produto sem vendas: será excluído definitivamente."}</span>
                <Button size="sm" variant="danger">{p.sold_count > 0 ? "Arquivar" : "Excluir produto"}</Button>
              </form>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
