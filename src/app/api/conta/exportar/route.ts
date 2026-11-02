import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { rateLimit } from "@/lib/security/rate-limit";
import { exportCustomerData } from "@/lib/customers/lgpd";

/** LGPD (art. 18): portabilidade — o titular baixa seus próprios dados em JSON. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await rateLimit(`export:${user.id}`, 5, 3600)).allowed) return NextResponse.json({ error: "Muitas solicitações" }, { status: 429 });
  const data = await exportCustomerData(user.id);
  await db()`insert into public.privacy_requests (profile_id, email, kind, status, resolved_at, notes) values (${user.id}, ${user.email}, 'export', 'done', now(), 'Exportação automática pelo titular')`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="meus-dados.json"`, "Cache-Control": "no-store" },
  });
}
