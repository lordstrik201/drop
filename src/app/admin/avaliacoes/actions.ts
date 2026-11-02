"use server";

import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";

export async function moderateReviewAction(f: FormData) {
  const back = `/admin/avaliacoes?status=${encodeURIComponent(str(f, "tab") || "pending")}`;
  return runAdmin(back, async () => {
    const u = await assertPermission("reviews.moderate");
    const status = str(f, "status");
    if (!["approved", "rejected", "pending"].includes(status)) throw new Error("Status inválido.");
    const [r] = await db()`update public.reviews set status = ${status}, moderated_at = now(), moderated_by = ${u.id}
                           where id = ${str(f, "reviewId")} returning id`;
    if (!r) throw new Error("Avaliação não encontrada.");
    await audit(u, `review.${status}`, "review", str(f, "reviewId"));
    return status === "approved" ? "Avaliação publicada." : status === "rejected" ? "Avaliação recusada." : "Avaliação voltou para moderação.";
  });
}
