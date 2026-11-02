import { db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getCredentials } from "@/lib/integrations/credentials";
import { sendWithResend } from "@/lib/integrations/email/resend";
import { readSetting } from "@/lib/settings";
import { hmacSha256Hex, safeEqual } from "@/lib/security/crypto";
import { loadCartLines } from "@/lib/cart/cart";
import { formatBRL } from "@/lib/money";
import { log } from "@/lib/logger";

/**
 * Links assinados (HMAC com APP_ENCRYPTION_KEY) para recuperar o carrinho e
 * para descadastrar de e-mails de marketing sem precisar de login.
 */
function secret() {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k) throw new Error("APP_ENCRYPTION_KEY não configurada.");
  return k;
}
export function signToken(purpose: "cart" | "unsub", id: string) {
  return `${id}.${hmacSha256Hex(secret(), `${purpose}:${id}`).slice(0, 32)}`;
}
export function verifyToken(purpose: "cart" | "unsub", token: string | null | undefined): string | null {
  if (!token) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    return safeEqual(sig, hmacSha256Hex(secret(), `${purpose}:${id}`).slice(0, 32)) ? id : null;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Candidate = { id: string; profile_id: string; email: string; full_name: string | null };

/**
 * Carrinhos elegíveis: abertos, com itens, sem atividade há N horas, de cliente
 * com conta e consentimento de marketing ativo, ainda sem lembrete.
 * Base legal: consentimento (LGPD art. 7º, I). Sem consentimento, nada é enviado.
 */
export async function abandonedCandidates(delayHours: number, limit = 50) {
  return db()<Candidate[]>`
    select c.id, p.id as profile_id, p.email, p.full_name
    from public.carts c join public.profiles p on p.id = c.profile_id
    where c.status = 'open' and c.recovery_email_sent_at is null
      and c.updated_at < now() - make_interval(hours => ${delayHours})
      and c.updated_at > now() - interval '7 days'
      and p.marketing_consent and not p.is_blocked
      and exists (select 1 from public.cart_items ci where ci.cart_id = c.id)
      and not exists (select 1 from public.orders o where o.profile_id = p.id and o.created_at > c.updated_at)
    order by c.updated_at limit ${limit}`;
}

export async function sendAbandonedCartEmails(f: typeof fetch = fetch) {
  const cfg = await readSetting("marketing");
  if (!cfg.abandoned_cart_enabled) return { skipped: "Recuperação de carrinho desativada." };
  const creds = await getCredentials("resend");
  if (!creds.apiKey || !creds.from) return { skipped: "Provedor de e-mail não configurado." };
  if (!process.env.APP_ENCRYPTION_KEY) return { skipped: "APP_ENCRYPTION_KEY não configurada (necessária para links seguros)." };
  const site = env().NEXT_PUBLIC_SITE_URL;
  const identity = await readSetting("store.identity");
  const sql = db();
  let sent = 0, failed = 0;
  for (const c of await abandonedCandidates(cfg.abandoned_cart_delay_hours ?? 4)) {
    const lines = (await loadCartLines(c.id)).filter((l) => l.available);
    // marca antes de enviar: no máximo um lembrete por carrinho, mesmo se o envio falhar
    const [claimed] = await sql`update public.carts set recovery_email_sent_at = now() where id = ${c.id} and recovery_email_sent_at is null returning id`;
    if (!claimed || !lines.length) continue;
    const recover = `${site}/carrinho/recuperar?t=${encodeURIComponent(signToken("cart", c.id))}`;
    const unsub = `${site}/descadastrar?t=${encodeURIComponent(signToken("unsub", c.profile_id))}`;
    const first = (c.full_name ?? "").split(" ")[0] || "Olá";
    const subject = `Você esqueceu itens no carrinho — ${identity.name}`;
    const rows = lines.slice(0, 6).map((l) => `<li>${esc(l.name)}${l.variantTitle && l.variantTitle !== "Padrão" ? ` (${esc(l.variantTitle)})` : ""} × ${l.quantity} — ${formatBRL(l.unitPrice * l.quantity)}</li>`).join("");
    const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:24px auto;padding:24px;border:1px solid #e4e4e7;border-radius:12px">
<h1 style="font-size:20px">${esc(identity.name)}</h1><p>${esc(first)}, seus itens ainda estão no carrinho:</p><ul>${rows}</ul>
<p>Preços e estoque podem mudar até a finalização da compra.</p>
<p><a href="${recover}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Voltar ao carrinho</a></p>
<p style="font-size:12px;color:#71717a">Você recebeu este e-mail porque autorizou comunicações da loja. <a href="${unsub}">Não quero mais receber</a>.</p>
</div></body></html>`;
    const text = `${first}, seus itens ainda estão no carrinho:\n${lines.map((l) => `- ${l.name} x${l.quantity}`).join("\n")}\n\nVoltar ao carrinho: ${recover}\nPreços e estoque podem mudar.\n\nDescadastrar: ${unsub}`;
    const dedupe = `cart_recovery:${c.id}`;
    try {
      const r = await sendWithResend(creds.apiKey, { from: creds.from, to: c.email, subject, html, text, idempotencyKey: dedupe, headers: { "List-Unsubscribe": `<${unsub}>` } }, f);
      await sql`insert into public.notifications (profile_id, recipient, template, subject, is_marketing, status, provider_message_id, dedupe_key, sent_at)
                values (${c.profile_id}, ${c.email}, 'cart_recovery', ${subject}, true, 'sent', ${r.id}, ${dedupe}, now()) on conflict (dedupe_key) do nothing`;
      sent++;
    } catch (e) {
      failed++;
      await sql`insert into public.notifications (profile_id, recipient, template, subject, is_marketing, status, error, dedupe_key)
                values (${c.profile_id}, ${c.email}, 'cart_recovery', ${subject}, true, 'failed', ${(e as Error).message}, ${dedupe}) on conflict (dedupe_key) do nothing`;
    }
  }
  if (failed) await log("warn", "marketing", `Recuperação de carrinho: ${failed} envio(s) falharam`, { sent, failed });
  return { sent, failed };
}

/** Descadastro pelo link do e-mail (registra a data, como no painel do cliente). */
export async function unsubscribe(token: string) {
  const id = verifyToken("unsub", token);
  if (!id) throw new Error("Link inválido ou expirado.");
  await db()`update public.profiles set marketing_consent = false, marketing_consent_at = now() where id = ${id} and marketing_consent`;
  return id;
}

/** Métricas da recuperação (carrinhos lembrados e convertidos depois do lembrete). */
export async function recoveryStats(days = 30) {
  const [r] = await db()<{ reminded: number; recovered: number; recovered_cents: number; open_carts: number }[]>`
    select count(*) filter (where c.recovery_email_sent_at is not null)::int as reminded,
           count(*) filter (where c.recovery_email_sent_at is not null and c.status = 'converted')::int as recovered,
           coalesce(sum(o.total_cents) filter (where c.recovery_email_sent_at is not null and c.status = 'converted' and o.paid_at is not null), 0)::int as recovered_cents,
           count(*) filter (where c.status = 'open' and exists (select 1 from public.cart_items ci where ci.cart_id = c.id))::int as open_carts
    from public.carts c left join public.orders o on o.id = c.converted_order_id
    where c.updated_at > now() - make_interval(days => ${days})`;
  return r;
}
