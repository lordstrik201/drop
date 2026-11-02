import type { Tx } from "@/lib/db/client";
import type { OrderStatus } from "@/lib/types";
import { canTransition, InvalidTransitionError } from "./status";

export type TransitionSource = "checkout" | "webhook" | "admin" | "job" | "supplier" | "tracking" | "system";

/**
 * Muda o status do pedido dentro de uma transação, com bloqueio de linha,
 * validação pela máquina de estados e registro no histórico.
 * Retorna false (sem erro) quando o pedido já está no status desejado: torna
 * reprocessamentos idempotentes.
 */
export async function transitionOrder(
  tx: Tx,
  orderId: string,
  to: OrderStatus,
  source: TransitionSource,
  opts: { actorId?: string | null; note?: string | null } = {},
): Promise<boolean> {
  const [o] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId} for update`;
  if (!o) throw new Error("Pedido não encontrado");
  if (o.status === to) return false;
  if (!canTransition(o.status, to)) throw new InvalidTransitionError(o.status, to);
  const extra =
    to === "paid" ? tx`, paid_at = coalesce(paid_at, now())`
    : to === "canceled" ? tx`, canceled_at = now(), cancel_reason = coalesce(${opts.note ?? null}, cancel_reason)`
    : to === "delivered" ? tx`, delivered_at = coalesce(delivered_at, now())`
    : tx``;
  await tx`update public.orders set status = ${to} ${extra} where id = ${orderId}`;
  await tx`insert into public.order_status_history (order_id, from_status, to_status, source, actor_id, note)
           values (${orderId}, ${o.status}, ${to}, ${source}, ${opts.actorId ?? null}, ${opts.note ?? null})`;
  return true;
}
