import { db, type DbOrTx } from "@/lib/db/client";

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

/**
 * Rate limiting em janela fixa guardado no PostgreSQL (funciona em ambiente
 * serverless sem Redis). Uma única instrução atômica por verificação.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  sql: DbOrTx = db(),
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await sql<{ hits: number }[]>`
    insert into public.rate_limits (key, window_start, hits)
    values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
    returning hits`;
  // limpeza oportunista de janelas antigas (1% das chamadas)
  if (Math.random() < 0.01) {
    await sql`delete from public.rate_limits where window_start < now() - interval '1 day'`;
  }
  const resetAt = new Date(windowStart.getTime() + windowSeconds * 1000);
  return { allowed: row.hits <= limit, remaining: Math.max(0, limit - row.hits), resetAt };
}

export class RateLimitError extends Error {
  constructor(public resetAt: Date) {
    super("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const r = await rateLimit(key, limit, windowSeconds);
  if (!r.allowed) throw new RateLimitError(r.resetAt);
}
