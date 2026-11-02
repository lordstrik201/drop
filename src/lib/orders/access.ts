import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/crypto";

/**
 * Link de acompanhamento para quem comprou sem conta: HMAC do id do pedido.
 * Usa APP_ENCRYPTION_KEY (ou CRON_SECRET) como segredo; sem segredo, o link é recusado.
 */
function secret() {
  const s = process.env.APP_ENCRYPTION_KEY || process.env.CRON_SECRET;
  if (!s) throw new Error("APP_ENCRYPTION_KEY não configurada");
  return s;
}

export function signOrderAccess(orderId: string): string {
  return createHmac("sha256", secret()).update(`order-access:${orderId}`).digest("base64url").slice(0, 32);
}

export function verifyOrderAccess(orderId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    return safeEqual(signOrderAccess(orderId), token);
  } catch {
    return false;
  }
}
