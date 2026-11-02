import { db, type Tx } from "@/lib/db/client";
import { readSetting } from "@/lib/settings";
import { transitionOrder } from "./transition";
import { releaseOrderStock } from "./create";
import { enqueueJob } from "@/lib/jobs/queue";
import { log } from "@/lib/logger";

/**
 * Cancela pedidos que ficaram "Aguardando pagamento" além do prazo e devolve o
 * estoque reservado. Pedidos com pagamento em processamento não são tocados.
 */
export async function expireUnpaidOrders() {
  const cfg = await readSetting("checkout");
  const hours = Math.max(cfg.pending_payment_expiration_hours, 1);
  const rows = await db()<{ id: string }[]>`
    select o.id from public.orders o
    where o.status = 'pending_payment' and o.created_at < now() - make_interval(hours => ${hours})
      and not exists (select 1 from public.payments p where p.order_id = o.id and p.status in ('approved', 'in_process', 'authorized'))
    limit 200`;
  let n = 0;
  for (const r of rows) {
    await db().begin(async (tx: Tx) => {
      const changed = await transitionOrder(tx, r.id, "canceled", "job", { note: "Pagamento não identificado dentro do prazo" });
      if (changed) {
        await releaseOrderStock(tx, r.id, "expired");
        await enqueueJob(tx, "notify.order", { orderId: r.id, template: "order_canceled" }, `notify:order_canceled:${r.id}`);
        n++;
      }
    });
  }
  if (n) await log("info", "orders", `${n} pedido(s) expirado(s) por falta de pagamento`);
  return { expired: n };
}
