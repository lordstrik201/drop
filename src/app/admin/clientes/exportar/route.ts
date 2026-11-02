import { assertPermission } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/rbac";
import { db } from "@/lib/db/client";
import { audit } from "@/lib/audit";
import { toCSV, csvResponse, centsCell } from "@/lib/reports/csv";
import { todaySP } from "@/lib/ui/dates";

/**
 * Lista de clientes em CSV. Com ?consentimento=1 traz apenas quem autorizou
 * comunicações de marketing (base legal: consentimento — LGPD art. 7º, I).
 */
export async function GET(req: Request) {
  let user;
  try { user = await assertPermission("customers.export"); } catch (e) {
    return new Response(e instanceof ForbiddenError ? e.message : "Faça login no painel.", { status: e instanceof ForbiddenError ? 403 : 401 });
  }
  const onlyConsent = new URL(req.url).searchParams.get("consentimento") === "1";
  const rows = await db()<{ email: string; full_name: string | null; phone: string | null; marketing_consent: boolean; marketing_consent_at: Date | null; created_at: Date; orders: number; spent: number; last_order: Date | null }[]>`
    select p.email, p.full_name, p.phone, p.marketing_consent, p.marketing_consent_at, p.created_at,
           count(o.id) filter (where o.paid_at is not null)::int as orders,
           coalesce(sum(o.total_cents) filter (where o.paid_at is not null and o.status <> 'refunded'), 0)::int as spent,
           max(o.created_at) as last_order
    from public.profiles p left join public.orders o on o.profile_id = p.id
    where p.role = 'customer' and p.anonymized_at is null ${onlyConsent ? db()`and p.marketing_consent` : db()``}
    group by p.id order by p.created_at`;
  await audit(user, "customers.export_csv", "profiles", null, { after: { rows: rows.length, onlyConsent } });
  return csvResponse(toCSV(rows, [
    { header: "email", value: (r) => r.email },
    { header: "nome", value: (r) => r.full_name },
    { header: "telefone", value: (r) => r.phone },
    { header: "aceita_marketing", value: (r) => (r.marketing_consent ? "sim" : "não") },
    { header: "consentimento_em", value: (r) => r.marketing_consent_at },
    { header: "cadastro_em", value: (r) => r.created_at },
    { header: "pedidos_pagos", value: (r) => r.orders },
    { header: "total_gasto", value: (r) => centsCell(r.spent) },
    { header: "ultimo_pedido", value: (r) => r.last_order },
  ]), `clientes-${onlyConsent ? "marketing-" : ""}${todaySP()}.csv`);
}
