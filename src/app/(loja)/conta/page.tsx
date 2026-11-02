import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listCustomerOrders } from "@/lib/orders/queries";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/orders/status";
import { Alert, Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/ui/dates";

export const metadata: Metadata = { title: "Minha conta", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ senha?: string }> }) {
  const user = await requireUser("/conta");
  const orders = await listCustomerOrders(user.id);
  const sp = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Minha conta</h1>
      {sp.senha === "alterada" && <Alert tone="success">Senha alterada com sucesso.</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">Pedidos</p><p className="text-2xl font-bold">{orders.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Em andamento</p><p className="text-2xl font-bold">{orders.filter((o) => !["delivered", "canceled", "refunded"].includes(o.status)).length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">Total comprado</p><p className="text-2xl font-bold">{formatBRL(orders.filter((o) => !["pending_payment", "canceled", "refunded"].includes(o.status)).reduce((s, o) => s + o.total_cents, 0))}</p></Card>
      </div>
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
