import { db, type Tx } from "@/lib/db/client";
import type { AppRole } from "@/lib/types";

const ROLES: AppRole[] = ["customer", "operator", "support", "manager", "admin"];

/**
 * Altera o papel de um usuário. Regras: ninguém altera o próprio papel; sempre
 * resta pelo menos um administrador ativo; o usuário precisa já ter conta.
 */
export async function setUserRole(target: { id?: string; email?: string }, role: AppRole, actorId: string) {
  if (!ROLES.includes(role)) throw new Error("Papel inválido.");
  return db().begin(async (tx: Tx) => {
    const [p] = target.id
      ? await tx<{ id: string; role: AppRole; email: string }[]>`select id, role, email from public.profiles where id = ${target.id} for update`
      : await tx<{ id: string; role: AppRole; email: string }[]>`select id, role, email from public.profiles where lower(email) = lower(${target.email ?? ""}) for update`;
    if (!p) throw new Error("Usuário não encontrado. A pessoa precisa criar a conta na loja (Cadastrar) antes de receber acesso ao painel.");
    if (p.id === actorId) throw new Error("Você não pode alterar o seu próprio papel.");
    if (p.role === role) return { ...p, before: p.role };
    if (p.role === "admin" && role !== "admin") {
      // trava as linhas de administradores para evitar duas remoções simultâneas
      const admins = await tx<{ id: string }[]>`select id from public.profiles where role = 'admin' and not is_blocked for update`;
      if (admins.filter((a) => a.id !== p.id).length === 0) throw new Error("É preciso manter pelo menos um administrador.");
    }
    await tx`update public.profiles set role = ${role} where id = ${p.id}`;
    return { ...p, before: p.role };
  });
}
