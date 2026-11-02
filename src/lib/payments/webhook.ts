import { db } from "@/lib/db/client";
import { verifyWebhookSignature } from "@/lib/integrations/payments/mercadopago";
import { getCredentials } from "@/lib/integrations/credentials";
import { enqueueJob } from "@/lib/jobs/queue";
import { syncMercadoPagoPayment } from "./service";
import { errorMessage, log } from "@/lib/logger";
import type { FetchLike } from "@/lib/integrations/payments/mercadopago";

const KEEP_HEADERS = ["x-request-id", "x-signature", "user-agent", "content-type"];

/**
 * Recebe uma notificação do Mercado Pago:
 * 1) valida a assinatura (x-signature) — inválida → 401 e registro "rejected";
 * 2) grava o evento (deduplicado);
 * 3) consulta o pagamento na API oficial e aplica ao pedido;
 * 4) em falha transitória, agenda nova tentativa e responde 200 (o evento está salvo).
 */
export async function handleMercadoPagoWebhook(req: Request, f: FetchLike = fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(req.url);
  const raw = await req.text();
  if (raw.length > 64 * 1024) return { status: 413, body: { error: "payload too large" } };
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }
  const data = (payload.data ?? {}) as { id?: string | number };
  const dataId = url.searchParams.get("data.id") ?? (data.id != null ? String(data.id) : null) ?? url.searchParams.get("id");
  const type = url.searchParams.get("type") ?? (payload.type as string | undefined) ?? url.searchParams.get("topic") ?? null;
  const requestId = req.headers.get("x-request-id");
  const sigHeader = req.headers.get("x-signature");

  const creds = await getCredentials("mercadopago");
  const check = verifyWebhookSignature({ secret: creds.webhookSecret ?? "", signatureHeader: sigHeader, requestId, dataId });
  const headers = Object.fromEntries(KEEP_HEADERS.map((h) => [h, req.headers.get(h)]).filter(([, v]) => v));
  const dedupe = `mercadopago:${requestId ?? `${type}:${dataId}:${sigHeader ?? "nosig"}`}`;

  const sql = db();
  const [ev] = await sql<{ id: string; status: string }[]>`
    insert into public.webhook_events (provider, event_type, resource_id, dedupe_key, signature_valid, headers, payload, status, error)
    values ('mercadopago', ${type}, ${dataId}, ${dedupe}, ${check.valid}, ${sql.json(headers as never)}, ${sql.json(payload as never)},
            ${check.valid ? "received" : "rejected"}, ${check.valid ? null : check.reason ?? null})
    on conflict (dedupe_key) do update set attempts = public.webhook_events.attempts + 1
    returning id, status`;

  if (!check.valid) {
    await log("warn", "mercadopago", `Webhook rejeitado: ${check.reason}`, { dataId, type });
    return { status: 401, body: { error: "invalid signature" } };
  }
  if (ev.status === "processed" || ev.status === "ignored") return { status: 200, body: { ok: true, duplicate: true } };

  if (type !== "payment" || !dataId || !/^\d+$/.test(dataId)) {
    await sql`update public.webhook_events set status = 'ignored', processed_at = now() where id = ${ev.id}`;
    return { status: 200, body: { ok: true, ignored: true } };
  }

  try {
    const r = await syncMercadoPagoPayment(dataId, f);
    await sql`update public.webhook_events set status = 'processed', processed_at = now(), error = null where id = ${ev.id}`;
    return { status: 200, body: { ok: true, order: r.orderId, orderStatus: r.orderStatus } };
  } catch (e) {
    const msg = errorMessage(e);
    await sql`update public.webhook_events set status = 'failed', error = ${msg.slice(0, 2000)} where id = ${ev.id}`;
    await enqueueJob(sql, "payment.sync", { providerPaymentId: dataId, webhookEventId: ev.id }, `payment.sync:${dataId}:${ev.id}`);
    await log("error", "mercadopago", `Falha ao processar webhook do pagamento ${dataId}; reprocessamento agendado`, { error: msg });
    return { status: 200, body: { ok: true, queued: true } };
  }
}
