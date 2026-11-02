import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCart } from "@/lib/cart/cart";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { computeTotals, type Coupon } from "@/lib/cart/totals";
import { getSetting } from "@/lib/settings";
import { CheckoutForm } from "@/components/store/checkout-form";

export const metadata: Metadata = { title: "Finalizar compra", robots: { index: false } };

export default async function CheckoutPage() {
  const cart = await getCart();
  if (!cart.lines.length) redirect("/carrinho");
  if (cart.lines.some((l) => !l.available)) redirect("/carrinho?erro=" + encodeURIComponent("Há itens indisponíveis no carrinho."));
  const user = await getSessionUser();
  const [coupon] = cart.couponCode ? await db()<Coupon[]>`select * from public.coupons where code = ${cart.couponCode}` : [];
  const totals = computeTotals(cart.lines.map((l) => ({ key: l.variantId, unitPrice: l.unitPrice, quantity: l.quantity })), 0, coupon ?? null);
  const checkoutCfg = await getSetting("checkout");
  let profile: { full_name: string | null; email: string; phone: string | null; cpf: string | null } | null = null;
  let addresses: { id: string; recipient_name: string; cep: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; is_default: boolean }[] = [];
  if (user) {
    [profile] = await db()<NonNullable<typeof profile>[]>`select full_name, email, phone, cpf from public.profiles where id = ${user.id}`;
    addresses = await db()`select id, recipient_name, cep, street, number, complement, district, city, state, is_default from public.addresses where profile_id = ${user.id} order by is_default desc, created_at desc`;
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Finalizar compra</h1>
      <CheckoutForm
        loggedIn={!!user}
        requireCpf={checkoutCfg.require_cpf}
        profile={profile}
        addresses={addresses}
        lines={cart.lines.map((l) => ({ id: l.variantId, name: l.name, variant: l.variantTitle, qty: l.quantity, total: l.unitPrice * l.quantity, image: l.image }))}
        subtotal={totals.subtotal}
        discount={totals.discount}
        couponCode={cart.couponCode}
        freeShippingCoupon={coupon?.kind === "free_shipping"}
      />
    </div>
  );
}
