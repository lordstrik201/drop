import type { DbOrTx } from "@/lib/db/client";
import { readSetting } from "@/lib/settings";

export type QuoteLine = { productId: string; variantId: string; quantity: number; unitPrice: number; shippingCost: number; supplierId: string | null };

export type ShippingOption = {
  id: string;
  name: string;
  carrier: string | null;
  price: number;
  /** Prazo só é exibido quando há prazos cadastrados ou informados pela transportadora. */
  minDays: number | null;
  maxDays: number | null;
  source: "product" | "flat" | "melhorenvio";
};

export type QuoteFn = (lines: QuoteLine[], cep: string, sql: DbOrTx) => Promise<ShippingOption[]>;

/**
 * Cotação de frete. Em dropshipping o fornecedor costuma definir transportadora
 * e custo; por isso o modo padrão usa o frete cadastrado no produto. Prazos vêm
 * dos prazos cadastrados (processamento do fornecedor + entrega) e são exibidos
 * como estimativa, nunca como garantia.
 */
export async function quoteShipping(lines: QuoteLine[], cep: string, sql: DbOrTx, melhorEnvio?: QuoteFn): Promise<ShippingOption[]> {
  if (!/^\d{8}$/.test(cep)) throw new Error("CEP inválido.");
  if (lines.length === 0) return [];
  const s = await readSetting("shipping", sql);
  const subtotal = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const free = s.free_shipping_over_cents != null && subtotal >= s.free_shipping_over_cents;

  const ids = Array.from(new Set(lines.map((l) => l.productId)));
  const leads = await sql<{ min: number | null; max: number | null }[]>`
    select max(p.lead_time_min_days + coalesce(sp.avg_processing_days, 0)) as min,
           max(p.lead_time_max_days + coalesce(sp.avg_processing_days, 0)) as max
    from public.products p left join public.suppliers sp on sp.id = p.supplier_id where p.id = any(${ids}::uuid[])`;
  const minDays = leads[0]?.min ?? null;
  const maxDays = leads[0]?.max ?? null;

  if (s.mode === "melhorenvio") {
    if (!melhorEnvio) throw new Error("Cotação Melhor Envio indisponível.");
    const opts = await melhorEnvio(lines, cep, sql);
    return free ? opts.map((o, i) => (i === 0 ? { ...o, price: 0, name: `${o.name} (frete grátis)` } : o)) : opts;
  }
  if (s.mode === "flat") {
    return [{ id: "flat", name: free ? "Frete grátis" : "Entrega padrão", carrier: null, price: free ? 0 : s.flat_rate_cents, minDays, maxDays, source: "flat" }];
  }
  const total = lines.reduce((a, l) => a + l.shippingCost * l.quantity, 0);
  return [{ id: "product", name: free || total === 0 ? "Frete grátis" : "Entrega padrão", carrier: null, price: free ? 0 : total, minDays, maxDays, source: "product" }];
}
