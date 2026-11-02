/**
 * Conector CJdropshipping (API 2.0).
 *
 * Documentação oficial consultada em nov/2026:
 * - Autenticação: https://developers.cjdropshipping.com/en/api/api2/api/auth.html
 *   POST /api2.0/v1/authentication/getAccessToken  { apiKey }
 *   POST /api2.0/v1/authentication/refreshAccessToken { refreshToken }
 *   Resposta em data: accessToken, accessTokenExpiryDate, refreshToken, refreshTokenExpiryDate (180 dias).
 *   O token vai no cabeçalho "CJ-Access-Token". A CJ devolve o mesmo token por 24h.
 * - Limites: https://developers.cjdropshipping.com/en/api/start/limit.html (1 a 6 requisições/s conforme o nível).
 * - Produto: GET /api2.0/v1/product/query?pid=|productSku=|variantSku=
 *   (pid, productNameEn, productSku, productImageSet, sellPrice, productWeight, description,
 *   variants[]: vid, variantSku, variantNameEn, variantKey, variantSellPrice, variantWeight,
 *   variantLength/Width/Height, variantImage, inventories[]: countryCode, totalInventory).
 * - Pedido: POST /api2.0/v1/shopping/order/createOrderV2 (orderNumber único: duplicado → ORDER_CODE_EXIST).
 *   payType 3 = "cria o pedido sem pagamento". Usamos SEMPRE payType 3: nenhuma compra é paga
 *   automaticamente; o lojista confere e paga no painel da CJ (regra do projeto).
 * - Rastreio: GET /api2.0/v1/logistic/trackInfo?trackNumber=
 *
 * Valores da CJ são em USD: a conversão usa a cotação informada pelo lojista no
 * cadastro do fornecedor (não inventamos câmbio).
 */
import { db } from "@/lib/db/client";
import { getCredentials, markIntegration } from "@/lib/integrations/credentials";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { SupplierError, type ImportedProduct, type SupplierAdapter, type SupplierOrderInput, type SupplierOrderResult } from "./types";

const BASE = "https://developers.cjdropshipping.com/api2.0/v1";

export type CjConfig = {
  /** Cotação USD→BRL usada para converter custos (ex.: 5.45). Obrigatória para importar/sincronizar preços. */
  usd_brl_rate?: number;
  /** Nome do método logístico da CJ para pedidos (ex.: o escolhido no painel da CJ). Obrigatório para criar pedidos. */
  logistic_name?: string;
  /** País do armazém de origem (ex.: "CN" ou "BR"). */
  from_country_code?: string;
  /** Considerar somente o estoque deste país (ex.: "BR"); vazio = soma de todos. */
  warehouse_country?: string;
};

type CjEnvelope<T> = { code: number; result: boolean; message: string; data: T; requestId?: string; success?: boolean };
type Tokens = { accessToken: string; accessTokenExpiryDate: string; refreshToken: string; refreshTokenExpiryDate: string };

let lastCall = 0;
async function throttle(minGapMs = 1100) {
  const wait = lastCall + minGapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function readTokens(): Promise<Tokens | null> {
  const [r] = await db()<{ config: { tokens?: string } }[]>`select config from public.integrations where provider = 'cj'`;
  if (!r?.config?.tokens) return null;
  try { return JSON.parse(decryptSecret(r.config.tokens)) as Tokens; } catch { return null; }
}

async function storeTokens(t: Tokens) {
  // tokens ficam cifrados (AES-256-GCM) dentro de config; nunca em texto puro
  await db()`update public.integrations set config = config || ${db().json({ tokens: encryptSecret(JSON.stringify(t)) })} where provider = 'cj'`;
}

export class CjClient {
  constructor(private f: typeof fetch = fetch, private gapMs = 1100) {}

  private async raw<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string | string[]>; body?: unknown; token?: string | null } = {}): Promise<CjEnvelope<T>> {
    await throttle(this.gapMs);
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
    let res: Response;
    try {
      res = await this.f(url.toString(), {
        method,
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", ...(opts.token ? { "CJ-Access-Token": opts.token } : {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch (e) {
      throw new SupplierError(`CJ indisponível: ${(e as Error).message}`, true);
    }
    const json = (await res.json().catch(() => null)) as CjEnvelope<T> | null;
    if (!res.ok || !json) throw new SupplierError(`CJ respondeu HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    return json;
  }

  private async token(force = false): Promise<string> {
    const now = Date.now();
    const t = force ? null : await readTokens();
    if (t && Date.parse(t.accessTokenExpiryDate) - now > 3600_000) return t.accessToken;
    if (t && Date.parse(t.refreshTokenExpiryDate) - now > 3600_000) {
      const r = await this.raw<Tokens>("POST", "/authentication/refreshAccessToken", { body: { refreshToken: t.refreshToken } });
      if (r.result && r.data?.accessToken) { await storeTokens(r.data); return r.data.accessToken; }
    }
    const { apiKey } = await getCredentials("cj");
    if (!apiKey) throw new SupplierError("CJ não configurada: informe a API key em Integrações.", false);
    const r = await this.raw<Tokens>("POST", "/authentication/getAccessToken", { body: { apiKey } });
    if (!r.result || !r.data?.accessToken) {
      await markIntegration("cj", false, `Autenticação recusada: ${r.message}`);
      throw new SupplierError(`CJ recusou a API key: ${r.message}`, false);
    }
    await storeTokens(r.data);
    return r.data.accessToken;
  }

  /** Chamada autenticada; renova o token uma vez se a CJ recusar. */
  async call<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string | string[]>; body?: unknown } = {}): Promise<T> {
    let tok = await this.token();
    let r = await this.raw<T>(method, path, { ...opts, token: tok });
    if (!r.result && /token/i.test(r.message ?? "")) {
      tok = await this.token(true);
      r = await this.raw<T>(method, path, { ...opts, token: tok });
    }
    if (!r.result) {
      const err = new SupplierError(`CJ: ${r.message} (código ${r.code})`, r.code === 429 || (r.code >= 500 && r.code < 600));
      (err as SupplierError & { cjCode?: number; cjData?: unknown }).cjCode = r.code;
      (err as SupplierError & { cjCode?: number; cjData?: unknown }).cjData = r.data;
      throw err;
    }
    return r.data;
  }

  async ping() {
    await this.token(true);
    return { ok: true, message: "API key aceita pela CJ (token obtido)." };
  }
}

// ---------------------------------------------------------------------------
// Mapeamentos (puros, testados com respostas no formato da documentação)
// ---------------------------------------------------------------------------
export type CjProduct = {
  pid: string; productNameEn: string; productSku: string; productImageSet?: string[] | string | null; bigImage?: string | null;
  sellPrice?: number | string | null; productWeight?: number | string | null; description?: string | null; categoryName?: string | null;
  variants?: CjVariant[] | null;
};
export type CjVariant = {
  vid: string; variantSku: string; variantNameEn?: string | null; variantKey?: string | null; variantSellPrice?: number | string | null;
  variantWeight?: number | string | null; variantLength?: number | string | null; variantWidth?: number | string | null; variantHeight?: number | string | null;
  variantImage?: string | null; inventories?: { countryCode?: string; totalInventory?: number | string | null }[] | null;
};

/** "12.5" / "10.00-12.00" → menor valor em USD; inválido → null. */
export function parseUsd(v: unknown): number | null {
  if (v == null || v === "") return null;
  const first = String(v).split(/[-~]/)[0].trim();
  const n = Number(first);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function usdToBrlCents(usd: number, rate: number) {
  return Math.round(usd * rate * 100);
}

function images(p: CjProduct): string[] {
  const set = Array.isArray(p.productImageSet) ? p.productImageSet : typeof p.productImageSet === "string" ? (() => { try { return JSON.parse(p.productImageSet as string); } catch { return [p.productImageSet]; } })() : [];
  const all = [...(set as string[]), p.bigImage].filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)).map((u) => u.replace(/^http:/, "https:"));
  return Array.from(new Set(all));
}

export function stockOf(v: CjVariant, country?: string | null): number | null {
  if (!Array.isArray(v.inventories)) return null;
  const rows = country ? v.inventories.filter((i) => i.countryCode === country) : v.inventories;
  return rows.reduce((a, i) => a + Math.max(0, Number(i.totalInventory) || 0), 0);
}

/** Remove tags HTML da descrição da CJ (a loja não renderiza HTML bruto). */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const t = html.replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
  return t || null;
}

export function mapCjProduct(p: CjProduct, cfg: CjConfig): ImportedProduct {
  const rate = cfg.usd_brl_rate;
  if (!rate || rate <= 0) throw new SupplierError("Informe a cotação do dólar (USD→BRL) no cadastro do fornecedor CJ para converter os custos.", false);
  const baseUsd = parseUsd(p.sellPrice);
  const variants = (p.variants ?? []).map((v) => {
    const usd = parseUsd(v.variantSellPrice) ?? baseUsd;
    const options: Record<string, string> = {};
    if (v.variantKey) v.variantKey.split("-").forEach((val, i) => { if (val.trim()) options[i === 0 ? "Opção" : `Opção ${i + 1}`] = val.trim(); });
    return {
      externalId: v.vid, sku: v.variantSku, title: v.variantKey || v.variantNameEn || v.variantSku, options,
      costCents: usd != null ? usdToBrlCents(usd, rate) : 0, stock: stockOf(v, cfg.warehouse_country), image: v.variantImage?.replace(/^http:/, "https:") ?? null,
    };
  });
  return {
    externalId: p.pid, name: p.productNameEn, description: stripHtml(p.description), images: images(p),
    costCents: baseUsd != null ? usdToBrlCents(baseUsd, rate) : Math.min(...variants.map((v) => v.costCents), Infinity) || 0,
    shippingCostCents: null, variants, raw: { pid: p.pid, productSku: p.productSku, weight: p.productWeight, category: p.categoryName },
  };
}

/** Corpo do createOrderV2 a partir do pedido pago. */
export function buildCjOrderBody(input: SupplierOrderInput, cfg: CjConfig) {
  if (!cfg.logistic_name) throw new SupplierError("Defina o método logístico da CJ (logisticName) no cadastro do fornecedor.", false);
  const missing = input.items.filter((i) => !i.supplierVariantRef);
  if (missing.length) throw new SupplierError(`Itens sem o ID da variação na CJ (vid): ${missing.map((m) => m.sku).join(", ")}.`, false);
  const a = input.address;
  return {
    orderNumber: `${input.orderNumber}-${input.supplierOrderId.slice(0, 8)}`,
    shippingCountryCode: "BR",
    shippingCountry: "Brazil",
    shippingProvince: a.state,
    shippingCity: a.city,
    shippingCounty: a.district,
    shippingZip: a.cep,
    shippingCustomerName: a.recipient_name,
    shippingAddress: `${a.street}, ${a.number}`,
    shippingAddress2: [a.complement, a.district].filter(Boolean).join(" - ") || undefined,
    houseNumber: a.number,
    shippingPhone: input.customer.phone ?? undefined,
    email: input.customer.email,
    taxId: input.customer.cpf ?? undefined,
    logisticName: cfg.logistic_name,
    fromCountryCode: cfg.from_country_code || "CN",
    payType: 3,
    remark: `Pedido ${input.orderNumber}`,
    products: input.items.map((i) => ({ vid: i.supplierVariantRef, quantity: i.quantity })),
  };
}

export type CjTrack = { trackingNumber: string; trackingFrom?: string | null; trackingTo?: string | null; logisticName?: string | null; trackingStatus?: string | null; deliveryDay?: string | null; deliveryTime?: string | null; lastMileCarrier?: string | null; lastTrackNumber?: string | null };

export function cjAdapter(f: typeof fetch = fetch, gapMs = 1100): SupplierAdapter & { trackInfo(trackNumber: string | string[]): Promise<CjTrack[]> } {
  const client = new CjClient(f, gapMs);
  return {
    code: "cj",
    label: "CJdropshipping (API)",
    ping: () => client.ping(),
    async fetchProduct(externalId: string, cfg: CjConfig = {}) {
      // "sku:CJ123…" ou "pid:…" força o tipo; sem prefixo, IDs no formato UUID são tratados como pid.
      const m = /^(sku|pid):(.+)$/i.exec(externalId.trim());
      const ref = m ? m[2].trim() : externalId.trim();
      const isPid = m ? m[1].toLowerCase() === "pid" : /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(ref);
      const data = await client.call<CjProduct>("GET", "/product/query", { query: isPid ? { pid: ref } : { productSku: ref } });
      if (!data?.pid) throw new SupplierError(`Produto ${externalId} não encontrado na CJ.`, false);
      return mapCjProduct(data, cfg);
    },
    async createOrder(input: SupplierOrderInput): Promise<SupplierOrderResult> {
      const cfg = input.config as CjConfig;
      const body = buildCjOrderBody(input, cfg);
      try {
        const data = await client.call<{ orderId?: string; orderNumber?: string; orderStatus?: string }>("POST", "/shopping/order/createOrderV2", { body });
        if (!data?.orderId) throw new SupplierError("CJ não devolveu o número do pedido.", true);
        return { kind: "submitted", externalOrderId: data.orderId, raw: { ...data, payType: 3, note: "Pedido criado sem pagamento: pagar no painel da CJ." } };
      } catch (e) {
        const err = e as SupplierError & { cjData?: { orderId?: string } };
        // Reenvio após falha de rede: a CJ recusa orderNumber duplicado e pode devolver o pedido existente.
        if (/ORDER_CODE_EXIST/i.test(err.message) || err.cjData?.orderId) {
          if (err.cjData?.orderId) return { kind: "submitted", externalOrderId: err.cjData.orderId, raw: { duplicate: true, ...err.cjData } };
          throw new SupplierError(`O pedido ${body.orderNumber} já existe na CJ. Confira no painel da CJ e registre o número manualmente.`, false);
        }
        throw e;
      }
    },
    /** Aceita vários códigos: a CJ documenta consulta em lote repetindo o parâmetro trackNumber. */
    async trackInfo(trackNumber: string | string[]) {
      return (await client.call<CjTrack[] | null>("GET", "/logistic/trackInfo", { query: { trackNumber } })) ?? [];
    },
  } as SupplierAdapter & { trackInfo(trackNumber: string | string[]): Promise<CjTrack[]> };
}
