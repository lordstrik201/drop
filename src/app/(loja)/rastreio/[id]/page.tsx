import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderView } from "@/lib/orders/queries";
import { verifyOrderAccess } from "@/lib/orders/access";
import { OrderDetail } from "@/components/store/order-detail";

export const metadata: Metadata = { title: "Acompanhar pedido", robots: { index: false } };

export default async function PublicOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ id }, { t }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyOrderAccess(id, t)) notFound();
  const o = await getOrderView(id);
  if (!o) notFound();
  return <div className="mx-auto max-w-5xl px-4 py-6"><OrderDetail o={o} /></div>;
}
