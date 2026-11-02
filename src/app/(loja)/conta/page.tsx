import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listCustomerOrders } from "@/lib/orders/queries";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/orders/status";
import { Alert, Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/ui/dates";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/settings";
import { loyaltyBalance } from "@/lib/marketing/loyalty";
import { redeemPointsAction } from "./actions";

export const metadata: Metadata = { title: "Minha conta", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ senha?: string; pontos?: string }> }) {
  const user = await requireUser("/conta");
  const orders = await listCustomerOrders(user.id);
  const sp = await searchParams;
  const loyalty = await getSetting("loyalty");
  const [points, coupons] = loyalty.enabled
    ? await Promise.all([
        loyaltyBalance(user.id),
        db()<{ code: string; value: number; ends_at: Date | null; used_count: number }[]>`
          select code, value, ends_at, used_count from public.coupons
          where origin = 'loyalty' and customer_email = ${user.email.toLowerCase()} order by created_at desc limit 10`,
      ])
    : [0, []];
  const pontosMsg = sp.pontos?.startsWith("ok:") ? { ok: true, text: `Cupom ${sp.pontos.slice(3)} criado. Use-o no carrinho.` } : sp.pontos?.startsWith("erro:") ? { ok: false, text: sp.pontos.slice(5) } : null;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Minha conta</h1>
      {sp.senha === "alterada" && <Alert tone="success">Senha alterada com sucesso.</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">Pedidos</p><p className="text-2xl font-bold">{orders.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Em andamento</p><p className="text-2xl font-bold">{orders.filter((o) => !["delivered", "canceled", "refunded"].includes(o.status)).length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Total comprado</p><p className="text-2xl font-bold">{formatBRL(orders.filter((o) => !["pending_payment", "canceled", "refunded"].includes(o.status)).reduce((s, o) => s + o.total_cents, 0))}</p></Card>
      </div>
      {loyalty.enabled && (
        <section id="fidelidade" className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">Programa de fidelidade</h2>
          <p className="mt-1 text-sm text-muted">
            Você ganha {loyalty.points_per_real} ponto(s) por real em pedidos entregues. Cada ponto vale {formatBRL(loyalty.cents_per_point)} em cupom.
          </p>
          {pontosMsg && <div className="mt-3"><Alert tone={pontosMsg.ok ? "success" : "danger"}>{pontosMsg.text}</Alert></div>}
          <p className="mt-3 text-2xl font-bold">{points} pontos <span className="text-base font-normal text-muted">= {formatBRL(points * loyalty.cents_per_point)}</span></p>
          {points >= loyalty.min_redeem_points ? (
            <form action={redeemPointsAction} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">Pontos para trocar
                <input name="points" type="number" min={loyalty.min_redeem_points} max={points} defaultValue={points} className="h-10 w-40 rounded-lg border border-line px-3" />
              </label>
              <button className="h-10 rounded-lg bg-ink px-4 text-sm font-semibold text-white">Gerar cupom</button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-muted">A troca fica disponível a partir de {loyalty.min_redeem_points} pontos.</p>
          )}
          {coupons.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {coupons.map((c) => (
                <li key={c.code} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-mono font-semibold">{c.code}</span>
                  <span>{formatBRL(c.value)}</span>
                  <span className="text-muted">{c.used_count > 0 ? "usado" : c.ends_at ? `válido até ${formatDate(c.ends_at)}` : "válido"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section>
        <h2 className="mb-3 text-lg font-bold">Últimos pedidos</h2>
        {orders.length === 0 ? (
          <EmptyState title="Você ainda não fez pedidos" action={<LinkButton href="/busca">Começar a comprar</LinkButton>} />
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {orders.slice(0, 5).map((o) => (
              <li key={o.id}><Link href={`/conta/pedidos/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-bg">
                <span className="font-semibold">#{o.number}</span><span className="text-sm text-muted">{formatDate(o.created_at)}</span>
                <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge><span className="font-semibold">{formatBRL(o.total_cents)}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
