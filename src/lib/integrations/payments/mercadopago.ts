/**
 * Integração Mercado Pago — Checkout Pro (API de Preferências).
 *
 * Fontes oficiais consultadas (nov/2026):
 * - Criar preferência: POST https://api.mercadopago.com/checkout/preferences
 *   https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-pro-preferences/create-preference/post
 * - Notificações (webhooks) e validação de x-signature:
 *   https://www.mercadopago.com.br/developers/en/docs/checkout-pro-preferences/payment-notifications.md
 *   manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};" → HMAC-SHA256 (hex) com a assinatura secreta,
 *   comparado com v1 em tempo constante; data.id em minúsculas; pares ausentes são omitidos.
 *   Resposta esperada: 200/201 em até 22 s; o Mercado Pago reenvia em caso de falha.
 * - Consultar pagamento: GET https://api.mercadopago.com/v1/payments/{id}
 * - Reembolso: POST https://api.mercadopago.com/v1/payments/{id}/refunds (X-Idempotency-Key obrigatório;
 *   sem "amount" = reembolso total). Prazo de 180 dias após a aprovação.
 *   https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api-payments/create-refund/post
 *
 * Nenhum dado de cartão passa pelo nosso servidor: o cliente paga na página do
 * Mercado Pago (Pix, cartão de crédito, cartão de débito e demais meios
 * habilitados na conta) e recebemos apenas o resultado.
 */
import { hmacSha256Hex, safeEqual } from "@/lib/security/crypto";
import type { PaymentStatus } from "@/lib/types";

const API = "https://api.mercadopago.com";

export type FetchLike = typeof fetch;

export class MercadoPagoError extends Error {
  constructor(message: string, public status: number, public body: unknown, public retryable: boolean) {
    super(message);
  }
}

async function call<T>(f: FetchLike, token: string, method: string, path: string, body?: unknown, idem?: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await f(`${API}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idem ? { "X-Idempotency-Key": idem } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      const msg = (json as { message?: string })?.message ?? `HTTP ${res.status}`;
      throw new MercadoPagoError(`Mercado Pago: ${msg}`, res.status, json, res.status >= 500 || res.status === 429);
    }
    return json as T;
  } catch (e) {
    if (e instanceof MercadoPagoError) throw e;
    throw new MercadoPagoError(`Mercado Pago indisponível: ${(e as Error).message}`, 0, null, true);
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Preferência (Checkout Pro)
// ---------------------------------------------------------------------------
export type PreferenceInput = {
  orderId: string;
  orderNumber: number;
  items: { id: string; title: string; quantity: number; unitPriceCents: number; pictureUrl?: string | null }[];
  shippingCents: number;
  discountCents: number;
  payer: { name: string; email: string; cpf?: string | null; phone?: string | null };
  siteUrl: string;
  expiresAt: Date;
  statementDescriptor?: string;
  /** Tipos ocultos (ids de payment_type_id) e parcelas máximas (1–36). */
  paymentMethods?: { excludedTypes: string[]; installments: number };
};

export type Preference = { id: string; init_point: string; sandbox_init_point?: string };

/**
 * Monta o corpo da preferência. O desconto é distribuído nos itens para que a
 * soma cobrada pelo Mercado Pago seja exatamente o total do pedido.
 */
export function buildPreferenceBody(i: PreferenceInput) {
  const [first, ...rest] = i.payer.name.trim().split(/\s+/);
  const phone = (i.payer.phone ?? "").replace(/\D/g, "");
  const items = i.items.map((it) => ({
    id: it.id,
    title: it.title.slice(0, 250),
    quantity: it.quantity,
    currency_id: "BRL",
    unit_price: it.unitPriceCents / 100,
    ...(it.pictureUrl ? { picture_url: it.pictureUrl } : {}),
  }));
  if (i.discountCents > 0) {
    // Item de desconto com preço negativo não é aceito; reduzimos os preços dos itens
    // proporcionalmente e um item "Ajuste" absorve centavos residuais.
    const subtotal = i.items.reduce((s, it) => s + it.unitPriceCents * it.quantity, 0);
    const target = subtotal - i.discountCents;
    items.length = 0;
    items.push({ id: `pedido-${i.orderNumber}`, title: `Pedido ${i.orderNumber} (com desconto)`, quantity: 1, currency_id: "BRL", unit_price: target / 100 });
  }
  return {
    items,
    payer: {
      name: first,
      surname: rest.join(" ") || undefined,
      email: i.payer.email,
      ...(i.payer.cpf ? { identification: { type: "CPF", number: i.payer.cpf } } : {}),
      ...(phone.length >= 10 ? { phone: { area_code: phone.slice(0, 2), number: phone.slice(2) } } : {}),
    },
    shipments: i.shippingCents > 0 ? { cost: i.shippingCents / 100, mode: "not_specified" } : undefined,
    back_urls: {
      success: `${i.siteUrl}/checkout/retorno?pedido=${i.orderId}`,
      pending: `${i.siteUrl}/checkout/retorno?pedido=${i.orderId}`,
      failure: `${i.siteUrl}/checkout/retorno?pedido=${i.orderId}`,
    },
    auto_return: "approved",
    notification_url: `${i.siteUrl}/api/webhooks/mercadopago`,
    external_reference: i.orderId,
    statement_descriptor: i.statementDescriptor?.slice(0, 22),
    expires: true,
    expiration_date_to: i.expiresAt.toISOString(),
    metadata: { order_number: i.orderNumber },
    ...(i.paymentMethods
      ? { payment_methods: {
          excluded_payment_types: i.paymentMethods.excludedTypes.filter((t) => t !== "account_money").map((id) => ({ id })),
          installments: Math.min(36, Math.max(1, Math.floor(i.paymentMethods.installments))),
        } }
      : {}),
  };
}

/**
 * Meios de pagamento disponíveis para a conta (GET /v1/payment_methods).
 * https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api-payments/payment-methods/get
 */
export type MpPaymentMethod = { id: string; name: string; payment_type_id: string; status: string; secure_thumbnail?: string };
export async function listPaymentMethods(token: string, f: FetchLike = fetch): Promise<MpPaymentMethod[]> {
  return call<MpPaymentMethod[]>(f, token, "GET", "/v1/payment_methods");
}

export async function createPreference(token: string, input: PreferenceInput, f: FetchLike = fetch): Promise<Preference> {
  return call<Preference>(f, token, "POST", "/checkout/preferences", buildPreferenceBody(input));
}

// ---------------------------------------------------------------------------
// Pagamento
// ---------------------------------------------------------------------------
export type MpPayment = {
  id: number;
  status: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount: number;
  transaction_amount_refunded?: number;
  currency_id?: string;
  payment_method_id?: string;
  payment_type_id?: string;
  installments?: number;
  date_approved?: string | null;
  money_release_date?: string | null;
  live_mode?: boolean;
  fee_details?: { type: string; amount: number; fee_payer?: string }[];
  transaction_details?: { net_received_amount?: number; total_paid_amount?: number };
  refunds?: { id: number; amount: number; date_created: string; status?: string }[];
};

export async function getPayment(token: string, id: string, f: FetchLike = fetch): Promise<MpPayment> {
  if (!/^\d{1,20}$/.test(id)) throw new MercadoPagoError("ID de pagamento inválido", 400, null, false);
  return call<MpPayment>(f, token, "GET", `/v1/payments/${id}`);
}

export async function createRefund(token: string, paymentId: string, amountCents: number | null, idempotencyKey: string, f: FetchLike = fetch) {
  return call<{ id: number; payment_id: number; amount: number; status?: string }>(
    f, token, "POST", `/v1/payments/${paymentId}/refunds`, amountCents == null ? {} : { amount: amountCents / 100 }, idempotencyKey,
  );
}

const toCents = (v: number | undefined | null) => Math.round((v ?? 0) * 100);

const STATUS_MAP: Record<string, PaymentStatus> = {
  pending: "pending",
  in_process: "in_process",
  in_mediation: "in_process",
  authorized: "authorized",
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
  refunded: "refunded",
  charged_back: "charged_back",
};

const METHOD_MAP: Record<string, string> = {
  credit_card: "credit_card",
  debit_card: "debit_card",
  prepaid_card: "debit_card",
  bank_transfer: "pix",
  ticket: "boleto",
  account_money: "account_money",
  atm: "boleto",
};

export type PaymentSnapshot = {
  provider: "mercadopago";
  providerPaymentId: string;
  orderId: string | null;
  status: PaymentStatus;
  statusDetail: string | null;
  amount: number;
  fee: number;
  net: number | null;
  refunded: number;
  method: string | null;
  installments: number | null;
  approvedAt: Date | null;
  releaseDate: Date | null;
  liveMode: boolean | null;
  currency: string;
  refunds: { id: string; amount: number; at: Date }[];
  raw: unknown;
};

/** Converte a resposta oficial em valores internos (centavos). */
export function mapPayment(p: MpPayment): PaymentSnapshot {
  const refunded = toCents(p.transaction_amount_refunded);
  let status = STATUS_MAP[p.status] ?? "pending";
  if (status === "approved" && refunded > 0 && refunded < toCents(p.transaction_amount)) status = "partially_refunded";
  const fee = (p.fee_details ?? []).filter((f) => !f.fee_payer || f.fee_payer === "collector").reduce((s, f) => s + toCents(f.amount), 0);
  return {
    provider: "mercadopago",
    providerPaymentId: String(p.id),
    orderId: p.external_reference ?? null,
    status,
    statusDetail: p.status_detail ?? null,
    amount: toCents(p.transaction_amount),
    fee,
    net: p.transaction_details?.net_received_amount != null ? toCents(p.transaction_details.net_received_amount) : null,
    refunded,
    method: METHOD_MAP[p.payment_type_id ?? ""] ?? p.payment_type_id ?? null,
    installments: p.installments ?? null,
    approvedAt: p.date_approved ? new Date(p.date_approved) : null,
    releaseDate: p.money_release_date ? new Date(p.money_release_date) : null,
    liveMode: p.live_mode ?? null,
    currency: p.currency_id ?? "BRL",
    refunds: (p.refunds ?? []).map((r) => ({ id: String(r.id), amount: toCents(r.amount), at: new Date(r.date_created) })),
    raw: p,
  };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
export type SignatureCheck = { valid: boolean; reason?: string; ts?: number };

/**
 * Valida o cabeçalho x-signature ("ts=...,v1=...") conforme a documentação.
 * Também rejeita notificações com carimbo de tempo muito antigo (replay).
 */
export function verifyWebhookSignature(params: {
  secret: string;
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
  now?: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const { secret, signatureHeader, requestId, dataId } = params;
  if (!secret) return { valid: false, reason: "Assinatura secreta não configurada" };
  if (!signatureHeader) return { valid: false, reason: "Cabeçalho x-signature ausente" };
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "ts") ts = v;
    if (k === "v1") v1 = v;
  }
  if (!ts || !v1) return { valid: false, reason: "x-signature malformado" };
  let manifest = "";
  if (dataId) manifest += `id:${dataId.toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const computed = hmacSha256Hex(secret, manifest);
  if (!safeEqual(computed, v1)) return { valid: false, reason: "Assinatura não confere" };
  const tsNum = Number(ts);
  // ts pode vir em segundos ou milissegundos
  const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  const tol = (params.toleranceSeconds ?? 60 * 60 * 24 * 10) * 1000; // reenvios oficiais chegam a dias depois
  if (Math.abs((params.now ?? Date.now()) - tsMs) > tol) return { valid: false, reason: "Notificação fora da janela de tempo", ts: tsNum };
  return { valid: true, ts: tsNum };
}
