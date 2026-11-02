import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getOrderView } from "@/lib/orders/queries";
import { OrderDetail } from "@/components/store/order-detail";
import { retryPaymentAction } from "../../../actions";
import { Button } from "@/components/ui";

export const metadata: Metadata = { title: "Detalhes do pedido", robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/conta/pedidos/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const o = await getOrderView(id);
  if (!o || o.profile_id !== user.id) notFound();
  return (
    <OrderDetail
      o={o}
      actions={o.status === "pending_payment" ? <form action={retryPaymentAction}><input type="hidden" name="orderId" value={o.id} /><Button type="submit" variant="accent" size="sm">Pagar agora</Button></form> : null}
    />
  );
}
