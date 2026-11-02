import { assertPermission } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/rbac";
import { exportCustomerData } from "@/lib/customers/lgpd";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";

/** Exportação LGPD feita pela equipe (atendimento a pedido do titular). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await assertPermission("customers.export"); } catch (e) {
    return new Response(e instanceof ForbiddenError ? e.message : "Faça login no painel.", { status: e instanceof ForbiddenError ? 403 : 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("not found", { status: 404 });
  let data;
  try { data = await exportCustomerData(id); } catch { return new Response("Cliente não encontrado", { status: 404 }); }
  await audit(user, "customer.export_data", "profile", id);
  const email = (data.perfil as { email: string }).email;
  await db()`update public.privacy_requests set status = 'done', resolved_at = now(), resolved_by = ${user.id} where profile_id = ${id} and kind = 'export' and status = 'open'`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dados-${email.replace(/[^\w.-]/g, "_")}.json"`, "Cache-Control": "no-store" },
  });
}
