import Link from "next/link";
import { Check, Truck } from "lucide-react";
import type { OrderView } from "@/lib/orders/queries";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, SHIPMENT_STATUS_LABELS } from "@/lib/orders/status";
import { Badge } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatCEP } from "@/lib/validation/br";
import { formatDateTime } from "@/lib/ui/dates";

const STEPS: { key: string; label: string; states: string[] }[] = [
  { key: "placed", label: "Pedido realizado", states: ["pending_payment", "paid", "awaiting_supplier", "sent_to_supplier", "preparing", "shipped", "in_transit", "delivered"] },
  { key: "paid", label: "Pagamento aprovado", states: ["paid", "awaiting_supplier", "sent_to_supplier", "preparing", "shipped", "in_transit", "delivered"] },
  { key: "prep", label: "Em preparação", states: ["sent_to_supplier", "preparing", "shipped", "in_transit", "delivered"] },
  { key: "ship", label: "Enviado", states: ["shipped", "in_transit", "delivered"] },
  { key: "done", label: "Entregue", states: ["delivered"] },
];

const METHOD: Record<string, string> = { pix: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", boleto: "Boleto", account_money: "Saldo Mercado Pago" };

export function OrderDetail({ o, actions }: { o: OrderView; actions?: React.ReactNode }) {
  const off = ["canceled", "refunded", "under_review"].includes(o.status);
  const a = o.shipping_address;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pedido #{o.number}</h1>
          <p className="text-sm text-muted">Realizado em {formatDateTime(o.created_at)}</p>
        </div>
        <div className="flex items-center gap-3"><Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>{actions}</div>
      </div>

      {!off && (
        <ol className="grid grid-cols-5 gap-1 rounded-2xl border border-line bg-surface p-4 text-center text-[11px] sm:text-xs">
          {STEPS.map((s) => {
            const done = s.states.includes(o.status);
            return (
              <li key={s.key} className="flex flex-col items-center gap-1">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${done ? "bg-brand text-brand-contrast" : "bg-bg text-muted"}`}>{done ? <Check size={14} /> : null}</span>
                <span className={done ? "font-semibold" : "text-muted"}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}
      {o.status === "canceled" && o.cancel_reason && <p className="rounded-lg bg-bg p-3 text-sm">Motivo do cancelamento: {o.cancel_reason}</p>}

      {o.shipments.map((s) => (
        <section key={s.id} className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="flex items-center gap-2 font-bold"><Truck size={18} aria-hidden /> Entrega {s.carrier && `· ${s.carrier}`}</h2>
          <p className="mt-1 text-sm">Status: <strong>{SHIPMENT_STATUS_LABELS[s.status]}</strong>
            {s.tracking_code && <> · Código: <strong>{s.tracking_code}</strong></>}
            {s.confirmed_eta && <> · Previsão confirmada: {new Date(s.confirmed_eta + "T12:00:00").toLocaleDateString("pt-BR")}</>}
          </p>
          {s.tracking_url && /^https:\/\//.test(s.tracking_url) && <a href={s.tracking_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-brand underline">Rastrear no site da transportadora</a>}
          {s.events.length > 0 && (
            <ol className="mt-4 border-l-2 border-line pl-4 text-sm">
              {s.events.map((e, i) => (
                <li key={i} className="mb-3"><p className="font-medium">{e.description}</p><p className="text-xs text-muted">{formatDateTime(e.occurred_at)}{e.location && ` · ${e.location}`}</p></li>
              ))}
            </ol>
          )}
        </section>
      ))}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-3 font-bold">Itens</h2>
          <ul className="divide-y divide-line">
            {o.items.map((i) => (
              <li key={i.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-line bg-white">{i.image_url && <img src={i.image_url} alt="" className="h-full w-full object-contain" />}</div>
                <div className="flex-1">
                  {i.product_slug ? <Link href={`/produto/${i.product_slug}`} className="font-medium hover:underline">{i.product_name}</Link> : <span className="font-medium">{i.product_name}</span>}
                  {i.variant_title && i.variant_title !== "Padrão" && <p className="text-xs text-muted">{i.variant_title}</p>}
                  <p className="text-xs text-muted">{i.quantity} × {formatBRL(i.unit_price_cents)}</p>
                </div>
                <span className="font-semibold">{formatBRL(i.total_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-line bg-surface p-5 text-sm">
            <h2 className="font-bold">Pagamento</h2>
            <dl className="mt-3 space-y-1">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatBRL(o.subtotal_cents)}</dd></div>
              {o.discount_cents > 0 && <div className="flex justify-between text-success"><dt>Desconto {o.coupon_code}</dt><dd>-{formatBRL(o.discount_cents)}</dd></div>}
              <div className="flex justify-between"><dt>Frete</dt><dd>{o.shipping_cents ? formatBRL(o.shipping_cents) : "Grátis"}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-bold"><dt>Total</dt><dd>{formatBRL(o.total_cents)}</dd></div>
            </dl>
            {o.payments[0] && <p className="mt-2 text-xs text-muted">{METHOD[o.payments[0].method ?? ""] ?? o.payments[0].method}{o.payments[0].installments && o.payments[0].installments > 1 ? ` em ${o.payments[0].installments}x` : ""}</p>}
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5 text-sm">
            <h2 className="font-bold">Endereço de entrega</h2>
            <p className="mt-2">{a.recipient_name}<br />{a.street}, {a.number}{a.complement ? ` — ${a.complement}` : ""}<br />{a.district} · {a.city}/{a.state}<br />CEP {formatCEP(a.cep)}</p>
            {o.shipping_method && <p className="mt-2 text-xs text-muted">{o.shipping_method}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
