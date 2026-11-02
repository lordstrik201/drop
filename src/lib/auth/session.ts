import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import type { AppRole } from "@/lib/types";
import { isAuthConfigured, supabaseServer } from "./supabase";
import { ForbiddenError, hasPermission, isStaffRole, type Permission, type PermissionMap } from "./rbac";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  isStaff: boolean;
};

/**
 * Usuário autenticado da requisição atual. A identidade vem do JWT verificado
 * pelo Supabase (getClaims valida a assinatura); a função e o bloqueio vêm do
 * banco, nunca do token ou do cliente.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (!isAuthConfigured()) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  const [p] = await db()<{ id: string; email: string; full_name: string | null; role: AppRole; is_blocked: boolean }[]>`
    select id, email, full_name, role, is_blocked from public.profiles where id = ${sub}`;
  if (!p || p.is_blocked) return null;
  return { id: p.id, email: p.email, fullName: p.full_name, role: p.role, isStaff: isStaffRole(p.role) };
});

let permCache: { map: PermissionMap; at: number } | null = null;

export async function loadPermissionMap(): Promise<PermissionMap> {
  if (permCache && Date.now() - permCache.at < 60_000) return permCache.map;
  const rows = await db()<{ role: AppRole; permission: string }[]>`select role, permission from public.role_permissions`;
  const map: PermissionMap = new Map();
  for (const r of rows) {
    if (!map.has(r.role)) map.set(r.role, new Set());
    map.get(r.role)!.add(r.permission);
  }
  permCache = { map, at: Date.now() };
  return map;
}

export async function can(user: SessionUser | null, perm: Permission): Promise<boolean> {
  if (!user) return false;
  return hasPermission(await loadPermissionMap(), user.role, perm);
}

/** Para páginas: redireciona ao login se não houver sessão. */
export async function requireUser(next = "/conta"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(next)}`);
  return user;
}

/** Para páginas do painel: exige equipe interna e a permissão indicada. */
export async function requireStaffPage(perm: Permission, next = "/admin"): Promise<SessionUser> {
  const user = await requireUser(next);
  if (!user.isStaff) redirect("/");
  if (!(await can(user, perm))) redirect("/admin/sem-permissao");
  return user;
}

/** Para Server Actions e rotas de API: lança erro em vez de redirecionar. */
export async function assertPermission(perm: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !user.isStaff) throw new ForbiddenError(perm);
  if (!(await can(user, perm))) throw new ForbiddenError(perm);
  return user;
}
