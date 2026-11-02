import { z } from "zod";

/**
 * Variáveis de ambiente validadas.
 *
 * Variáveis obrigatórias fazem a aplicação falhar cedo e de forma explícita.
 * Variáveis de integração são opcionais: quando ausentes, a integração aparece
 * como "aguardando configuração" no painel, nunca como conectada.
 */
const optional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const serverSchema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  /** "require" em produção/homologação (Supabase); "disable" apenas local. */
  DATABASE_SSL: z.enum(["require", "disable", "prefer"]).default("require"),

  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,

  /** Chave de 32 bytes em base64 usada para cifrar segredos guardados no banco. */
  APP_ENCRYPTION_KEY: optional,
  /** Segredo exigido pelos endpoints de tarefas agendadas (/api/cron/*). */
  CRON_SECRET: optional,

  MERCADOPAGO_ACCESS_TOKEN: optional,
  MERCADOPAGO_PUBLIC_KEY: optional,
  MERCADOPAGO_WEBHOOK_SECRET: optional,

  MELHORENVIO_TOKEN: optional,
  MELHORENVIO_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  /** Melhor Envio exige User-Agent com nome da aplicação e e-mail técnico. */
  MELHORENVIO_USER_AGENT: optional,

  CJ_API_KEY: optional,

  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Usado apenas em testes para recarregar variáveis alteradas. */
export function resetEnvCache() {
  cached = null;
}

export const isProduction = () => env().APP_ENV === "production";
