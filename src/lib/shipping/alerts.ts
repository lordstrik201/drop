import { db } from "@/lib/db/client";
import { readSetting } from "@/lib/settings";
import { log } from "@/lib/logger";
import type { OrderStatus, ShipmentStatus } from "@/lib/types";

export type AlertKind = "sem_envio" | "sem_atualizacao" | "prazo_vencido" | "excecao";
export const ALERT_LABEL: Record<AlertKind, string> = {
  sem_envio: "Pago e sem rastreio",
  sem_atualizacao: "Rastreio parado",
  prazo_vencido: "Prazo confirmado vencido",
  excecao: "Problema na entrega",
};

export type LogisticsAlert = {
  kind: AlertKind;
  order_id: string;
  number: string;
  customer_name: string | null;
  order_status: OrderStatus;
  shipment_id: string | null;
  carrier: string | null;
  tracking_code: string | null;
  shipment_status: ShipmentStatus | null;
  since: Date;
  days: number;
};

/**
 * Pedidos e envios que precisam de atenção. Limites vêm de Configurações →
 * Encaminhamento: dias sem rastreio após o pagamento e dias sem atualização.
 */
export async function logisticsAlerts(kind?: AlertKind, limit = 200): Promise<LogisticsAlert[]> {
  const cfg = await readSetting("fulfillment");
  const noShipDays = cfg.delay_alert_days ?? 3;
  const staleDays = cfg.stale_tracking_days ?? 7;
  const sql = db();
  const rows = await sql<LogisticsAlert[]>`
    with paid_unshipped as (
      select 'sem_envio'::text as kind, o.id as order_id, o.number::text, o.customer_name, o.status as order_status,
             null::uuid as shipment_id, null::text as carrier, null::text as tracking_code, null::public.shipment_status as shipment_status,
             o.paid_at as since
      from public.orders o
      where o.status in ('paid', 'awaiting_supplier', 'sent_to_supplier', 'preparing')
        and o.paid_at < now() - make_interval(days => ${noShipDays})
        and not exists (select 1 from public.shipments sh where sh.order_id = o.id and sh.tracking_code is not null)
    ), open_sh as (
      select sh.*, o.number::text as number, o.customer_name, o.status as order_status
      from public.shipments sh join public.orders o on o.id = sh.order_id
      where sh.status not in ('delivered', 'returned') and o.status not in ('canceled', 'refunded')
    )
    select * from paid_unshipped
    union all
    select 'excecao', order_id, number, customer_name, order_status, id, carrier, tracking_code, status, coalesce(last_event_at, updated_at)
      from open_sh where status = 'exception'
    union all
    select 'prazo_vencido', order_id, number, customer_name, order_status, id, carrier, tracking_code, status, confirmed_eta::timestamptz
      from open_sh where status <> 'exception' and confirmed_eta < (now() at time zone 'America/Sao_Paulo')::date
    union all
    select 'sem_atualizacao', order_id, number, customer_name, order_status, id, carrier, tracking_code, status, coalesce(last_event_at, shipped_at, created_at)
      from open_sh where status <> 'exception' and (confirmed_eta is null or confirmed_eta >= (now() at time zone 'America/Sao_Paulo')::date)
        and coalesce(last_event_at, shipped_at, created_at) < now() - make_interval(days => ${staleDays})
    order by since`;
  const now = Date.now();
  return rows
    .filter((r) => !kind || r.kind === kind)
    .slice(0, limit)
    .map((r) => ({ ...r, days: Math.max(0, Math.floor((now - new Date(r.since).getTime()) / 86_400_000)) }));
}

export function countAlerts(rows: LogisticsAlert[]): Record<AlertKind, number> {
  const c: Record<AlertKind, number> = { sem_envio: 0, sem_atualizacao: 0, prazo_vencido: 0, excecao: 0 };
  for (const r of rows) c[r.kind]++;
  return c;
}

/** Resumo diário no log do sistema (aparece em Monitoramento → Logs). Não envia nada ao cliente. */
export async function reportLogisticsAlerts() {
  const rows = await logisticsAlerts(undefined, 5000);
  const c = countAlerts(rows);
  if (rows.length) {
    await log("warn", "logistics", `Atenção na logística: ${rows.length} pedido(s)/envio(s) com alerta`, c);
  }
  return c;
}
