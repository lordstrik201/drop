import { z } from "zod";
import { isValidCNPJ, onlyDigits } from "@/lib/validation/br";
import { parseBRL } from "@/lib/money";
import type { SettingKey } from "@/lib/settings";

/**
 * Formulários declarativos das configurações: a mesma definição desenha o
 * formulário e valida o envio no servidor.
 */
export type FieldType = "text" | "textarea" | "bool" | "money" | "moneyOpt" | "int" | "color" | "cep" | "url" | "email" | "select" | "percent";
export type SettingField = { key: string; label: string; type: FieldType; help?: string; options?: [string, string][]; max?: number; min?: number; placeholder?: string };
export type SettingForm = { key: SettingKey; title: string; description?: string; fields: SettingField[]; validate?: (v: Record<string, unknown>) => string | null };

const GA4 = /^G-[A-Z0-9]{4,15}$/, GTM = /^GTM-[A-Z0-9]{4,10}$/, PIXEL = /^\d{8,20}$/;

export const SETTING_FORMS: SettingForm[] = [
  {
    key: "store.identity", title: "Identidade visual", description: "Nome, slogan, logotipo e cores da loja.",
    fields: [
      { key: "name", label: "Nome da loja", type: "text", max: 60 },
      { key: "tagline", label: "Slogan", type: "text", max: 120 },
      { key: "logo_url", label: "URL do logotipo", type: "url", help: "Imagem PNG/SVG/WebP hospedada (o envio de arquivos fica em Produtos → Imagens)." },
      { key: "favicon_url", label: "URL do favicon", type: "url" },
      { key: "primary_color", label: "Cor principal", type: "color" },
      { key: "accent_color", label: "Cor de destaque", type: "color" },
    ],
  },
  {
    key: "store.company", title: "Dados da empresa", description: "Aparecem no rodapé e nas políticas (exigência do Decreto 7.962/2013 para lojas online).",
    fields: [
      { key: "legal_name", label: "Razão social", type: "text", max: 150 },
      { key: "cnpj", label: "CNPJ", type: "text", max: 18 },
      { key: "state_registration", label: "Inscrição estadual", type: "text", max: 30 },
      { key: "address", label: "Endereço completo", type: "text", max: 250 },
      { key: "email", label: "E-mail de atendimento", type: "email" },
      { key: "phone", label: "Telefone", type: "text", max: 20 },
      { key: "whatsapp", label: "WhatsApp (somente números, com DDD)", type: "text", max: 15 },
    ],
    validate: (v) => (v.cnpj && !isValidCNPJ(String(v.cnpj)) ? "CNPJ inválido." : null),
  },
  {
    key: "store.social", title: "Redes sociais",
    fields: ["instagram", "facebook", "tiktok", "youtube"].map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), type: "url" as const, placeholder: `https://www.${k}.com/…` })),
  },
  {
    key: "store.seo", title: "SEO", description: "Título e descrição padrão para buscadores e compartilhamento.",
    fields: [
      { key: "title", label: "Título padrão", type: "text", max: 70 },
      { key: "description", label: "Descrição", type: "textarea", max: 170 },
      { key: "keywords", label: "Palavras-chave", type: "text", max: 250 },
    ],
  },
  {
    key: "analytics", title: "Análise e pixels", description: "Os scripts só são carregados quando o ID é preenchido.",
    fields: [
      { key: "ga4_id", label: "Google Analytics 4 (G-XXXX)", type: "text", max: 20 },
      { key: "gtm_id", label: "Google Tag Manager (GTM-XXXX)", type: "text", max: 15 },
      { key: "meta_pixel_id", label: "Pixel da Meta (somente números)", type: "text", max: 20 },
    ],
    validate: (v) =>
      v.ga4_id && !GA4.test(String(v.ga4_id)) ? "ID do GA4 inválido (formato G-XXXXXXX)."
      : v.gtm_id && !GTM.test(String(v.gtm_id)) ? "ID do GTM inválido (formato GTM-XXXXXX)."
      : v.meta_pixel_id && !PIXEL.test(String(v.meta_pixel_id)) ? "ID do Pixel inválido (somente números)." : null,
  },
  {
    key: "checkout", title: "Checkout",
    fields: [
      { key: "require_cpf", label: "Exigir CPF no checkout", type: "bool", help: "Recomendado: exigido por transportadoras e para emissão de nota fiscal." },
      { key: "min_order_cents", label: "Valor mínimo do pedido (R$)", type: "money" },
      { key: "pending_payment_expiration_hours", label: "Cancelar pedidos não pagos após (horas)", type: "int", min: 1, max: 720, help: "O estoque reservado é devolvido ao cancelar. Pix e boleto podem levar até 3 dias úteis." },
    ],
  },
  {
    key: "fulfillment", title: "Encaminhamento aos fornecedores",
    fields: [
      { key: "auto_forward_paid_orders", label: "Encaminhar automaticamente pedidos pagos", type: "bool", help: "Desligado (padrão seguro): todo pedido pago aguarda aprovação no painel. Fornecedores marcados com “exige aprovação” sempre aguardam." },
      { key: "delay_alert_days", label: "Alertar se o fornecedor não enviar rastreio em (dias)", type: "int", min: 1, max: 60 },
      { key: "stale_tracking_days", label: "Alertar se o rastreio ficar sem atualização por (dias)", type: "int", min: 1, max: 90 },
      { key: "tracking_refresh_hours", label: "Consultar rastreio automático a cada (horas)", type: "int", min: 1, max: 168, help: "Vale para envios da CJ. Correios e Melhor Envio: código lançado manualmente." },
    ],
  },
  {
    key: "shipping", title: "Frete",
    fields: [
      { key: "mode", label: "Cálculo do frete", type: "select", options: [["product", "Por produto/fornecedor (custo de envio cadastrado)"], ["flat", "Valor fixo por pedido"], ["melhorenvio", "Melhor Envio (cotação em tempo real)"]] },
      { key: "flat_rate_cents", label: "Valor fixo (R$)", type: "money" },
      { key: "free_shipping_over_cents", label: "Frete grátis acima de (R$, vazio = desligado)", type: "moneyOpt" },
      { key: "origin_cep", label: "CEP de origem (fornecedor/centro de distribuição)", type: "cep" },
    ],
    validate: (v) => (v.mode === "melhorenvio" && String(v.origin_cep ?? "").length !== 8 ? "Para usar o Melhor Envio, informe o CEP de origem." : null),
  },
  {
    key: "pricing", title: "Precificação", description: "Usado para estimar margem e sugerir preços. Os valores reais de taxa vêm do Mercado Pago em cada pagamento.",
    fields: [
      { key: "estimated_fee_bps", label: "Taxa média do gateway (%)", type: "percent", help: "Consulte a sua taxa no Mercado Pago (varia por forma de pagamento e prazo de recebimento)." },
      { key: "estimated_fee_fixed_cents", label: "Taxa fixa por venda (R$)", type: "money" },
      { key: "default_target_margin_bps", label: "Margem-alvo padrão (%)", type: "percent" },
      { key: "min_margin_alert_bps", label: "Alertar margem abaixo de (%)", type: "percent" },
    ],
  },
  {
    key: "notifications", title: "E-mails ao cliente", description: "E-mails transacionais (sobre o próprio pedido) não exigem consentimento de marketing.",
    fields: [
      { key: "order_created", label: "Pedido recebido", type: "bool" },
      { key: "payment_approved", label: "Pagamento aprovado", type: "bool" },
      { key: "order_shipped", label: "Pedido enviado (com rastreio)", type: "bool" },
      { key: "order_delivered", label: "Pedido entregue", type: "bool" },
      { key: "order_canceled", label: "Pedido cancelado", type: "bool" },
      { key: "refund_completed", label: "Reembolso concluído", type: "bool" },
      { key: "staff_email", label: "E-mail da equipe para alertas", type: "email" },
    ],
  },
];

/** Converte o FormData no objeto da configuração, preservando chaves não editadas. */
export function parseSettingForm(form: SettingForm, f: FormData, current: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const fd of form.fields) {
    const raw = String(f.get(fd.key) ?? "").trim();
    switch (fd.type) {
      case "bool": out[fd.key] = f.get(fd.key) === "on"; break;
      case "money": out[fd.key] = raw ? parseBRL(raw) : 0; break;
      case "percent": {
        const n = Number(raw.replace(",", "."));
        if (raw === "" || !Number.isFinite(n) || n < 0 || n >= 100) throw new Error(`${fd.label}: informe um percentual entre 0 e 99,99.`);
        out[fd.key] = Math.round(n * 100); break;
      }
      case "moneyOpt": out[fd.key] = raw ? parseBRL(raw) : null; break;
      case "int": {
        const n = z.coerce.number().int().min(fd.min ?? 0).max(fd.max ?? 1_000_000).safeParse(raw);
        if (!n.success) throw new Error(`${fd.label}: informe um número inteiro entre ${fd.min ?? 0} e ${fd.max ?? 1_000_000}.`);
        out[fd.key] = n.data; break;
      }
      case "color":
        if (!/^#[0-9a-fA-F]{6}$/.test(raw)) throw new Error(`${fd.label}: cor inválida.`);
        out[fd.key] = raw.toUpperCase(); break;
      case "cep": {
        const d = onlyDigits(raw);
        if (d && d.length !== 8) throw new Error(`${fd.label}: CEP inválido.`);
        out[fd.key] = d; break;
      }
      case "url":
        if (raw && !/^https:\/\/[^\s]+$/.test(raw)) throw new Error(`${fd.label}: use um endereço que comece com https://`);
        out[fd.key] = fd.key.endsWith("_url") ? raw || null : raw; break;
      case "email":
        if (raw && !z.string().email().safeParse(raw).success) throw new Error(`${fd.label}: e-mail inválido.`);
        out[fd.key] = raw.toLowerCase(); break;
      case "select":
        if (!fd.options?.some(([k]) => k === raw)) throw new Error(`${fd.label}: opção inválida.`);
        out[fd.key] = raw; break;
      default:
        if (fd.max && raw.length > fd.max) throw new Error(`${fd.label}: no máximo ${fd.max} caracteres.`);
        out[fd.key] = fd.key === "cnpj" || fd.key === "whatsapp" ? onlyDigits(raw) : raw;
    }
  }
  if (form.key === "store.identity" && !String(out.name ?? "").trim()) throw new Error("Informe o nome da loja.");
  const err = form.validate?.(out);
  if (err) throw new Error(err);
  return out;
}
