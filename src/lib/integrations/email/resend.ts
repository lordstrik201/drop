/**
 * Envio de e-mail pela API do Resend (https://resend.com/docs/api-reference/emails/send-email):
 * POST https://api.resend.com/emails com Authorization: Bearer <api key>,
 * corpo { from, to, subject, html, text, headers? } e cabeçalho Idempotency-Key opcional.
 * Serviço com plano gratuito limitado e planos pagos — ver docs/CUSTOS.md.
 */
export type EmailMessage = { from: string; to: string; subject: string; html: string; text: string; idempotencyKey?: string; headers?: Record<string, string> };

export async function sendWithResend(apiKey: string, msg: EmailMessage, f: typeof fetch = fetch): Promise<{ id: string }> {
  const res = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey.slice(0, 256) } : {}),
    },
    body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(msg.headers ? { headers: msg.headers } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !body.id) {
    const err = new Error(`Resend: ${body.message ?? `HTTP ${res.status}`}`) as Error & { retryable?: boolean };
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  return { id: body.id };
}
