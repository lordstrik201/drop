import { formatBRL } from "@/lib/money";

export type OrderTemplate = "order_created" | "payment_approved" | "order_shipped" | "order_delivered" | "order_canceled" | "refund_completed";

export type TemplateData = {
  storeName: string;
  siteUrl: string;
  customerName: string;
  orderNumber: number;
  orderId: string;
  totalCents: number;
  items: { name: string; quantity: number; totalCents: number }[];
  trackingCode?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
  cancelReason?: string | null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const COPY: Record<OrderTemplate, { subject: (d: TemplateData) => string; lead: (d: TemplateData) => string }> = {
  order_created: { subject: (d) => `Recebemos seu pedido #${d.orderNumber}`, lead: () => "Recebemos seu pedido. Assim que o pagamento for confirmado, avisaremos você." },
  payment_approved: { subject: (d) => `Pagamento aprovado — pedido #${d.orderNumber}`, lead: () => "Seu pagamento foi aprovado e o pedido já está sendo preparado." },
  order_shipped: { subject: (d) => `Seu pedido #${d.orderNumber} foi enviado`, lead: (d) => `Seu pedido foi enviado${d.carrier ? ` por ${esc(d.carrier)}` : ""}.${d.trackingCode ? ` Código de rastreio: <strong>${esc(d.trackingCode)}</strong>.` : ""}` },
  order_delivered: { subject: (d) => `Pedido #${d.orderNumber} entregue`, lead: () => "Seu pedido foi entregue. Esperamos que goste! Se puder, avalie os produtos." },
  order_canceled: { subject: (d) => `Pedido #${d.orderNumber} cancelado`, lead: (d) => `Seu pedido foi cancelado.${d.cancelReason ? ` Motivo: ${esc(d.cancelReason)}.` : ""} Se tiver dúvidas, fale conosco.` },
  refund_completed: { subject: (d) => `Reembolso do pedido #${d.orderNumber}`, lead: () => "O reembolso do seu pedido foi processado. O prazo para aparecer depende do meio de pagamento." },
};

export function renderOrderEmail(t: OrderTemplate, d: TemplateData): { subject: string; html: string; text: string } {
  const c = COPY[t];
  const url = `${d.siteUrl}/conta/pedidos/${d.orderId}`;
  const rows = d.items.map((i) => `<tr><td style="padding:6px 0">${esc(i.name)} × ${i.quantity}</td><td style="padding:6px 0;text-align:right">${formatBRL(i.totalCents)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 4px">${esc(d.storeName)}</h1>
<p style="font-size:16px">Olá, ${esc(d.customerName.split(" ")[0])}!</p>
<p style="font-size:15px;line-height:1.5">${c.lead(d)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #e4e4e7;margin-top:12px">${rows}
<tr><td style="padding:8px 0;border-top:1px solid #e4e4e7"><strong>Total</strong></td><td style="padding:8px 0;border-top:1px solid #e4e4e7;text-align:right"><strong>${formatBRL(d.totalCents)}</strong></td></tr></table>
${d.trackingUrl ? `<p><a href="${esc(d.trackingUrl)}">Acompanhar entrega</a></p>` : ""}
<p style="margin-top:20px"><a href="${esc(url)}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ver pedido #${d.orderNumber}</a></p>
<p style="font-size:12px;color:#71717a;margin-top:24px">Este é um e-mail transacional sobre a sua compra.</p>
</div></body></html>`;
  const text = `${d.storeName}\n\nOlá, ${d.customerName}!\n${c.lead(d).replace(/<[^>]+>/g, "")}\n\n${d.items.map((i) => `- ${i.name} x${i.quantity}: ${formatBRL(i.totalCents)}`).join("\n")}\nTotal: ${formatBRL(d.totalCents)}\n\nVer pedido: ${url}`;
  return { subject: c.subject(d), html, text };
}
