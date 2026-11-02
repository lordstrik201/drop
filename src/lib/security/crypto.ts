import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifra segredos (ex.: credenciais de integração digitadas no painel) com
 * AES-256-GCM. A chave vem de APP_ENCRYPTION_KEY (32 bytes em base64) e nunca
 * é gravada no banco. Formato: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
function keyFrom(b64: string | undefined): Buffer {
  if (!b64) throw new Error("APP_ENCRYPTION_KEY não configurada: não é possível guardar segredos no banco.");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY deve ter 32 bytes em base64 (gere com: openssl rand -base64 32)");
  return key;
}

export function encryptSecret(plain: string, keyB64 = process.env.APP_ENCRYPTION_KEY): string {
  const key = keyFrom(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, keyB64 = process.env.APP_ENCRYPTION_KEY): string {
  const key = keyFrom(keyB64);
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Segredo em formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Comparação em tempo constante (evita ataques de temporização). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Mascara um segredo para exibição (ex.: "APP_USR-****1234"). */
export function maskSecret(s: string | null | undefined): string {
  if (!s) return "";
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}
