import { applyBps, type Cents } from "@/lib/money";

export type PriceInput = {
  price_cents: number;
  compare_at_cents?: number | null;
  promo_price_cents?: number | null;
  promo_starts_at?: Date | string | null;
  promo_ends_at?: Date | string | null;
};

export type VariantPriceOverride = {
  price_cents?: number | null;
  promo_price_cents?: number | null;
  cost_cents?: number | null;
  shipping_cost_cents?: number | null;
};

export function isPromoActive(p: PriceInput, now = new Date()): boolean {
  if (p.promo_price_cents == null) return false;
  const s = p.promo_starts_at ? new Date(p.promo_starts_at) : null;
  const e = p.promo_ends_at ? new Date(p.promo_ends_at) : null;
  if (s && s > now) return false;
  if (e && e <= now) return false;
  return p.promo_price_cents < p.price_cents;
}

export type EffectivePrice = {
  /** Preço cobrado. */
  price: Cents;
  /** Preço "de" exibido riscado (somente se maior que o cobrado). */
  original: Cents | null;
  discountPercent: number | null;
};

/**
 * Preço efetivo de uma variação: override da variação > produto; promoção dentro
 * da janela; desconto automático de campanha (bps) aplicado sobre o resultado.
 */
export function effectivePrice(
  product: PriceInput,
  variant?: VariantPriceOverride | null,
  campaignBps = 0,
  now = new Date(),
): EffectivePrice {
  const base: PriceInput = {
    ...product,
    price_cents: variant?.price_cents ?? product.price_cents,
    promo_price_cents: variant?.promo_price_cents ?? product.promo_price_cents,
  };
  let price = isPromoActive(base, now) ? base.promo_price_cents! : base.price_cents;
  if (campaignBps > 0) price = price - applyBps(price, campaignBps);
  const reference = Math.max(base.price_cents, product.compare_at_cents ?? 0);
  const original = reference > price ? reference : null;
  const discountPercent = original ? Math.round(((original - price) / original) * 100) : null;
  return { price, original, discountPercent };
}

export type MarginInput = {
  price: Cents;
  cost: Cents;
  shippingCost: Cents;
  /** Taxa estimada do gateway em bps (ex.: 499 = 4,99%). */
  feeBps?: number;
  /** Taxa fixa por transação em centavos. */
  feeFixed?: Cents;
};

export type MarginResult = { fee: Cents; profit: Cents; marginBps: number };

/** Lucro e margem estimados por unidade (margem sobre o preço de venda). */
export function computeMargin({ price, cost, shippingCost, feeBps = 0, feeFixed = 0 }: MarginInput): MarginResult {
  const fee = applyBps(price, feeBps) + feeFixed;
  const profit = price - cost - shippingCost - fee;
  const marginBps = price > 0 ? Math.round((profit / price) * 10000) : 0;
  return { fee, profit, marginBps };
}

/**
 * Preço sugerido para atingir uma margem-alvo:
 * preço = (custo + frete + taxaFixa) / (1 − margem − taxa%). Arredonda para ,90.
 */
export function priceForMargin(
  cost: Cents,
  shippingCost: Cents,
  targetMarginBps: number,
  feeBps = 0,
  feeFixed: Cents = 0,
  roundTo90 = true,
): Cents {
  const denom = 1 - targetMarginBps / 10000 - feeBps / 10000;
  if (denom <= 0) throw new Error("Margem e taxas somadas não podem ser ≥ 100%");
  let p = Math.ceil((cost + shippingCost + feeFixed) / denom);
  if (roundTo90) {
    const reais = Math.ceil((p - 90) / 100);
    p = Math.max(reais, 0) * 100 + 90;
  }
  return p;
}
