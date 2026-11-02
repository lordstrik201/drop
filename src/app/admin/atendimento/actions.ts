"use server";

import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";

export async function contactStatusAction(f: FormData) {
  return runAdmin(`/admin/atendimento?id=${str(f, "id")}`, async () => {
    const u = await assertPermission("customers.write");
    const status = str(f, "status");
    if (!["new", "in_progress", "resolved"].includes(status)) throw new Error("Status inválido.");
    const [r] = await db()`update public.contact_messages set status = ${status} where id = ${str(f, "id")} returning id`;
    if (!r) throw new Error("Mensagem não encontrada.");
    await audit(u, "contact.status", "contact_message", str(f, "id"), { after: { status } });
    return "Status atualizado.";
  });
}

export async function privacyRequestStatusAction(f: FormData) {
  return runAdmin("/admin/atendimento?aba=lgpd", async () => {
    const u = await assertPermission("customers.write");
    const status = str(f, "status");
    if (!["done", "rejected", "open"].includes(status)) throw new Error("Status inválido.");
    const note = str(f, "note");
    if (status === "rejected" && note.length < 5) throw new Error("Explique o motivo da recusa (o titular tem direito a saber).");
    const [r] = await db()`update public.privacy_requests set status = ${status}, resolved_at = ${status === "open" ? null : new Date()},
                             resolved_by = ${status === "open" ? null : u.id}, notes = case when ${note} = '' then notes else coalesce(notes || E'\n', '') || ${note} end
                           where id = ${str(f, "id")} and kind <> 'delete' returning id`;
    if (!r) throw new Error("Solicitação não encontrada. Pedidos de exclusão são atendidos na ficha do cliente.");
    await audit(u, "privacy_request.status", "privacy_request", str(f, "id"), { after: { status } });
    return "Solicitação atualizada.";
  });
}
