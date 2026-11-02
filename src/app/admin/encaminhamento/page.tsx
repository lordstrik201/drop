import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { fulfillmentQueue } from "@/lib/fulfillment/queue";
import { SUPPLIER_ORDER_STATUS_LABELS } from "@/lib/orders/status";
import { Badge, Button, Input, Select } from "@/components/ui";
import { Flash, Stat } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/ui/dates";
import { formatCEP } from "@/lib/validation/br";
import { approveAction, markSubmittedAction, requeueAction } from "../pedidos/actions";

export const metadata = { title: "Encaminhamento" };

export default async function FulfillmentQueuePage({ searchParams }: { searchParams: Promise<{ fornecedor?: string; ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("orders.read");
  const sp = await searchParams;
  const supplierId = sp.fornecedor && /^[0-9a-f-]{36}$/i.test(sp.fornecedor) ? sp.fornecedor : null;
  const [rows, suppliers, canWrite, canApprove, delays] = await Promise.all([
    fulfillmentQueue({ supplierId }),
    db()<{ id: string; name: string }[]>`select id, name from public.suppliers order by name`,
    can(user, "orders.write"),
    can(user, "orders.approve"),
    db()<{ n: number }[]>`
      select count(*)::int as n from public.supplier_orders so join public.orders o on o.id = so.order_id
      where so.status in ('submitted', 'confirmed', 'processing') and so.submitted_at < now() - make_interval(days => coalesce(
        (select (value->>'delay_alert_days')::int from public.settings where key = 'fulfillment'), 3))
        and not exists (select 1 from public.shipments sh where sh.order_id = o.id)`,
  ]);
  const back = `/admin/encaminhamento${supplierId ? `?fornecedor=${supplierId}` : ""}`;
  const groups = {
    awaiting_approval: rows.filter((r) => r.status === "awaiting_approval"),
    failed: rows.filter((r) => r.status === "failed"),
    pending: rows.filter((r) => r.status === "pending" || r.status === "submitting"),
  };
  const approvalOrders = Array.from(new Map(groups.awaiting_approval.map((r) => [r.order_id, r])).values());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Encaminhamento aos fornecedores</h1>
          <p className="text-sm text-muted">Somente pedidos com pagamento aprovado aparecem aqui.</p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <Select name="fornecedor" defaultValue={supplierId ?? ""} className="h-9 w-56">{[<option key="" value="">Todos os fornecedores</option>, ...suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)]}</Select>
          <Button size="sm" variant="secondary">Filtrar</Button>
        </form>
      </div>
      <Flash msg={sp.ok} error={sp.erro} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Aguardando aprovação" value={approvalOrders.length} tone={approvalOrders.length ? "warning" : undefined} />
        <Stat label="Para encaminhar" value={groups.pending.length} hint="manual ou na fila da API" />
        <Stat label="Com falha" value={groups.failed.length} tone={groups.failed.length ? "danger" : undefined} />
        <Stat label="Sem rastreio após o prazo" value={delays[0].n} tone={delays[0].n ? "warning" : undefined} hint="enviados sem código de rastreio" />
      </div>

      <section className="rounded-xl border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="font-semibold">Aguardando aprovação</h2>
        </header>
        {approvalOrders.length === 0 ? <p className="px-4 py-6 text-sm text-muted">Nenhum pedido aguardando aprovação.</p> : (
          <ul className="divide-y divide-line">
            {approvalOrders.map((r) => (
              <li key={r.order_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <Link href={`/admin/pedidos/${r.order_id}`} className="font-semibold text-brand hover:underline">#{r.number}</Link> · {r.customer_name}
                  <span className="block text-xs text-muted">Pago em {formatDateTime(r.paid_at)} · {groups.awaiting_approval.filter((g) => g.order_id === r.order_id).map((g) => g.supplier_name).join(", ")}</span>
                </span>
                {canApprove && <form action={approveAction}><input type="hidden" name="orderId" value={r.order_id} /><input type="hidden" name="back" value={back} /><Button size="sm">Aprovar</Button></form>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(["failed", "pending"] as const).map((g) => (
        <section key={g} className="rounded-xl border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="font-semibold">{g === "failed" ? "Com falha no envio" : "Para encaminhar"}</h2>
            {g === "pending" && canWrite && groups.pending.length > 0 && (
              <a href={`/admin/encaminhamento/exportar${supplierId ? `?fornecedor=${supplierId}` : ""}`} className="text-sm text-brand underline">Baixar CSV para o fornecedor</a>
            )}
          </header>
          {groups[g].length === 0 ? <p className="px-4 py-6 text-sm text-muted">{g === "failed" ? "Nenhuma falha." : "Nada para encaminhar."}</p> : (
            <ul className="divide-y divide-line">
              {groups[g].map((r) => {
                const manual = r.integration_type === "manual" || r.integration_type === "csv";
                const a = r.shipping_address;
                return (
                  <li key={r.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><Link href={`/admin/pedidos/${r.order_id}`} className="font-semibold text-brand hover:underline">#{r.number}</Link> · {r.supplier_name} <span className="text-xs text-muted">({manual ? "envio manual" : `API ${r.integration_type}`})</span></span>
                      <Badge tone={r.status === "failed" ? "danger" : "neutral"}>{SUPPLIER_ORDER_STATUS_LABELS[r.status]}</Badge>
                    </div>
                    <div className="grid gap-2 text-xs md:grid-cols-2">
                      <ul>{(r.items ?? []).map((i, k) => <li key={k}><strong>{i.qty}×</strong> {i.name}{i.variant && i.variant !== "Padrão" ? ` (${i.variant})` : ""} · SKU {i.sku}{i.ref && ` · ref. ${i.ref}`}</li>)}</ul>
                      <p className="text-muted">{a.recipient_name} · {a.street}, {a.number}{a.complement && ` ${a.complement}`} · {a.district} · {a.city}/{a.state} · CEP {formatCEP(a.cep)} · {r.shipping_method}</p>
                    </div>
                    <p className="text-xs text-muted">Custo {formatBRL(r.total_cost_cents)} · {r.attempts} tentativa(s)</p>
                    {r.last_error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-900">{r.last_error}</p>}
                    {canWrite && (
                      <div className="flex flex-wrap gap-2">
                        {(r.status === "failed" || (r.status === "pending" && !manual)) && (
                          <form action={requeueAction}><input type="hidden" name="orderId" value={r.order_id} /><input type="hidden" name="supplierOrderId" value={r.id} /><input type="hidden" name="back" value={back} /><Button size="sm" variant="secondary">Tentar de novo</Button></form>
                        )}
                        <form action={markSubmittedAction} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="orderId" value={r.order_id} /><input type="hidden" name="supplierOrderId" value={r.id} /><input type="hidden" name="back" value={back} />
                          <Input name="externalOrderId" placeholder="Nº do pedido no fornecedor" required maxLength={80} className="h-8 w-56 text-xs" />
                          <Button size="sm" variant="secondary">Registrar como enviado</Button>
                        </form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
