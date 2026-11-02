import { db } from "@/lib/db/client";

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE = /(token|secret|password|senha|authorization|cookie|cpf|card|cvv|api[_-]?key)/i;

/** Remove campos sensíveis antes de gravar logs. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 4000) return value.slice(0, 4000) + "…";
  return value;
}

/**
 * Log técnico: vai para o console (logs da hospedagem) e, para warn/error,
 * também para a tabela app_logs, visível no painel de diagnóstico.
 * Falhar ao gravar o log nunca derruba a operação principal, mas é exibido no console.
 */
export async function log(level: Level, source: string, message: string, context?: Record<string, unknown>) {
  const ctx = context ? (redact(context) as Record<string, unknown>) : undefined;
  const line = `[${level}] [${source}] ${message}`;
  if (level === "error") console.error(line, ctx ?? "");
  else if (level === "warn") console.warn(line, ctx ?? "");
  else if (process.env.APP_ENV !== "test") console.log(line, ctx ?? "");

  if (level === "warn" || level === "error" || level === "info") {
    try {
      await db()`insert into public.app_logs (level, source, message, context) values (${level}, ${source}, ${message}, ${ctx ? db().json(ctx as never) : null})`;
    } catch (e) {
      console.error("[logger] falha ao gravar app_logs", e);
    }
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : JSON.stringify(e);
}
