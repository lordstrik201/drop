"use server";

import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { refreshCjTracking } from "@/lib/shipping/tracking";

const BACK = "/admin/envios";

/** Consulta agora o rastreio na CJ (um envio ou todos os vencidos). */
export async function refreshTrackingAction(f: FormData) {
  const back = str(f, "back").startsWith("/admin/") ? str(f, "back") : BACK;
  return runAdmin(back, async () => {
    const u = await assertPermission("orders.write");
    const id = str(f, "shipmentId");
    const ids = /^[0-9a-f-]{36}$/i.test(id) ? [id] : undefined;
    const r = await refreshCjTracking({ shipmentIds: ids, limit: ids ? 1 : 60, refreshHours: 0 });
    await audit(u, "shipments.track_refresh", "shipment", ids?.[0] ?? null, { after: r });
    if (r.skipped) throw new Error(r.skipped);
    if (!r.checked) return "Nenhum envio da CJ com código de rastreio pendente.";
    return `Rastreio consultado: ${r.checked} envio(s), ${r.updated} com novo status, ${r.events} novo(s) evento(s)${r.notFound ? `, ${r.notFound} não encontrado(s) na CJ` : ""}.`;
  });
}
