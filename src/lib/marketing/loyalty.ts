import { db, type Tx } from "@/lib/db/client";
import { readSetting } from "@/lib/settings";
import { randomToken } from "@/lib/security/crypto";

/**
 * Fidelidade: pontos creditados quando o pedido é ENTREGUE (evita creditar
 * compra que ainda pode ser cancelada) e estornados se o pedido for
 * reembolsado depois. Troca: o cliente converte pontos em um cupom pessoal.
 */
export async function awardLoyaltyPoints() {
  const cfg = await readSetting("loyalty");
  if (!cfg.enabled || !cfg.points_per_real) return { skipped: "Programa de fidelidade desativado.", awarded: 0, reversed: 0 };
  const sql = db();
  const awarded = await sql`
    insert into public.loyalty_ledger (profile_id, order_id, points, reason, dedupe_key)
    select o.profile_id, o.id,
           floor(greatest(o.total_cents - coalesce((select sum(refunded_cents) from public.payments p where p.order_id = o.id), 0), 0) / 100.0 * ${cfg.points_per_real})::int,
           'Pedido #' || o.number || ' entregue', 'earn:' || o.id
    from public.orders o
    where o.status = 'delivered' and o.profile_id is not null
      and o.updated_at > now() - interval '90 days'
      and not exists (select 1 from public.loyalty_ledger l where l.dedupe_key = 'earn:' || o.id)
    on conflict (dedupe_key) do nothing
    returning id`;
  // pedido reembolsado após o crédito: estorna o que foi creditado
  const reversed = await sql`
    insert into public.loyalty_ledger (profile_id, order_id, points, reason, dedupe_key)
    select l.profile_id, l.order_id, -l.points, 'Estorno: pedido #' || o.number || ' reembolsado', 'reverse:' || l.order_id
    from public.loyalty_ledger l join public.orders o on o.id = l.order_id
    where l.dedupe_key like 'earn:%' and l.points > 0 and o.status in ('refunded', 'canceled')
      and not exists (select 1 from public.loyalty_ledger r where r.dedupe_key = 'reverse:' || l.order_id)
    on conflict (dedupe_key) do nothing
    returning id`;
  return { awarded: awarded.length, reversed: reversed.length };
}

export async function loyaltyBalance(profileId: string, sql: Tx | ReturnType<typeof db> = db()) {
  const [r] = await sql<{ points: number }[]>`select coalesce(sum(points), 0)::int as points from public.loyalty_ledger where profile_id = ${profileId}`;
  return r.points;
}

/** Troca pontos por um cupom pessoal de valor fixo, válido só para o e-mail do cliente. */
export async function redeemPoints(profileId: string, points: number) {
  const cfg = await readSetting("loyalty");
  if (!cfg.enabled) throw new Error("O programa de fidelidade não está ativo.");
  if (!Number.isInteger(points) || points < (cfg.min_redeem_points ?? 1)) throw new Error(`Troque pelo menos ${cfg.min_redeem_points} pontos.`);
  return db().begin(async (tx: Tx) => {
    const [p] = await tx<{ email: string }[]>`select email from public.profiles where id = ${profileId} for update`;
    if (!p) throw new Error("Conta não encontrada.");
    const balance = await loyaltyBalance(profileId, tx);
    if (points > balance) throw new Error(`Saldo insuficiente: você tem ${balance} pontos.`);
    const value = points * cfg.cents_per_point;
    const code = `PONTOS-${randomToken(6).replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}`;
    const ends = new Date(Date.now() + (cfg.coupon_valid_days ?? 60) * 86_400_000);
    const [c] = await tx<{ id: string }[]>`
      insert into public.coupons (code, description, kind, value, max_uses, max_uses_per_customer, customer_email, origin, ends_at, is_active)
      values (${code}, ${`Troca de ${points} pontos`}, 'fixed', ${value}, 1, 1, ${p.email.toLowerCase()}, 'loyalty', ${ends}, true)
      returning id`;
    await tx`insert into public.loyalty_ledger (profile_id, points, reason, dedupe_key)
             values (${profileId}, ${-points}, ${`Troca por cupom ${code}`}, ${`redeem:${c.id}`})`;
    return { code, valueCents: value, endsAt: ends };
  });
}
