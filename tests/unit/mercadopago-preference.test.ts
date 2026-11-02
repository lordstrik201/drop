import { describe, expect, it } from "vitest";
import { buildPreferenceBody, type PreferenceInput } from "@/lib/integrations/payments/mercadopago";

const base: PreferenceInput = {
  orderId: "00000000-0000-0000-0000-000000000001",
  orderNumber: 1001,
  items: [{ id: "v1", title: "Produto", quantity: 2, unitPriceCents: 5000 }],
  shippingCents: 1500,
  discountCents: 0,
  payer: { name: "Maria da Silva", email: "maria@example.com" },
  siteUrl: "https://loja.example.com",
  expiresAt: new Date("2026-11-03T00:00:00Z"),
};

describe("buildPreferenceBody: meios de pagamento", () => {
  it("omite payment_methods quando não configurado", () => {
    expect(buildPreferenceBody(base)).not.toHaveProperty("payment_methods");
  });
  it("exclui tipos e limita parcelas entre 1 e 36", () => {
    const b = buildPreferenceBody({ ...base, paymentMethods: { excludedTypes: ["ticket", "account_money"], installments: 99 } });
    expect(b.payment_methods).toEqual({ excluded_payment_types: [{ id: "ticket" }], installments: 36 });
    const c = buildPreferenceBody({ ...base, paymentMethods: { excludedTypes: [], installments: 0 } });
    expect(c.payment_methods?.installments).toBe(1);
  });
  it("mantém total exato com desconto", () => {
    const b = buildPreferenceBody({ ...base, discountCents: 1234 });
    expect(b.items).toHaveLength(1);
    expect(b.items[0].unit_price).toBeCloseTo((10000 - 1234) / 100, 2);
  });
});
