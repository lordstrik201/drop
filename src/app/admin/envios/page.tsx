import Link from "next/link";
import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/settings";
import { ALERT_LABEL, countAlerts, logisticsAlerts, type AlertKind } from "@/lib/shipping/alerts";
import { ORDER_STATUS_LABELS, SHIPMENT_STATUS_LABELS } from "@/lib/orders/status";
import { Badge, Button, Input, Pagination, Select } from "@/components/ui";
import { Flash, Section, Stat, Table, td } from "@/components/admin/ui";
import { formatDate, formatDateTime } from "@/lib/ui/dates";
import type { ShipmentStatus } from "@/lib/types";
import { refreshTrackingAction } from "./actions";

export const metadata = { title: "Envios" };
type SP = { aba?: string; alerta?: string; status?: string; q?: string; pagina?: string; ok?: string; erro?: string };
const PER_PAGE = 50;

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireStaffPage("orders.read");
  const sp = await searchParams;
  const tab = sp.aba === "todos" ? "todos" : "alertas";
  const kind = sp.alerta && sp.alerta in ALERT_LABEL ? (sp.alerta as AlertKind) : undefined;
  const status = sp.status && sp.status in SHIPMENT_STATUS_LABELS ? (sp.status as ShipmentStatus) : null;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const page = Math.max(1, Number(sp.pagina) || 1);
  const sql = db();

  const [allAlerts, canWrite, cfg, cjCount, list] = await Promise.all([
    logisticsAlerts(undefined, 5000),
    can(user, "orders.write"),
    getSetting("fulfillment"),
    sql<{ n: number; last: Date | null }[]>`
      select count(*)::int as n, max(sh.last_checked_at) as last from public.shipments sh
      join public.supplier_orders so on so.id = sh.supplier_order_id join public.suppliers s on s.id = so.supplier_id
      where s.integration_type = 'cj' and sh.tracking_code is not null and sh.status not in ('delivered','returned')`,
    tab === "todos"
      ? sql<{ id: string; order_id: string; number: string; carrier: string | null; tracking_code: string | null; tracking_url: string | null; status: ShipmentStatus; confirmed_eta: string | null; shipped_at: Date | null; last_event_at: Date | null; last_checked_at: Date | null; is_cj: boolean; total: number }[]>`
          select sh.id, sh.order_id, o.number::text, sh.carrier, sh.tracking_code, sh.tracking_url, sh.status, sh.confirmed_eta::text,
                 sh.shipped_at, sh.last_event_at, sh.last_checked_at, coalesce(s.integration_type = 'cj', false) as is_cj,
                 count(*) over ()::int as total
          from public.shipments sh join public.orders o on o.id = sh.order_id
          left join public.supplier_orders so on so.id = sh.supplier_order_id left join public.suppliers s on s.id = so.supplier_id
          where (${status}::public.shipment_status is null or sh.status = ${status})
            and (${q} = '' or sh.tracking_code ilike ${"%" + q + "%"} or o.number::text = ${q} or o.customer_name ilike ${"%" + q + "%"})
          order by sh.created_at desc limit ${PER_PAGE} offset ${(page - 1) * PER_PAGE}`
      : Promise.resolve([]),
  ]);
  const counts = countAlerts(allAlerts);
  const alerts = kind ? allAlerts.filter((a) => a.kind === kind) : allAlerts;
  const total = list[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Envios e rastreio</h1>
          <p className="text-sm text-muted">
            Rastreio automático para pedidos da CJ (a cada {cfg.tracking_refresh_hours ?? 12} h). Correios, Melhor Envio e fornecedores manuais: lance o código no pedido.
          </p>
        </div>
        {canWrite && (
          <form action={refreshTrackingAction}>
            <input type="hidden" name="back" value={`/admin/envios${tab === "todos" ? "?aba=todos" : ""}`} />
            <Button size="sm" variant="secondary" disabled={!cjCount[0].n}>Consultar rastreios da CJ agora ({cjCount[0].n})</Button>
          </form>
        )}
      </div>
      <Flash msg={sp.ok} error={sp.erro} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(Object.keys(ALERT_LABEL) as AlertKind[]).map((k) => (
          <Link key={k} href={`/admin/envios?alerta=${k}`} className="block">
            <Stat label={ALERT_LABEL[k]} value={counts[k]} tone={counts[k] ? (k === "excecao" || k === "prazo_vencido" ? "danger" : "warning") : undefined}
              hint={k === "sem_envio" ? `pagos há mais de ${cfg.delay_alert_days} dia(s)` : k === "sem_atualizacao" ? `sem novidade há ${cfg.stale_tracking_days ?? 7}+ dia(s)` : undefined} />
          </Link>
        ))}
      </div>

      <nav className="flex gap-2 text-sm">
        <Link href="/admin/envios" className={`rounded-lg px-3 py-1.5 ${tab === "alertas" ? "bg-ink text-white" : "border border-line"}`}>Alertas ({allAlerts.length})</Link>
        <Link href="/admin/envios?aba=todos" className={`rounded-lg px-3 py-1.5 ${tab === "todos" ? "bg-ink text-white" : "border border-line"}`}>Todos os envios</Link>
      </nav>

      {tab === "alertas" ? (
        <Section title={kind ? ALERT_LABEL[kind] : "Pedidos que precisam de atenção"} actions={kind ? <Link href="/admin/envios" className="text-sm text-muted hover:text-ink">Ver todos os alertas</Link> : undefined}>
          <Table head={["Pedido", "Alerta", "Situação do pedido", "Envio", "Desde", "Dias"]} empty="Nenhum alerta de logística. Tudo em dia.">
            {alerts.map((a) => (
              <tr key={`${a.kind}-${a.order_id}-${a.shipment_id ?? ""}`} className="border-t border-line">
                <td className={td}><Link href={`/admin/pedidos/${a.order_id}`} className="font-medium hover:underline">#{a.number}</Link><div className="text-xs text-muted">{a.customer_name}</div></td>
                <td className={td}><Badge tone={a.kind === "excecao" || a.kind === "prazo_vencido" ? "danger" : "warning"}>{ALERT_LABEL[a.kind]}</Badge></td>
                <td className={td}>{ORDER_STATUS_LABELS[a.order_status]}</td>
                <td className={td}>{a.tracking_code ? <><span className="font-mono text-xs">{a.tracking_code}</span><div className="text-xs text-muted">{a.carrier} · {a.shipment_status ? SHIPMENT_STATUS_LABELS[a.shipment_status] : ""}</div></> : <span className="text-muted">sem rastreio</span>}</td>
                <td className={td}>{formatDate(a.since)}</td>
                <td className={td}>{a.days}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-muted">Prazos ajustáveis em Configurações → Encaminhamento. Avisos ao cliente sobre atraso não são enviados automaticamente.</p>
        </Section>
      ) : (
        <Section title={`Envios (${total})`}>
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="aba" value="todos" />
            <Input name="q" defaultValue={q} placeholder="Código, nº do pedido ou cliente" className="h-9 w-64" />
            <Select name="status" defaultValue={status ?? ""} className="h-9 w-48">
              {[<option key="" value="">Todos os status</option>, ...Object.entries(SHIPMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)]}
            </Select>
            <Button size="sm" variant="secondary">Filtrar</Button>
          </form>
          <Table head={["Pedido", "Transportadora", "Código", "Status", "Prazo confirmado", "Última novidade", "Consultado", ""]} empty="Nenhum envio encontrado.">
            {list.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className={td}><Link href={`/admin/pedidos/${s.order_id}`} className="font-medium hover:underline">#{s.number}</Link></td>
                <td className={td}>{s.carrier ?? "—"}</td>
                <td className={td}>
                  {s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline">{s.tracking_code}</a> : <span className="font-mono text-xs">{s.tracking_code ?? "—"}</span>}
                </td>
                <td className={td}><Badge tone={s.status === "delivered" ? "success" : s.status === "exception" || s.status === "returned" ? "danger" : "neutral"}>{SHIPMENT_STATUS_LABELS[s.status]}</Badge></td>
                <td className={td}>{s.confirmed_eta ? formatDate(s.confirmed_eta) : "—"}</td>
                <td className={td}>{s.last_event_at ? formatDateTime(s.last_event_at) : "—"}</td>
                <td className={td}>{s.is_cj ? (s.last_checked_at ? formatDateTime(s.last_checked_at) : "ainda não") : <span className="text-xs text-muted">manual</span>}</td>
                <td className={td}>
                  {canWrite && s.is_cj && s.tracking_code && s.status !== "delivered" && s.status !== "returned" && (
                    <form action={refreshTrackingAction}>
                      <input type="hidden" name="shipmentId" value={s.id} />
                      <input type="hidden" name="back" value="/admin/envios?aba=todos" />
                      <Button size="sm" variant="ghost">Consultar</Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} total={total} perPage={PER_PAGE} hrefFor={(n) => `/admin/envios?${new URLSearchParams({ aba: "todos", q, status: status ?? "", pagina: String(n) })}`} />
        </Section>
      )}
      {cjCount[0].last && <p className="text-xs text-muted">Última consulta automática à CJ: {formatDateTime(cjCount[0].last)}.</p>}
    </div>
  );
}
