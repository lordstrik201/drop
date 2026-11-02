import { describe, expect, it } from "vitest";
import { computeMargin, effectivePrice, isPromoActive, priceForMargin } from "@/lib/catalog/pricing";
import { allocate, applyBps, formatBRL, parseBRL } from "@/lib/money";

describe("dinheiro", () => {
  it("converte texto em centavos", () => {
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 10")).toBe(1000);
    expect(parseBRL("99.9")).toBe(9990);
    expect(parseBRL("0,05")).toBe(5);
    expect(() => parseBRL("abc")).toThrow();
  });
  it("formata em reais", () => {
    expect(formatBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
  });
  it("rateia sem perder centavos", () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });
  it("aplica percentual em bps", () => {
    expect(applyBps(10000, 499)).toBe(499);
    expect(applyBps(250, 1000)).toBe(25);
  });
});

describe("preço efetivo", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("usa promoção somente dentro da janela", () => {
    const p = { price_cents: 10000, promo_price_cents: 8000, promo_starts_at: "2026-11-01", promo_ends_at: "2026-11-30" };
    expect(isPromoActive(p, now)).toBe(true);
    expect(effectivePrice(p, null, 0, now)).toEqual({ price: 8000, original: 10000, discountPercent: 20 });
    expect(isPromoActive({ ...p, promo_ends_at: "2026-11-02T11:00:00Z" }, now)).toBe(false);
  });
  it("variação sobrescreve o preço do produto", () => {
    expect(effectivePrice({ price_cents: 10000 }, { price_cents: 12000 }, 0, now).price).toBe(12000);
  });
  it("campanha aplica desconto automático", () => {
    expect(effectivePrice({ price_cents: 10000 }, null, 1000, now)).toEqual({ price: 9000, original: 10000, discountPercent: 10 });
  });
  it("promoção maior que o preço é ignorada", () => {
    expect(effectivePrice({ price_cents: 10000, promo_price_cents: 15000 }, null, 0, now).price).toBe(10000);
  });
});

describe("margem", () => {
  it("calcula lucro e margem por unidade", () => {
    const r = computeMargin({ price: 10000, cost: 4000, shippingCost: 1500, feeBps: 499, feeFixed: 0 });
    expect(r.fee).toBe(499);
    expect(r.profit).toBe(4001);
    expect(r.marginBps).toBe(4001);
  });
  it("sugere preço para margem-alvo terminando em ,90", () => {
    const p = priceForMargin(4000, 1500, 3000, 499);
    expect(p % 100).toBe(90);
    const m = computeMargin({ price: p, cost: 4000, shippingCost: 1500, feeBps: 499 });
    expect(m.marginBps).toBeGreaterThanOrEqual(3000);
  });
  it("rejeita margem impossível", () => {
    expect(() => priceForMargin(100, 0, 9600, 500)).toThrow();
  });
});
