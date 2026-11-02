import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { rateLimit } from "@/lib/security/rate-limit";

/** LGPD (art. 18): portabilidade — o titular baixa seus próprios dados em JSON. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await rateLimit(`export:${user.id}`, 5, 3600)).allowed) return NextResponse.json({ error: "Muitas solicitações" }, { status: 429 });
  const sql = db();
  const [profile] = await sql`select id, email, full_name, phone, cpf, birth_date, marketing_consent, marketing_consent_at, created_at from public.profiles where id = ${user.id}`;
  const [addresses, orders, reviews, contacts] = await Promise.all([
    sql`select label, recipient_name, phone, cep, street, number, complement, district, city, state, created_at from public.addresses where profile_id = ${user.id}`,
    sql`select o.number, o.status, o.total_cents, o.created_at, o.shipping_address,
               (select json_agg(json_build_object('produto', product_name, 'variacao', variant_title, 'quantidade', quantity, 'total_centavos', total_cents)) from public.order_items i where i.order_id = o.id) as itens
        from public.orders o where o.profile_id = ${user.id} order by o.created_at`,
    sql`select product_id, rating, title, body, status, created_at from public.reviews where profile_id = ${user.id}`,
    sql`select subject, message, created_at from public.contact_messages where profile_id = ${user.id}`,
  ]);
  await sql`insert into public.privacy_requests (profile_id, email, kind, status, resolved_at, notes) values (${user.id}, ${user.email}, 'export', 'done', now(), 'Exportação automática pelo titular')`;
  return new NextResponse(JSON.stringify({ gerado_em: new Date().toISOString(), perfil: profile, enderecos: addresses, pedidos: orders, avaliacoes: reviews, contatos: contacts }, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="meus-dados.json"`, "Cache-Control": "no-store" },
  });
}
