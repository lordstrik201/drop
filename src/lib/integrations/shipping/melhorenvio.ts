/**
 * Melhor Envio — cotação de fretes por produtos.
 *
 * Documentação oficial consultada (nov/2026):
 * - https://docs.melhorenvio.com.br/reference/introducao-api-melhor-envio.md
 *   Produção: https://melhorenvio.com.br · Sandbox: https://sandbox.melhorenvio.com.br
 *   Cabeçalhos: Accept/Content-Type application/json e User-Agent "Aplicação (email-tecnico)".
 * - https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos
 *   POST /api/v2/me/shipment/calculate, Authorization: Bearer <token>,
 *   corpo { from:{postal_code}, to:{postal_code}, products:[{id,width,height,length,weight,insurance_value,quantity}] }
 *   (cm, kg, R$). A documentação orienta usar custom_price e custom_delivery_time da resposta.
 * - https://docs.melhorenvio.com.br/docs/autenticacao-1.md — access_token OAuth2 válido por 30 dias
 *   (refresh_token por 45 dias): o token precisa ser renovado periodicamente.
 *
 * Observação de dropshipping: o envio costuma sair do fornecedor. A cotação
 * usa o CEP de origem configurado (do fornecedor/centro de distribuição) e só é
 * útil quando o lojista emite as etiquetas. O prazo exibido é o informado pela
 * API somado ao prazo de processamento do fornecedor, sempre como estimativa.
 */
import type { DbOrTx } from "@/lib/db/client";
import { getCredentials, markIntegration } from "@/lib/integrations/credentials";
import { readSetting } from "@/lib/settings";
import type { QuoteLine, ShippingOption } from "@/lib/shipping/quote";

const BASE = { sandbox: "https://sandbox.melhorenvio.com.br", production: "https://melhorenvio.com.br" };

type MeService = {
  id: number;
  name: string;
  price?: string | number;
  custom_price?: string | number;
  delivery_time?: number;
  custom_delivery_time?: number;
  custom_delivery_range?: { min: number; max: number };
  company?: { id: number; name: string };
  error?: string;
};

export function parseMelhorEnvioResponse(services: MeService[], extraDays: number): ShippingOption[] {
  if (!Array.isArray(services)) return [];
  return services
    .filter((s) => !s.error && (s.custom_price ?? s.price) != null)
    .map((s) => {
      const price = Math.round(Number(s.custom_price ?? s.price) * 100);
      const range = s.custom_delivery_range;
      const days = s.custom_delivery_time ?? s.delivery_time ?? null;
      return {
        id: `me:${s.id}`,
        name: `${s.company?.name ?? "Transportadora"} ${s.name}`.trim(),
        carrier: s.company?.name ?? null,
        price,
        minDays: range ? range.min + extraDays : days != null ? days + extraDays : null,
        maxDays: range ? range.max + extraDays : days != null ? days + extraDays : null,
        source: "melhorenvio" as const,
      };
    })
    .filter((o) => Number.isFinite(o.price) && o.price >= 0)
    .sort((a, b) => a.price - b.price);
}

export async function melhorEnvioQuote(lines: QuoteLine[], cep: string, sql: DbOrTx, f: typeof fetch = fetch): Promise<ShippingOption[]> {
  const creds = await getCredentials("melhorenvio");
  if (!creds.token || !creds.userAgent) throw new Error("Melhor Envio não configurado (MELHORENVIO_TOKEN e MELHORENVIO_USER_AGENT).");
  const shipping = await readSetting("shipping", sql);
  const origin = shipping.origin_cep.replace(/\D/g, "");
  if (origin.length !== 8) throw new Error("CEP de origem não configurado (Configurações → Frete).");
  const ids = lines.map((l) => l.productId);
  const dims = await sql<{ id: string; weight_grams: number | null; length_cm: string | null; width_cm: string | null; height_cm: string | null; processing: number | null }[]>`
    select p.id, p.weight_grams, p.length_cm, p.width_cm, p.height_cm, s.avg_processing_days as processing
    from public.products p left join public.suppliers s on s.id = p.supplier_id where p.id = any(${ids}::uuid[])`;
  const byId = new Map(dims.map((d) => [d.id, d]));
  const missing = dims.filter((d) => !d.weight_grams || !d.length_cm || !d.width_cm || !d.height_cm);
  if (missing.length) throw new Error("Produtos sem peso/dimensões cadastrados: não é possível cotar no Melhor Envio.");
  const products = lines.map((l) => {
    const d = byId.get(l.productId)!;
    return {
      id: l.variantId,
      width: Number(d.width_cm), height: Number(d.height_cm), length: Number(d.length_cm),
      weight: d.weight_grams! / 1000,
      insurance_value: l.unitPrice / 100,
      quantity: l.quantity,
    };
  });
  const extraDays = Math.max(0, ...dims.map((d) => d.processing ?? 0));
  const env = process.env.MELHORENVIO_ENV === "production" ? "production" : "sandbox";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await f(`${BASE[env]}/api/v2/me/shipment/calculate`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${creds.token}`, "User-Agent": creds.userAgent },
      body: JSON.stringify({ from: { postal_code: origin }, to: { postal_code: cep }, products, options: { receipt: false, own_hand: false } }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = res.status === 401 ? "Token do Melhor Envio inválido ou expirado" : `Melhor Envio HTTP ${res.status}`;
      await markIntegration("melhorenvio", false, msg);
      throw new Error(msg);
    }
    await markIntegration("melhorenvio", true);
    return parseMelhorEnvioResponse(body as MeService[], extraDays);
  } finally {
    clearTimeout(t);
  }
}
