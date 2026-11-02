import { headers } from "next/headers";
import { db, type DbOrTx } from "@/lib/db/client";
import { redact } from "@/lib/logger";

export type AuditActor = { id: string; email: string } | null;

/** Registra uma alteração administrativa (quem, o quê, antes e depois). */
export async function audit(
  actor: AuditActor,
  action: string,
  entity: string,
  entityId: string | null,
  change: { before?: unknown; after?: unknown } = {},
  sql: DbOrTx = db(),
) {
  let ip: string | null = null;
  let ua: string | null = null;
  try {
    const h = await headers();
    ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    ua = h.get("user-agent");
  } catch {
    // fora de uma requisição (tarefas agendadas)
  }
  const before = change.before === undefined ? null : sql.json(redact(change.before) as never);
  const after = change.after === undefined ? null : sql.json(redact(change.after) as never);
  await sql`
    insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, before, after, ip, user_agent)
    values (${actor?.id ?? null}, ${actor?.email ?? null}, ${action}, ${entity}, ${entityId}, ${before}, ${after},
            ${ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null}, ${ua})`;
}
