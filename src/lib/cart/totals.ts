import { allocate, applyBps, type Cents } from "@/lib/money";

export type Coupon = {
  id: string;
  code: string;
  kind: "percent" | "fixed" | "free_shipping";
  value: number;
  max_discount_cents: number | null;
  min_subtotal_cents: number;
  max_uses: number | null;
  max_uses_per_customer: number | null;
  used_count: number;
  first_order_only: boolean;
  returning_customers_only: boolean;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  is_active: boolean;
  /** Cupom pessoal: só vale para este e-mail (ex.: resgate de pontos). */
  customer_email?: string | null;
};

export type CouponContext = {
  subtotal: Cents;
  /** Pedidos pagos anteriores do cliente (por e-mail ou conta). */
  customerPaidOrders: number;
  /** Quantas vezes este cliente já usou este cupom. */
  customerCouponUses: number;
  /** E-mail de quem está comprando (para cupons pessoais). */
  email?: string | null;
  now?: Date;
};

export type CouponCheck = { ok: true } | { ok: false; reason: string };

export function validateCoupon(c: Coupon, ctx: CouponContext): CouponCheck {
  const now = ctx.now ?? new Date();
  if (!c.is_active) return { ok: false, reason: "Cupom inativo." };
  if (c.customer_email && (!ctx.email || c.customer_email.toLowerCase() !== ctx.email.trim().toLowerCase()))
    return { ok: false, reason: "Este cupom é pessoal e vale só para a conta que o gerou." };
  if (c.starts_at && new Date(c.starts_at) > now) return { ok: false, reason: "Cupom ainda não está válido." };
  if (c.ends_at && new Date(c.ends_at) <= now) return { ok: false, reason: "Cupom expirado." };
  if (c.max_uses != null && c.used_count >= c.max_uses) return { ok: false, reason: "Cupom esgotado." };
  if (c.max_uses_per_customer != null && ctx.customerCouponUses >= c.max_uses_per_customer)
    return { ok: false, reason: "Você já utilizou este cupom." };
  if (c.first_order_only && ctx.customerPaidOrders > 0) return { ok: false, reason: "Cupom válido apenas na primeira compra." };
  if (c.returning_customers_only && ctx.customerPaidOrders === 0)
    return { ok: false, reason: "Cupom exclusivo para clientes que já compraram." };
  if (ctx.subtotal < c.min_subtotal_cents) return { ok: false, reason: "Valor mínimo do pedido não atingido para este cupom." };
  return { ok: true };
}

export type TotalsItem = { key: string; unitPrice: Cents; quantity: number };

export type Totals = {
  subtotal: Cents;
  discount: Cents;
  shipping: Cents;
  total: Cents;
  /** Desconto rateado por item (para o demonstrativo por produto). */
  itemDiscounts: Record<string, Cents>;
};

export function computeTotals(items: TotalsItem[], shipping: Cents, coupon: Coupon | null): Totals {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  let discount = 0;
  let ship = shipping;
  if (coupon) {
    if (coupon.kind === "percent") discount = applyBps(subtotal, coupon.value);
    else if (coupon.kind === "fixed") discount = coupon.value;
    else if (coupon.kind === "free_shipping") ship = 0;
    if (coupon.max_discount_cents != null) discount = Math.min(discount, coupon.max_discount_cents);
    discount = Math.min(discount, subtotal);
  }
  const shares = allocate(discount, items.map((i) => i.unitPrice * i.quantity));
  const itemDiscounts: Record<string, Cents> = {};
  items.forEach((i, idx) => (itemDiscounts[i.key] = shares[idx] ?? 0));
  return { subtotal, discount, shipping: ship, total: subtotal - discount + ship, itemDiscounts };
}
