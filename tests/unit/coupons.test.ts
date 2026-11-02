import { describe, expect, it } from "vitest";
import { computeTotals, validateCoupon, type Coupon } from "@/lib/cart/totals";

const base: Coupon = {
  id: "c1", code: "BEMVINDO", kind: "percent", value: 1000, max_discount_cents: null, min_subtotal_cents: 0,
  max_uses: null, max_uses_per_customer: null, used_count: 0, first_order_only: false,
  returning_customers_only: false, starts_at: null, ends_at: null, is_active: true,
};
const ctx = { subtotal: 10000, customerPaidOrders: 0, customerCouponUses: 0 };

describe("cupons", () => {
  it("valida regras", () => {
    expect(validateCoupon(base, ctx)).toEqual({ ok: true });
    expect(validateCoupon({ ...base, is_active: false }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...base, max_uses: 5, used_count: 5 }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...base, min_subtotal_cents: 20000 }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...base, first_order_only: true }, { ...ctx, customerPaidOrders: 1 }).ok).toBe(false);
    expect(validateCoupon({ ...base, returning_customers_only: true }, ctx).ok).toBe(false);
    expect(validateCoupon({ ...base, max_uses_per_customer: 1 }, { ...ctx, customerCouponUses: 1 }).ok).toBe(false);
    expect(validateCoupon({ ...base, ends_at: "2000-01-01" }, ctx).ok).toBe(false);
  });
  it("calcula totais com cupom percentual e rateio", () => {
    const t = computeTotals([{ key: "a", unitPrice: 3000, quantity: 2 }, { key: "b", unitPrice: 4000, quantity: 1 }], 1500, base);
    expect(t).toMatchObject({ subtotal: 10000, discount: 1000, shipping: 1500, total: 10500 });
    expect(t.itemDiscounts.a + t.itemDiscounts.b).toBe(1000);
  });
  it("cupom fixo não ultrapassa o subtotal", () => {
    const t = computeTotals([{ key: "a", unitPrice: 500, quantity: 1 }], 0, { ...base, kind: "fixed", value: 2000 });
    expect(t.total).toBe(0);
  });
  it("frete grátis zera o frete", () => {
    const t = computeTotals([{ key: "a", unitPrice: 500, quantity: 1 }], 1990, { ...base, kind: "free_shipping", value: 0 });
    expect(t.shipping).toBe(0);
  });
  it("respeita teto de desconto", () => {
    const t = computeTotals([{ key: "a", unitPrice: 100000, quantity: 1 }], 0, { ...base, max_discount_cents: 5000 });
    expect(t.discount).toBe(5000);
  });
});
