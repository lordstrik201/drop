/**
 * Atualização automática de rastreio.
 *
 * Fonte usada: API 2.0 da CJdropshipping — GET /logistic/trackInfo (consulta em lote
 * repetindo `trackNumber`), conforme a documentação oficial
 * https://developers.cjdropshipping.com/en/api/api2/api/logistic.html#_2-1-get-tracking-information-get
 *
 * A documentação só exemplifica o status "In transit" e não publica a lista
 * completa. Por isso:
 *  - "In transit" muda o envio para "em trânsito";
 *  - qualquer outro texto é registrado como evento (o cliente e a equipe veem),
 *    mas NÃO muda o status do envio nem marca entrega: a equipe confirma no painel.
 * Não usamos `deliveryTime`/`deliveryDay` como previsão para o cliente: a CJ não
 * documenta o significado como prazo garantido, e não prometemos prazo sem confirmação.
 *
 * Correios e Melhor Envio: sem rastreio automático até haver contrato/credencial e
 * documentação oficial do serviço de rastreio; o código é lançado manualmente.
 */
import { db, type Tx } from "@/lib/db/client";
import { cjAdapter, type CjTrack } from "@/lib/integrations/suppliers/cj";
import { getCredentials, missingFields } from "@/lib/integrations/credentials";
import { updateShipmentStatus } from "@/lib/orders/admin";
import { log } from "@/lib/logger";
import type { ShipmentStatus } from "@/lib/types";

const BATCH = 20;

/** Converte o texto da CJ em status interno somente quando documentado. */
export function mapCjTrackingStatus(text: string | null | undefined): ShipmentStatus | null {
  if (!text) return null;
  return /^\s*in\s+transit\s*$/i.test(text) ? "in_transit" : null;
}

/** Descrição do evento exibida ao cliente e à equipe (somente dados vindos da CJ). */
export function describeCjTrack(t: CjTrack): string {
  const parts = [t.trackingStatus?.trim() || "Atualização sem status informado"];
  if (t.lastMileCarrier && t.lastTrackNumber && t.lastTrackNumber !== t.trackingNumber) {
    parts.push(`transportadora final ${t.lastMileCarrier}, código ${t.lastTrackNumber}`);
  }
  return parts.join(" — ").slice(0, 500);
}

type OpenShipment = { id: string; tracking_code: string; status: ShipmentStatus; last_desc: string | null };

/** Envios abertos de pedidos da CJ que precisam ser consultados de novo. */
async function dueCjShipments(limit: number, refreshHours: number, ids?: string[]) {
  return db()<OpenShipment[]>`
    select sh.id, sh.tracking_code, sh.status,
           (select te.description from public.tracking_events te where te.shipment_id = sh.id order by te.occurred_at desc, te.id desc limit 1) as last_desc
    from public.shipments sh
    join public.supplier_orders so on so.id = sh.supplier_order_id
    join public.suppliers s on s.id = so.supplier_id
    where s.integration_type = 'cj' and sh.tracking_code is not null
      and sh.status not in ('delivered', 'returned')
      and ${ids ? db()`sh.id = any(${ids}::uuid[])` : db()`(sh.last_checked_at is null or sh.last_checked_at < now() - make_interval(hours => ${refreshHours}))`}
    order by sh.last_checked_at nulls first
    limit ${limit}`;
}

export type TrackingRunResult = { checked: number; updated: number; events: number; notFound: number; skipped?: string };

/**
 * Consulta a CJ e aplica as mudanças. Chamadas em lote (até 20 códigos por
 * requisição) respeitando o limite de requisições do conector.
 */
export async function refreshCjTracking(opts: { limit?: number; refreshHours?: number; shipmentIds?: string[]; f?: typeof fetch; gapMs?: number } = {}): Promise<TrackingRunResult> {
  const result: TrackingRunResult = { checked: 0, updated: 0, events: 0, notFound: 0 };
  if (missingFields("cj", await getCredentials("cj")).length) return { ...result, skipped: "Integração CJ não configurada." };
  const rows = await dueCjShipments(opts.limit ?? 100, opts.refreshHours ?? 12, opts.shipmentIds);
  if (!rows.length) return result;
  const cj = cjAdapter(opts.f ?? fetch, opts.gapMs ?? 1100);
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const tracks = await cj.trackInfo(chunk.map((r) => r.tracking_code));
    const byCode = new Map(tracks.map((t) => [String(t.trackingNumber).toUpperCase(), t]));
    for (const sh of chunk) {
      result.checked++;
      const t = byCode.get(sh.tracking_code.toUpperCase());
      if (!t) {
        result.notFound++;
        await db()`update public.shipments set last_checked_at = now() where id = ${sh.id}`;
        continue;
      }
      const desc = describeCjTrack(t);
      const mapped = mapCjTrackingStatus(t.trackingStatus);
      const changed = mapped && mapped !== sh.status && canAdvance(sh.status, mapped);
      if (changed) {
        await updateShipmentStatus(sh.id, mapped, desc !== sh.last_desc ? { at: new Date(), description: desc } : null, "tracking");
        result.updated++;
        if (desc !== sh.last_desc) result.events++;
      } else {
        await db().begin(async (tx: Tx) => {
          if (desc !== sh.last_desc) {
            await tx`insert into public.tracking_events (shipment_id, occurred_at, status, description, raw)
                     values (${sh.id}, now(), ${mapped}, ${desc}, ${tx.json(t as never)}) on conflict do nothing`;
            await tx`update public.shipments set last_event_at = now() where id = ${sh.id}`;
            result.events++;
          }
          await tx`update public.shipments set last_checked_at = now() where id = ${sh.id}`;
        });
      }
    }
  }
  if (result.notFound) await log("warn", "tracking", `${result.notFound} código(s) de rastreio não encontrados na CJ`, { checked: result.checked });
  return result;
}

const ORDER: ShipmentStatus[] = ["pending", "posted", "in_transit", "out_for_delivery", "delivered"];
/** Rastreio automático só avança o envio; nunca volta etapas nem mexe em exceção/devolução. */
function canAdvance(from: ShipmentStatus, to: ShipmentStatus) {
  const a = ORDER.indexOf(from), b = ORDER.indexOf(to);
  return a >= 0 && b > a;
}
