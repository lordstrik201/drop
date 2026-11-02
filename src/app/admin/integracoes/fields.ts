import type { Provider } from "@/lib/integrations/credentials";

export type FieldDef = { key: string; label: string; env: string; secret: boolean; help?: string };

/** Campos de cada integração e a variável de ambiente equivalente (que tem prioridade). */
export const PROVIDER_FIELDS: Record<Exclude<Provider, "dropi">, FieldDef[]> = {
  mercadopago: [
    { key: "accessToken", label: "Access token", env: "MERCADOPAGO_ACCESS_TOKEN", secret: true, help: "Suas integrações → Credenciais. Use as de teste em homologação." },
    { key: "publicKey", label: "Public key", env: "MERCADOPAGO_PUBLIC_KEY", secret: false },
    { key: "webhookSecret", label: "Assinatura secreta do webhook", env: "MERCADOPAGO_WEBHOOK_SECRET", secret: true, help: "Suas integrações → Webhooks → assinatura secreta." },
  ],
  melhorenvio: [
    { key: "token", label: "Token de acesso", env: "MELHORENVIO_TOKEN", secret: true, help: "Expira em 30 dias: renove antes do vencimento." },
    { key: "userAgent", label: "User-Agent (Aplicação + e-mail técnico)", env: "MELHORENVIO_USER_AGENT", secret: false, help: "Ex.: Minha Loja (tecnico@minhaloja.com.br)" },
  ],
  cj: [{ key: "apiKey", label: "API key", env: "CJ_API_KEY", secret: true }],
  resend: [
    { key: "apiKey", label: "API key", env: "RESEND_API_KEY", secret: true },
    { key: "from", label: "Remetente", env: "EMAIL_FROM", secret: false, help: "Ex.: Minha Loja <pedidos@minhaloja.com.br> (domínio verificado no Resend)" },
  ],
};
