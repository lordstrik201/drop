"use server";

import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { setUserRole } from "@/lib/users/roles";
import type { AppRole } from "@/lib/types";

const BACK = "/admin/usuarios";

export async function setRoleAction(f: FormData) {
  return runAdmin(BACK, async () => {
    const u = await assertPermission("users.manage");
    const role = str(f, "role") as AppRole;
    const target = str(f, "profileId") ? { id: str(f, "profileId") } : { email: str(f, "email") };
    if (!target.id && !/^\S+@\S+\.\S+$/.test(target.email ?? "")) throw new Error("Informe um e-mail válido.");
    const r = await setUserRole(target, role, u.id);
    await audit(u, "user.set_role", "profile", r.id, { before: { role: r.before }, after: { role } });
    return role === "customer" ? `Acesso ao painel removido de ${r.email}.` : `${r.email} agora tem o papel selecionado.`;
  });
}
