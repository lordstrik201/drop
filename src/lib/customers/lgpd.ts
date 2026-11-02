import { db, type Tx } from "@/lib/db/client";

/** LGPD art. 18, V — portabilidade: todos os dados pessoais do titular em JSON. */
export async function exportCustomerData(profileId: string) {
  const sql = db();
  const [profile] = await sql`select id, email, full_name, phone, cpf, birth_date, marketing_consent, marketing_consent_at, created_at from public.profiles where id = ${profileId}`;
  if (!profile) throw new Error("Cliente não encontrado");
  const [addresses, orders, reviews, contacts, requests] = await Promise.all([
    sql`select label, recipient_name, phone, cep, street, number, complement, district, city, state, created_at from public.addresses where profile_id = ${profileId}`,
    sql`select o.number, o.status, o.total_cents, o.created_at, o.customer_name, o.customer_email, o.customer_phone, o.customer_cpf, o.shipping_address,
               (select json_agg(json_build_object('produto', product_name, 'variacao', variant_title, 'quantidade', quantity, 'total_centavos', total_cents)) from public.order_items i where i.order_id = o.id) as itens
        from public.orders o where o.profile_id = ${profileId} order by o.created_at`,
    sql`select product_id, rating, title, body, status, created_at from public.reviews where profile_id = ${profileId}`,
    sql`select subject, message, created_at from public.contact_messages where profile_id = ${profileId}`,
    sql`select kind, status, created_at, resolved_at from public.privacy_requests where profile_id = ${profileId}`,
  ]);
  return { gerado_em: new Date().toISOString(), perfil: profile, enderecos: addresses, pedidos: orders, avaliacoes: reviews, contatos: contacts, solicitacoes_lgpd: requests };
}

const OPEN_STATES = ["pending_payment", "paid", "awaiting_supplier", "sent_to_supplier", "preparing", "shipped", "in_transit", "under_review"];

/**
 * LGPD art. 18, VI — eliminação. Apaga a conta de acesso, endereços e dados de
 * perfil, e anonimiza avaliações e mensagens. Pedidos e lançamentos financeiros
 * são CONSERVADOS (art. 16, I: cumprimento de obrigação legal — fiscal/CDC),
 * desvinculados da conta. Recusa se houver pedido em andamento.
 */
export async function anonymizeCustomer(profileId: string, actorId: string, note: string | null) {
  return db().begin(async (tx: Tx) => {
    const [p] = await tx<{ id: string; email: string; role: string }[]>`select id, email, role from public.profiles where id = ${profileId} for update`;
    if (!p) throw new Error("Cliente não encontrado");
    if (p.role !== "customer") throw new Error("Contas da equipe não podem ser eliminadas por aqui. Remova o acesso em Usuários primeiro.");
    const [open] = await tx<{ n: number }[]>`select count(*)::int as n from public.orders where profile_id = ${profileId} and status = any(${OPEN_STATES}::public.order_status[])`;
    if (open.n > 0) throw new Error(`Há ${open.n} pedido(s) em andamento. Conclua ou cancele antes de eliminar os dados.`);
    await tx`update public.reviews set author_name = 'Cliente', profile_id = null where profile_id = ${profileId}`;
    await tx`update public.contact_messages set name = 'Anonimizado', email = 'anonimizado@invalid', phone = null, profile_id = null where profile_id = ${profileId} or lower(email) = lower(${p.email})`;
    await tx`update public.carts set email = null, profile_id = null where profile_id = ${profileId}`;
    await tx`update public.privacy_requests set status = 'done', resolved_at = now(), resolved_by = ${actorId}, notes = coalesce(notes || E'\n', '') || 'Dados eliminados'
             where profile_id = ${profileId} and kind = 'delete' and status = 'open'`;
    await tx`insert into public.privacy_requests (profile_id, email, kind, status, resolved_at, resolved_by, notes)
             values (null, ${p.email}, 'delete', 'done', now(), ${actorId}, ${note ?? "Eliminação executada pelo painel"})`;
    await tx`update public.privacy_requests set profile_id = null where profile_id = ${profileId}`;
    // Excluir o usuário de autenticação remove em cascata perfil, endereços e notas de atendimento;
    // os pedidos ficam com profile_id nulo (mantidos por obrigação legal).
    await tx`delete from auth.users where id = ${profileId}`;
    return { email: p.email };
  });
}
