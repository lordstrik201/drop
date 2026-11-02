import { getCredentials, markIntegration, missingFields, type Provider } from "@/lib/integrations/credentials";
import { getPayment, MercadoPagoError } from "@/lib/integrations/payments/mercadopago";
import { sendWithResend } from "@/lib/integrations/email/resend";
import { readSetting } from "@/lib/settings";
import { db } from "@/lib/db/client";

export type HealthResult = { ok: boolean; message: string };

/**
 * Testes de conexão do painel. Usam somente endpoints já documentados e
 * consultados para as integrações, sem criar cobranças, pedidos ou etiquetas:
 *
 * - Mercado Pago: GET /v1/payments/0. Um token válido recebe 404 (pagamento
 *   inexistente); um token inválido recebe 401/403. Nada é criado.
 * - Melhor Envio: POST /api/v2/me/shipment/calculate com um pacote de teste
 *   (CEP de origem → CEP de origem). Cotação não gera custo nem etiqueta.
 * - Resend: envia um e-mail de teste somente para o próprio usuário do painel.
 */
export async function testIntegration(provider: Provider, opts: { staffEmail: string; f?: typeof fetch }): Promise<HealthResult> {
  const f = opts.f ?? fetch;
  const creds = await getCredentials(provider);
  const missing = missingFields(provider, creds);
  if (missing.length) return { ok: false, message: `Credenciais ausentes: ${missing.join(", ")}` };
  let result: HealthResult;
  try {
    result = await run(provider, creds, opts.staffEmail, f);
  } catch (e) {
    result = { ok: false, message: (e as Error).message };
  }
  if (result.ok) await markIntegration(provider, true);
  else await markIntegration(provider, false, result.message.slice(0, 500));
  return result;
}

async function run(provider: Provider, creds: Record<string, string>, staffEmail: string, f: typeof fetch): Promise<HealthResult> {
  switch (provider) {
    case "mercadopago": {
      try {
        await getPayment(creds.accessToken, "0", f);
        return { ok: true, message: "Token aceito pelo Mercado Pago." };
      } catch (e) {
        if (e instanceof MercadoPagoError && e.status === 404) {
          const test = creds.accessToken.startsWith("TEST-");
          return { ok: true, message: `Token aceito pelo Mercado Pago (credencial de ${test ? "TESTE" : "produção"}).` };
        }
        if (e instanceof MercadoPagoError && (e.status === 401 || e.status === 403)) return { ok: false, message: "Token do Mercado Pago recusado (inválido ou sem permissão)." };
        throw e;
      }
    }
    case "melhorenvio": {
      const shipping = await readSetting("shipping", db());
      const origin = shipping.origin_cep.replace(/\D/g, "");
      if (origin.length !== 8) return { ok: false, message: "Configure o CEP de origem (Configurações → Frete) para testar." };
      const base = process.env.MELHORENVIO_ENV === "production" ? "https://melhorenvio.com.br" : "https://sandbox.melhorenvio.com.br";
      const res = await f(`${base}/api/v2/me/shipment/calculate`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${creds.token}`, "User-Agent": creds.userAgent },
        body: JSON.stringify({ from: { postal_code: origin }, to: { postal_code: origin }, products: [{ id: "teste", width: 20, height: 20, length: 20, weight: 1, insurance_value: 50, quantity: 1 }] }),
      });
      if (res.status === 401) return { ok: false, message: "Token do Melhor Envio inválido ou expirado (renove a cada 30 dias)." };
      if (!res.ok) return { ok: false, message: `Melhor Envio respondeu HTTP ${res.status}.` };
      const body = (await res.json().catch(() => [])) as { error?: string }[];
      const okServices = Array.isArray(body) ? body.filter((s) => !s.error).length : 0;
      return { ok: true, message: `Cotação de teste respondida (${okServices} serviço(s) disponível(is), ambiente ${process.env.MELHORENVIO_ENV === "production" ? "produção" : "sandbox"}).` };
    }
    case "resend": {
      const store = await readSetting("store.identity", db());
      const r = await sendWithResend(creds.apiKey, {
        from: creds.from, to: staffEmail, subject: `Teste de e-mail — ${store.name}`,
        html: `<p>Este é um e-mail de teste enviado pelo painel da loja ${store.name}. Se você recebeu, o envio de e-mails transacionais está funcionando.</p>`,
        text: `Este é um e-mail de teste enviado pelo painel da loja ${store.name}.`,
        idempotencyKey: `test:${staffEmail}:${Math.floor(Date.now() / 60000)}`,
      }, f);
      return { ok: true, message: `E-mail de teste enviado para ${staffEmail} (id ${r.id}).` };
    }
    case "cj":
    case "dropi":
      return { ok: false, message: "Teste de conexão deste fornecedor é feito na tela do fornecedor (Catálogo → Fornecedores)." };
  }
}
