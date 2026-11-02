import type { Metadata } from "next";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { getCart } from "@/lib/cart/cart";
import { db } from "@/lib/db/client";
import { computeTotals, type Coupon } from "@/lib/cart/totals";
import { updateCartItemAction } from "../actions";
import { CouponForm } from "@/components/store/coupon-form";
import { Alert, EmptyState, LinkButton, Price } from "@/components/ui";
import { formatBRL } from "@/lib/money";

export const metadata: Metadata = { title: "Carrinho", robots: { index: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const cart = await getCart();
  if (!cart.lines.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState title="Seu carrinho está vazio" description="Explore a loja e adicione produtos." action={<LinkButton href="/busca">Ver produtos</LinkButton>} />
      </div>
    );
  }
  const [coupon] = cart.couponCode ? await db()<Coupon[]>`select * from public.coupons where code = ${cart.couponCode}` : [];
  const totals = computeTotals(cart.lines.map((l) => ({ key: l.variantId, unitPrice: l.unitPrice, quantity: l.quantity })), 0, coupon ?? null);
  const blocked = cart.lines.some((l) => !l.available);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Carrinho</h1>
      {erro && <div className="mb-4"><Alert tone="danger">{erro}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {cart.lines.map((l) => (
            <li key={l.variantId} className="flex gap-4 p-4">
              <Link href={`/produto/${l.slug}`} className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-white">
                {l.image && <img src={l.image} alt="" className="h-full w-full object-contain" />}
              </Link>
              <div className="flex flex-1 flex-col gap-1">
                <Link href={`/produto/${l.slug}`} className="text-sm font-medium hover:underline">{l.name}</Link>
                {l.variantTitle !== "Padrão" && <p className="text-xs text-muted">{l.variantTitle}</p>}
                {!l.available && <p className="text-xs font-semibold text-danger">{l.stock > 0 ? `Apenas ${l.stock} disponível(is)` : "Indisponível no momento"}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-3">
                  <form action={updateCartItemAction} className="flex items-center gap-2">
                    <input type="hidden" name="variantId" value={l.variantId} />
                    <label className="sr-only" htmlFor={`q-${l.variantId}`}>Quantidade</label>
                    <select id={`q-${l.variantId}`} name="quantity" defaultValue={l.quantity} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">
                      {Array.from({ length: Math.max(Math.min(Math.max(l.stock, l.quantity), 20), 1) }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button type="submit" className="text-xs font-semibold text-brand underline">Atualizar</button>
                  </form>
                  <form action={updateCartItemAction}>
                    <input type="hidden" name="variantId" value={l.variantId} />
                    <input type="hidden" name="quantity" value="0" />
                    <button type="submit" className="flex items-center gap-1 text-xs text-muted hover:text-danger"><Trash2 size={14} aria-hidden /> Remover</button>
                  </form>
                </div>
              </div>
              <div className="text-right"><Price price={l.unitPrice * l.quantity} original={l.originalPrice ? l.originalPrice * l.quantity : null} size="sm" /></div>
            </li>
          ))}
        </ul>
        <aside className="h-fit rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">Resumo</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt>Subtotal ({cart.itemCount} itens)</dt><dd>{formatBRL(totals.subtotal)}</dd></div>
            {totals.discount > 0 && <div className="flex justify-between text-success"><dt>Desconto ({cart.couponCode})</dt><dd>-{formatBRL(totals.discount)}</dd></div>}
            {coupon?.kind === "free_shipping" && <div className="flex justify-between text-success"><dt>Cupom {coupon.code}</dt><dd>Frete grátis</dd></div>}
            <div className="flex justify-between text-muted"><dt>Frete</dt><dd>calculado no checkout</dd></div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-bold"><dt>Total</dt><dd>{formatBRL(totals.total)}</dd></div>
          </dl>
          <div className="mt-4"><CouponForm current={cart.couponCode} /></div>
          {blocked ? (
            <div className="mt-4"><Alert tone="warning">Ajuste os itens indisponíveis para continuar.</Alert></div>
          ) : (
            <LinkButton href="/checkout" size="lg" variant="accent" className="mt-4 w-full">Finalizar compra</LinkButton>
          )}
          <Link href="/busca" className="mt-3 block text-center text-sm text-brand underline">Continuar comprando</Link>
        </aside>
      </div>
    </div>
  );
}
