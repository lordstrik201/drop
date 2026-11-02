import { db } from "@/lib/db/client";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";

/**
 * Credenciais de integração. Ordem de precedência:
 * 1) variáveis de ambiente (recomendado em produção);
 * 2) valor cifrado (AES-256-GCM) salvo pelo painel em integrations.secrets_encrypted.
 */
export type Provider = "mercadopago" | "melhorenvio" | "cj" | "dropi" | "resend";

const ENV_MAP: Record<Provider, Record<string, string>> = {
  mercadopago: { accessToken: "MERCADOPAGO_ACCESS_TOKEN", publicKey: "MERCADOPAGO_PUBLIC_KEY", webhookSecret: "MERCADOPAGO_WEBHOOK_SECRET" },
  melhorenvio: { token: "MELHORENVIO_TOKEN", userAgent: "MELHORENVIO_USER_AGENT" },
  cj: { apiKey: "CJ_API_KEY" },
  dropi: {},
  resend: { apiKey: "RESEND_API_KEY", from: "EMAIL_FROM" },
};

export const REQUIRED_FIELDS: Record<Provider, string[]> = {
  mercadopago: ["accessToken", "webhookSecret"],
  melhorenvio: ["token", "userAgent"],
  cj: ["apiKey"],
  dropi: [],
  resend: ["apiKey", "from"],
};

export async function getCredentials(provider: Provider): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const [row] = await db()<{ secrets_encrypted: string | null }[]>`select secrets_encrypted from public.integrations where provider = ${provider}`;
  if (row?.secrets_encrypted) {
    try {
      Object.assign(out, JSON.parse(decryptSecret(row.secrets_encrypted)));
    } catch (e) {
      throw new Error(`Não foi possível decifrar as credenciais de ${provider}: ${(e as Error).message}`);
    }
  }
  for (const [field, envName] of Object.entries(ENV_MAP[provider])) {
    const v = process.env[envName]?.trim();
    if (v) out[field] = v;
  }
  return out;
}

export function missingFields(provider: Provider, creds: Record<string, string>): string[] {
  return REQUIRED_FIELDS[provider].filter((f) => !creds[f]);
}

export async function saveCredentials(provider: Provider, values: Record<string, string>, actorId: string | null) {
  const current = await getStoredOnly(provider);
  const merged = { ...current };
  for (const [k, v] of Object.entries(values)) if (v && v.trim()) merged[k] = v.trim();
  const status = missingFields(provider, { ...merged, ...envOnly(provider) }).length === 0 ? "configured" : "not_configured";
  await db()`update public.integrations set secrets_encrypted = ${encryptSecret(JSON.stringify(merged))}, status = ${status},
             updated_by = ${actorId}, last_error = null where provider = ${provider}`;
}

async function getStoredOnly(provider: Provider): Promise<Record<string, string>> {
  const [row] = await db()<{ secrets_encrypted: string | null }[]>`select secrets_encrypted from public.integrations where provider = ${provider}`;
  return row?.secrets_encrypted ? JSON.parse(decryptSecret(row.secrets_encrypted)) : {};
}

function envOnly(provider: Provider) {
  const out: Record<string, string> = {};
  for (const [field, envName] of Object.entries(ENV_MAP[provider])) if (process.env[envName]?.trim()) out[field] = process.env[envName]!.trim();
  return out;
}

export async function markIntegration(provider: Provider, ok: boolean, error?: string) {
  if (ok) await db()`update public.integrations set status = 'connected', last_check_at = now(), last_success_at = now(), last_error = null where provider = ${provider}`;
  else await db()`update public.integrations set status = 'error', last_check_at = now(), last_error = ${error ?? "erro"} where provider = ${provider}`;
}
