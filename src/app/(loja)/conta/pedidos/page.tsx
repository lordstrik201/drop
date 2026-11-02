import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listCustomerOrders } from "@/lib/orders/queries";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/orders/status";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/ui/dates";

export const metadata: Metadata = { title: "Meus pedidos", robots: { index: false } };

export default async function OrdersPage() {
  const user = await requireUser("/conta/pedidos");
  const orders = await listCustomerOrders(user.id);
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Meus pedidos</h1>
      {orders.length === 0 ? <EmptyState title="Nenhum pedido ainda" action={<LinkButton href="/busca">Ver produtos</LinkButton>} /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase text-muted"><tr><th className="px-4 py-3">Pedido</th><th className="px-4 py-3">Data</th><th className="px-4 py-3">Itens</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-bg">
                  <td className="px-4 py-3"><Link href={`/conta/pedidos/${o.id}`} className="font-semibold text-brand underline">#{o.number}</Link></td>
                  <td className="px-4 py-3">{formatDate(o.created_at)}</td><td className="px-4 py-3">{o.items}</td>
                  <td className="px-4 py-3"><Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></td>
                  <td className="px-4 py-3 text-right font-semibold">{formatBRL(o.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
