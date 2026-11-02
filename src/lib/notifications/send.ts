import { db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getCredentials } from "@/lib/integrations/credentials";
import { sendWithResend } from "@/lib/integrations/email/resend";
import { readSetting } from "@/lib/settings";
import { PermanentJobError } from "@/lib/jobs/queue";
import { renderOrderEmail, type OrderTemplate } from "./templates";

/**
 * Notificação transacional de pedido. Registra em "notifications" com chave
 * única (um e-mail por evento). Sem provedor configurado, o registro fica como
 * "skipped" com o motivo — visível no monitoramento, nunca fingindo envio.
 */
export async function sendOrderNotification(orderId: string, template: OrderTemplate, f: typeof fetch = fetch) {
  const sql = db();
  const dedupe = `order:${orderId}:${template}`;
  const [already] = await sql<{ status: string }[]>`select status from public.notifications where dedupe_key = ${dedupe}`;
  if (already?.status === "sent" || already?.status === "skipped") return { status: already.status };

  const cfg = await readSetting("notifications");
  const [o] = await sql`select o.*, s.carrier, s.tracking_code, s.tracking_url from public.orders o
                        left join lateral (select carrier, tracking_code, tracking_url from public.shipments where order_id = o.id order by created_at desc limit 1) s on true
                        where o.id = ${orderId}`;
  if (!o) throw new PermanentJobError("Pedido não encontrado");
  const items = await sql<{ product_name: string; quantity: number; total_cents: number }[]>`select product_name, quantity, total_cents from public.order_items where order_id = ${orderId}`;
  const identity = await readSetting("store.identity");
  const msg = renderOrderEmail(template, {
    storeName: identity.name, siteUrl: env().NEXT_PUBLIC_SITE_URL, customerName: o.customer_name, orderNumber: Number(o.number),
    orderId, totalCents: o.total_cents, items: items.map((i) => ({ name: i.product_name, quantity: i.quantity, totalCents: i.total_cents })),
    trackingCode: o.tracking_code, trackingUrl: o.tracking_url, carrier: o.carrier, cancelReason: o.cancel_reason,
  });

  const record = async (status: string, extra: { error?: string; providerId?: string } = {}) => {
    await sql`insert into public.notifications (profile_id, order_id, recipient, template, subject, status, error, provider_message_id, dedupe_key, sent_at)
              values (${o.profile_id}, ${orderId}, ${o.customer_email}, ${template}, ${msg.subject}, ${status}, ${extra.error ?? null}, ${extra.providerId ?? null}, ${dedupe},
                      ${status === "sent" ? new Date() : null})
              on conflict (dedupe_key) do update set status = excluded.status, error = excluded.error,
                provider_message_id = excluded.provider_message_id, sent_at = excluded.sent_at`;
  };

  if (!cfg[template]) {
    await record("skipped", { error: "Notificação desativada nas configurações" });
    return { status: "skipped" };
  }
  const creds = await getCredentials("resend");
  if (!creds.apiKey || !creds.from) {
    await record("skipped", { error: "Provedor de e-mail não configurado (RESEND_API_KEY / EMAIL_FROM)" });
    return { status: "skipped" };
  }
  try {
    const r = await sendWithResend(creds.apiKey, { from: creds.from, to: o.customer_email, ...msg, idempotencyKey: dedupe }, f);
    await record("sent", { providerId: r.id });
    return { status: "sent" };
  } catch (e) {
    await record("failed", { error: (e as Error).message });
    if ((e as { retryable?: boolean }).retryable) throw e;
    throw new PermanentJobError((e as Error).message);
  }
}
