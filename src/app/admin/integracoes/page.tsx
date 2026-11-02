import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getCredentials, type Provider } from "@/lib/integrations/credentials";
import { maskSecret } from "@/lib/security/crypto";
import { env } from "@/lib/env";
import { Badge, Button, Input } from "@/components/ui";
import { Flash } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/ui/dates";
import { PROVIDER_FIELDS } from "./fields";
import { saveCredentialsAction, testIntegrationAction } from "./actions";

export const metadata = { title: "Integrações" };

const INFO: Record<string, { name: string; what: string; testable: boolean }> = {
  mercadopago: { name: "Mercado Pago", what: "Pagamentos (Pix, cartão de crédito e débito) via Checkout Pro, webhooks e reembolsos.", testable: true },
  melhorenvio: { name: "Melhor Envio", what: "Cotação de frete em tempo real (usado quando o modo de frete é “Melhor Envio”).", testable: true },
  resend: { name: "Resend", what: "E-mails transacionais (pedido recebido, pagamento, envio, entrega).", testable: true },
  cj: { name: "CJdropshipping", what: "Importação de produtos, estoque e envio de pedidos (configurado por fornecedor).", testable: false },
  dropi: { name: "Dropi", what: "Fornecedor via Dropi (configurado por fornecedor).", testable: false },
  viacep: { name: "ViaCEP", what: "Preenchimento de endereço pelo CEP. Serviço público, não exige credencial.", testable: false },
};

const STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  not_configured: { label: "Aguardando credenciais", tone: "warning" },
  configured: { label: "Configurado (não testado)", tone: "info" },
  connected: { label: "Conectado", tone: "success" },
  error: { label: "Erro", tone: "danger" },
  disabled: { label: "Desativado", tone: "neutral" },
};

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("monitoring.read");
  const sp = await searchParams;
  const canWrite = await can(user, "integrations.write");
  const rows = await db()<{ provider: string; status: string; last_check_at: Date | null; last_success_at: Date | null; last_error: string | null }[]>`
    select provider, status, last_check_at, last_success_at, last_error from public.integrations order by provider`;
  const site = env().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const keyOk = !!process.env.APP_ENCRYPTION_KEY;

  const cards = await Promise.all(rows.map(async (r) => {
    const fields = PROVIDER_FIELDS[r.provider as keyof typeof PROVIDER_FIELDS] ?? [];
    let creds: Record<string, string> = {};
    let credError: string | null = null;
    if (fields.length) {
      try { creds = await getCredentials(r.provider as Provider); } catch (e) { credError = (e as Error).message; }
    }
    return { ...r, fields, creds, credError };
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Integrações</h1>
        <p className="text-sm text-muted">Credenciais definidas em variáveis de ambiente têm prioridade e não podem ser alteradas aqui. Valores salvos pelo painel ficam cifrados (AES-256-GCM).</p>
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      {!keyOk && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">APP_ENCRYPTION_KEY não definida: não é possível salvar credenciais pelo painel. Use variáveis de ambiente.</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((c) => {
          const info = INFO[c.provider] ?? { name: c.provider, what: "", testable: false };
          const st = c.provider === "viacep" ? { label: "Público", tone: "success" as const } : STATUS[c.status] ?? STATUS.not_configured;
          return (
            <section key={c.provider} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div><h2 className="font-semibold">{info.name}</h2><p className="text-xs text-muted">{info.what}</p></div>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              {(c.last_check_at || c.last_error) && (
                <p className="text-xs text-muted">
                  {c.last_check_at && <>Último teste: {formatDateTime(c.last_check_at)}</>}
                  {c.last_success_at && <> · último sucesso: {formatDateTime(c.last_success_at)}</>}
                  {c.last_error && <span className="mt-1 block rounded bg-red-50 px-2 py-1 text-red-900">{c.last_error}</span>}
                </p>
              )}
              {c.credError && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-900">{c.credError}</p>}
              {c.provider === "mercadopago" && (
                <p className="rounded bg-bg px-2 py-1.5 text-xs">URL do webhook (cadastre no Mercado Pago, evento “Pagamentos”): <code className="break-all">{site}/api/webhooks/mercadopago</code></p>
              )}
              {c.fields.length > 0 && (
                <form action={saveCredentialsAction} className="flex flex-col gap-2">
                  <input type="hidden" name="provider" value={c.provider} />
                  {c.fields.map((fd) => {
                    const fromEnv = !!process.env[fd.env]?.trim();
                    const cur = c.creds[fd.key];
                    return (
                      <label key={fd.key} className="flex flex-col gap-1 text-xs">
                        <span className="font-medium">{fd.label} <span className="font-normal text-muted">· {fromEnv ? `definido em ${fd.env}` : cur ? `atual: ${fd.secret ? maskSecret(cur) : cur}` : "não definido"}</span></span>
                        <Input name={fd.key} type={fd.secret ? "password" : "text"} autoComplete="off" disabled={!canWrite || fromEnv || !keyOk} placeholder={fromEnv ? "Gerenciado pela variável de ambiente" : "Novo valor (vazio mantém o atual)"} />
                        {fd.help && <span className="text-muted">{fd.help}</span>}
                      </label>
                    );
                  })}
                  {canWrite && keyOk && <div><Button size="sm" variant="secondary">Salvar credenciais</Button></div>}
                </form>
              )}
              {canWrite && info.testable && (
                <form action={testIntegrationAction}>
                  <input type="hidden" name="provider" value={c.provider} />
                  <Button size="sm">{c.provider === "resend" ? `Enviar e-mail de teste para ${user.email}` : "Testar conexão"}</Button>
                </form>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
