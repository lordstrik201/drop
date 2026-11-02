import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, SUPPLIER_ORDER_STATUS_LABELS, SHIPMENT_STATUS_LABELS,
  allowedTransitions, isPaidState,
} from "@/lib/orders/status";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui";
import { Flash, Section } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatCEP, formatCPF, formatPhone } from "@/lib/validation/br";
import { formatDate, formatDateTime } from "@/lib/ui/dates";
import type { Address, OrderStatus, PaymentStatus, ShipmentStatus, SupplierOrderStatus } from "@/lib/types";
import {
  approveAction, cancelAction, markSubmittedAction, noteAction, refundAction, requeueAction, shipmentAction,
  shipmentStatusAction, statusAction, syncPaymentAction,
} from "../actions";

export const metadata = { title: "Pedido" };

type Order = {
  id: string; number: string; status: OrderStatus; created_at: Date; paid_at: Date | null; customer_name: string; customer_email: string;
  customer_phone: string | null; customer_cpf: string | null; shipping_address: Address; shipping_method: string | null;
  subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number; coupon_code: string | null;
  requires_manual_approval: boolean; approved_for_fulfillment_at: Date | null; customer_notes: string | null; internal_notes: string | null;
  cancel_reason: string | null; profile_id: string | null; utm: Record<string, string> | null;
};

const SHIP_NEXT: ShipmentStatus[] = ["in_transit", "out_for_delivery", "delivered", "exception", "returned"];

export default async function OrderDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("orders.read");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sql = db();
  const [order] = await sql<Order[]>`select * from public.orders where id = ${id}`;
  if (!order) notFound();

  const [items, payments, refunds, sos, shipments, history, ledger, perms] = await Promise.all([
    sql<{ id: string; product_id: string | null; product_name: string; variant_title: string | null; sku: string; supplier_product_ref: string | null; supplier_variant_ref: string | null; image_url: string | null; quantity: number; unit_price_cents: number; unit_cost_cents: number; unit_shipping_cost_cents: number; discount_cents: number; total_cents: number; supplier_name: string | null }[]>`
      select i.*, s.name as supplier_name from public.order_items i left join public.suppliers s on s.id = i.supplier_id where i.order_id = ${id} order by i.created_at`,
    sql<{ id: string; provider: string; provider_payment_id: string | null; method: string | null; status: PaymentStatus; status_detail: string | null; amount_cents: number; fee_cents: number; net_cents: number | null; refunded_cents: number; installments: number | null; approved_at: Date | null; money_release_date: Date | null; live_mode: boolean | null; created_at: Date }[]>`
      select * from public.payments where order_id = ${id} order by created_at`,
    sql<{ id: string; amount_cents: number; reason: string; status: string; error: string | null; created_at: Date }[]>`
      select id, amount_cents, reason, status, error, created_at from public.refunds where order_id = ${id} order by created_at`,
    sql<{ id: string; status: SupplierOrderStatus; supplier_id: string; supplier_name: string; integration_type: string; external_order_id: string | null; total_cost_cents: number; attempts: number; last_error: string | null; submitted_at: Date | null }[]>`
      select so.*, s.name as supplier_name, s.integration_type from public.supplier_orders so join public.suppliers s on s.id = so.supplier_id where so.order_id = ${id} order by so.created_at`,
    sql<{ id: string; carrier: string | null; service: string | null; tracking_code: string | null; tracking_url: string | null; status: ShipmentStatus; confirmed_eta: Date | null; shipped_at: Date | null; events: { at: string; description: string; location: string | null }[] }[]>`
      select sh.*, coalesce((select json_agg(json_build_object('at', e.occurred_at, 'description', e.description, 'location', e.location) order by e.occurred_at desc)
                             from public.tracking_events e where e.shipment_id = sh.id), '[]') as events
      from public.shipments sh where sh.order_id = ${id} order by sh.created_at`,
    sql<{ id: string; from_status: OrderStatus | null; to_status: OrderStatus; source: string; note: string | null; created_at: Date; actor: string | null }[]>`
      select h.*, p.email as actor from public.order_status_history h left join public.profiles p on p.id = h.actor_id where h.order_id = ${id} order by h.created_at desc, h.id desc`,
    sql<{ kind: string; amount_cents: number; status: string; description: string | null; occurred_at: Date }[]>`
      select kind, amount_cents, status, description, occurred_at from public.financial_entries where order_id = ${id} order by occurred_at, kind`,
    Promise.all((["orders.write", "orders.approve", "orders.cancel", "payments.refund", "finance.read"] as const).map((p) => can(user, p))),
  ]);
  const [canWrite, canApprove, canCancel, canRefund, canFinance] = perms;

  const cost = items.reduce((a, i) => a + (i.unit_cost_cents + i.unit_shipping_cost_cents) * i.quantity, 0);
  const approvedPay = payments.find((p) => p.status === "approved" || p.status === "partially_refunded");
  const fee = payments.reduce((a, p) => a + (p.status === "approved" || p.status === "partially_refunded" || p.status === "refunded" ? p.fee_cents : 0), 0);
  const refunded = payments.reduce((a, p) => a + p.refunded_cents, 0);
  const margin = order.total_cents - refunded - cost - fee;
  const transitions = allowedTransitions(order.status).filter((s) => s !== "paid" && s !== "refunded" && s !== "canceled");
  const awaitingApproval = sos.some((s) => s.status === "awaiting_approval");
  const addr = order.shipping_address;
  const refundable = approvedPay ? approvedPay.amount_cents - approvedPay.refunded_cents : 0;
  const nonce = randomUUID();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/pedidos" className="text-sm text-muted hover:text-ink">← Pedidos</Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            Pedido #{order.number}
            <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          </h1>
          <p className="text-sm text-muted">Criado em {formatDateTime(order.created_at)}{order.paid_at && ` · pago em ${formatDateTime(order.paid_at)}`}</p>
        </div>
      </div>
      <Flash msg={sp.ok} error={sp.erro} />

      {order.status === "under_review" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Este pedido está <strong>em análise</strong>: o fluxo automático está travado. Verifique o histórico abaixo (divergência de valor, chargeback ou pagamento em pedido cancelado) e decida entre seguir com o pedido ou reembolsar.
        </div>
      )}
      {awaitingApproval && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>Pagamento confirmado. O pedido aguarda <strong>sua aprovação</strong> para ser encaminhado ao fornecedor.</span>
          {canApprove && (
            <form action={approveAction}><input type="hidden" name="orderId" value={order.id} /><Button size="sm">Aprovar encaminhamento</Button></form>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Section title="Itens">
            <div className="-m-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs uppercase text-muted">
                  <tr><th className="px-4 py-2">Produto</th><th className="px-2 py-2">Fornecedor</th><th className="px-2 py-2 text-right">Qtd</th><th className="px-2 py-2 text-right">Preço</th>{canFinance && <th className="px-2 py-2 text-right">Custo</th>}<th className="px-4 py-2 text-right">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {i.image_url ? <img src={i.image_url} alt="" className="size-10 rounded object-cover" /> : <span className="size-10 rounded bg-bg" />}
                          <span>
                            {i.product_id ? <Link href={`/admin/produtos/${i.product_id}`} className="font-medium hover:underline">{i.product_name}</Link> : <span className="font-medium">{i.product_name}</span>}
                            <span className="block text-xs text-muted">{i.variant_title && i.variant_title !== "Padrão" ? `${i.variant_title} · ` : ""}SKU {i.sku}{i.supplier_variant_ref || i.supplier_product_ref ? ` · ref. forn. ${i.supplier_variant_ref ?? i.supplier_product_ref}` : ""}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-muted">{i.supplier_name ?? <span className="text-danger">sem fornecedor</span>}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{i.quantity}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatBRL(i.unit_price_cents)}</td>
                      {canFinance && <td className="px-2 py-2 text-right tabular-nums text-muted">{formatBRL(i.unit_cost_cents + i.unit_shipping_cost_cents)}</td>}
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{formatBRL(i.total_cents)}{i.discount_cents > 0 && <span className="block text-xs text-success">−{formatBRL(i.discount_cents)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-6 ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Subtotal</dt><dd className="text-right tabular-nums">{formatBRL(order.subtotal_cents)}</dd>
              {order.discount_cents > 0 && <><dt className="text-muted">Desconto{order.coupon_code && ` (${order.coupon_code})`}</dt><dd className="text-right tabular-nums text-success">−{formatBRL(order.discount_cents)}</dd></>}
              <dt className="text-muted">Frete ({order.shipping_method ?? "—"})</dt><dd className="text-right tabular-nums">{formatBRL(order.shipping_cents)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums">{formatBRL(order.total_cents)}</dd>
              {canFinance && (
                <>
                  <dt className="mt-2 text-muted">Custo fornecedor</dt><dd className="mt-2 text-right tabular-nums">−{formatBRL(cost)}</dd>
                  <dt className="text-muted">Taxa do gateway</dt><dd className="text-right tabular-nums">−{formatBRL(fee)}</dd>
                  {refunded > 0 && <><dt className="text-muted">Reembolsado</dt><dd className="text-right tabular-nums">−{formatBRL(refunded)}</dd></>}
                  <dt className="font-semibold">Margem {approvedPay ? "" : "(prevista)"}</dt>
                  <dd className={`text-right font-semibold tabular-nums ${margin < 0 ? "text-danger" : "text-success"}`}>{formatBRL(margin)}</dd>
                </>
              )}
            </dl>
          </Section>

          <Section title="Fornecedores" actions={<Link href="/admin/encaminhamento" className="text-sm text-brand underline">Fila de encaminhamento</Link>}>
            {sos.length === 0 ? (
              <p className="text-sm text-muted">{isPaidState(order.status) ? "Nenhum pedido de fornecedor criado (verifique se os itens têm fornecedor vinculado)." : "Os pedidos aos fornecedores são criados somente depois da confirmação do pagamento."}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {sos.map((so) => (
                  <li key={so.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{so.supplier_name} <span className="text-xs font-normal text-muted">({so.integration_type === "manual" || so.integration_type === "csv" ? "envio manual" : `API ${so.integration_type}`})</span></span>
                      <Badge tone={so.status === "failed" ? "danger" : so.status === "awaiting_approval" ? "warning" : ["submitted", "confirmed", "processing", "shipped", "delivered"].includes(so.status) ? "success" : "neutral"}>{SUPPLIER_ORDER_STATUS_LABELS[so.status]}</Badge>
                    </div>
                    <p className="text-xs text-muted">
                      Custo {formatBRL(so.total_cost_cents)} · {so.attempts} tentativa(s)
                      {so.external_order_id && <> · nº no fornecedor <strong className="text-ink">{so.external_order_id}</strong></>}
                      {so.submitted_at && <> · enviado em {formatDateTime(so.submitted_at)}</>}
                    </p>
                    {so.last_error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-900">Último erro: {so.last_error}</p>}
                    {canWrite && (
                      <div className="flex flex-wrap gap-2">
                        {(so.status === "pending" || so.status === "failed") && (
                          <form action={requeueAction}><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="supplierOrderId" value={so.id} /><Button size="sm" variant="secondary">Tentar enviar novamente</Button></form>
                        )}
                        {["pending", "failed", "submitting"].includes(so.status) && (
                          <form action={markSubmittedAction} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="supplierOrderId" value={so.id} />
                            <Input name="externalOrderId" placeholder="Nº do pedido no fornecedor" required className="h-8 w-56 text-xs" />
                            <Button size="sm" variant="secondary">Registrar envio manual</Button>
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Envio e rastreio">
            {shipments.length === 0 && <p className="mb-3 text-sm text-muted">Nenhum código de rastreio registrado ainda.</p>}
            <ul className="flex flex-col gap-4">
              {shipments.map((sh) => (
                <li key={sh.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span><strong>{sh.carrier}</strong>{sh.service && ` · ${sh.service}`} · {sh.tracking_url ? <a href={sh.tracking_url} target="_blank" rel="noreferrer" className="text-brand underline">{sh.tracking_code}</a> : sh.tracking_code}</span>
                    <Badge tone={sh.status === "delivered" ? "success" : sh.status === "exception" || sh.status === "returned" ? "danger" : "info"}>{SHIPMENT_STATUS_LABELS[sh.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">Postado em {formatDateTime(sh.shipped_at)}{sh.confirmed_eta && ` · previsão confirmada ${formatDate(sh.confirmed_eta)}`}</p>
                  {sh.events.length > 0 && (
                    <ol className="mt-2 flex flex-col gap-1 border-l border-line pl-3 text-xs">
                      {sh.events.slice(0, 8).map((e, i) => <li key={i}><span className="text-muted">{formatDateTime(e.at)}</span> — {e.description}{e.location && ` (${e.location})`}</li>)}
                    </ol>
                  )}
                  {canWrite && sh.status !== "delivered" && (
                    <form action={shipmentStatusAction} className="mt-3 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="shipmentId" value={sh.id} />
                      <Select name="status" className="h-8 w-44 text-xs" defaultValue="in_transit">{SHIP_NEXT.map((s) => <option key={s} value={s}>{SHIPMENT_STATUS_LABELS[s]}</option>)}</Select>
                      <Input name="description" placeholder="Descrição (opcional)" className="h-8 w-56 text-xs" maxLength={300} />
                      <Button size="sm" variant="secondary">Atualizar envio</Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {canWrite && isPaidState(order.status) && order.status !== "delivered" && (
              <details className="mt-4" open={shipments.length === 0 && ["sent_to_supplier", "preparing"].includes(order.status)}>
                <summary className="cursor-pointer text-sm font-medium text-brand">Adicionar código de rastreio</summary>
                <form action={shipmentAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="orderId" value={order.id} />
                  {sos.length > 1 && (
                    <Select name="supplierOrderId" defaultValue="">{[<option key="" value="">Fornecedor (opcional)</option>, ...sos.map((so) => <option key={so.id} value={so.id}>{so.supplier_name}</option>)]}</Select>
                  )}
                  {sos.length === 1 && <input type="hidden" name="supplierOrderId" value={sos[0].id} />}
                  <Input name="carrier" placeholder="Transportadora (ex.: Correios, Jadlog)" required maxLength={60} />
                  <Input name="service" placeholder="Serviço (ex.: PAC, SEDEX)" maxLength={60} />
                  <Input name="trackingCode" placeholder="Código de rastreio" required maxLength={60} />
                  <Input name="trackingUrl" type="url" placeholder="Link de rastreio (https://…)" maxLength={500} />
                  <label className="flex flex-col gap-1 text-xs text-muted">Previsão confirmada pela transportadora (opcional)<Input name="confirmedEta" type="date" /></label>
                  <div className="flex items-end"><Button size="sm">Registrar e avisar cliente</Button></div>
                </form>
              </details>
            )}
          </Section>

          <Section title="Histórico">
            <ol className="flex flex-col gap-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="w-36 shrink-0 text-xs text-muted tabular-nums">{formatDateTime(h.created_at)}</span>
                  <span>
                    <strong>{ORDER_STATUS_LABELS[h.to_status]}</strong>
                    <span className="text-xs text-muted"> · {h.source}{h.actor && ` · ${h.actor}`}</span>
                    {h.note && <span className="block text-xs text-muted">{h.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Section title="Cliente">
            <p className="font-medium">{order.customer_name}</p>
            <p className="text-sm"><a href={`mailto:${order.customer_email}`} className="text-brand underline">{order.customer_email}</a></p>
            {order.customer_phone && <p className="text-sm">{formatPhone(order.customer_phone)}</p>}
            {order.customer_cpf && <p className="text-sm text-muted">CPF {formatCPF(order.customer_cpf)}</p>}
            {order.profile_id ? <Link href={`/admin/clientes/${order.profile_id}`} className="mt-2 inline-block text-sm text-brand underline">Ver ficha do cliente</Link> : <p className="mt-2 text-xs text-muted">Compra sem conta.</p>}
            <h3 className="mt-4 text-xs font-semibold uppercase text-muted">Entrega</h3>
            <address className="text-sm not-italic">
              {addr.recipient_name}<br />{addr.street}, {addr.number}{addr.complement && ` — ${addr.complement}`}<br />
              {addr.district} · {addr.city}/{addr.state}<br />CEP {formatCEP(addr.cep)}
            </address>
            {order.customer_notes && <><h3 className="mt-4 text-xs font-semibold uppercase text-muted">Observação do cliente</h3><p className="text-sm">{order.customer_notes}</p></>}
            {order.utm && Object.keys(order.utm).length > 0 && <p className="mt-3 text-xs text-muted">Origem: {Object.entries(order.utm).map(([k, v]) => `${k}=${v}`).join(" · ")}</p>}
          </Section>

          <Section title="Pagamento" actions={canWrite && payments.some((p) => p.provider_payment_id) ? (
            <form action={syncPaymentAction}><input type="hidden" name="orderId" value={order.id} /><button className="text-xs text-brand underline">Consultar no Mercado Pago</button></form>
          ) : undefined}>
            {payments.length === 0 && <p className="text-sm text-muted">Nenhuma tentativa de pagamento registrada.</p>}
            <ul className="flex flex-col gap-3 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.method ? { pix: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", ticket: "Boleto", bank_transfer: "Transferência", account_money: "Saldo Mercado Pago" }[p.method] ?? p.method : "Checkout Mercado Pago"}</span>
                    <Badge tone={p.status === "approved" ? "success" : p.status === "rejected" || p.status === "charged_back" ? "danger" : "neutral"}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {formatBRL(p.amount_cents)}{p.installments && p.installments > 1 ? ` em ${p.installments}x` : ""}
                    {p.fee_cents > 0 && ` · taxa ${formatBRL(p.fee_cents)}`}
                    {p.refunded_cents > 0 && ` · estornado ${formatBRL(p.refunded_cents)}`}
                  </p>
                  <p className="text-xs text-muted">
                    {p.provider_payment_id ? `ID ${p.provider_payment_id}` : "Aguardando o cliente pagar"}
                    {p.live_mode === false && " · MODO TESTE"}
                    {p.status_detail && ` · ${p.status_detail}`}
                  </p>
                  {p.money_release_date && <p className="text-xs text-muted">Liberação do valor: {formatDate(p.money_release_date)}</p>}
                </li>
              ))}
            </ul>
            {refunds.length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold uppercase text-muted">Reembolsos</h3>
                <ul className="text-sm">{refunds.map((r) => <li key={r.id}>{formatBRL(r.amount_cents)} · {r.status === "completed" ? "concluído" : r.status === "failed" ? "falhou" : "em processamento"} · {formatDateTime(r.created_at)}<span className="block text-xs text-muted">{r.reason}{r.error && ` — erro: ${r.error}`}</span></li>)}</ul>
              </>
            )}
            {canRefund && approvedPay && refundable > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-danger">Reembolsar cliente</summary>
                <form action={refundAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="nonce" value={nonce} />
                  <Input name="amount" inputMode="decimal" placeholder={`Valor (vazio = total de ${formatBRL(refundable)})`} />
                  <Input name="reason" placeholder="Motivo" required minLength={3} maxLength={300} />
                  <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="confirm" required className="mt-0.5" /> Confirmo que este reembolso será executado de verdade no Mercado Pago e o valor devolvido ao cliente.</label>
                  {sos.some((s) => ["submitted", "confirmed", "processing", "shipped"].includes(s.status)) && <p className="text-xs text-warning">Atenção: o pedido já foi enviado ao fornecedor. Cancele também junto a ele e registre a ocorrência.</p>}
                  <Button size="sm" variant="danger">Reembolsar</Button>
                </form>
              </details>
            )}
          </Section>

          {canFinance && ledger.length > 0 && (
            <Section title="Lançamentos financeiros">
              <ul className="text-xs">
                {ledger.map((l, i) => (
                  <li key={i} className={`flex justify-between gap-2 py-0.5 ${l.status === "canceled" ? "text-muted line-through" : ""}`}>
                    <span>{l.description ?? l.kind}{l.status === "expected" && " (previsto)"}</span>
                    <span className="tabular-nums">{formatBRL(l.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(canWrite || canCancel) && (
            <Section title="Ações">
              <div className="flex flex-col gap-4">
                {canWrite && transitions.length > 0 && (
                  <form action={statusAction} className="flex flex-col gap-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <label className="text-xs font-medium text-muted">Alterar status manualmente</label>
                    <Select name="to" required defaultValue="">{[<option key="" value="" disabled>Escolha…</option>, ...transitions.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)]}</Select>
                    <Input name="note" placeholder="Motivo (fica no histórico)" maxLength={300} />
                    <Button size="sm" variant="secondary">Alterar status</Button>
                  </form>
                )}
                {canCancel && !isPaidState(order.status) && order.status !== "canceled" && order.status !== "refunded" && (
                  <form action={cancelAction} className="flex flex-col gap-2">
                    <input type="hidden" name="orderId" value={order.id} />
                    <label className="text-xs font-medium text-muted">Cancelar pedido (não pago)</label>
                    <Input name="reason" placeholder="Motivo do cancelamento" required minLength={3} maxLength={300} />
                    <Button size="sm" variant="danger">Cancelar pedido</Button>
                  </form>
                )}
                {canCancel && isPaidState(order.status) && <p className="text-xs text-muted">Pedido pago: para cancelar, faça o reembolso no quadro Pagamento.</p>}
              </div>
            </Section>
          )}

          <Section title="Notas internas">
            {order.internal_notes ? <pre className="mb-3 whitespace-pre-wrap font-sans text-xs">{order.internal_notes}</pre> : <p className="mb-3 text-xs text-muted">Nenhuma nota. Notas não são vistas pelo cliente.</p>}
            {canWrite && (
              <form action={noteAction} className="flex flex-col gap-2">
                <input type="hidden" name="orderId" value={order.id} />
                <Textarea name="note" rows={2} required maxLength={2000} placeholder="Nova nota" />
                <Button size="sm" variant="secondary">Adicionar nota</Button>
              </form>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

