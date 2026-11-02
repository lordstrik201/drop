import type { AppRole } from "@/lib/types";

export const STAFF_ROLES: AppRole[] = ["operator", "support", "manager", "admin"];

export const ROLE_LABELS: Record<AppRole, string> = {
  customer: "Cliente",
  operator: "Operador",
  support: "Atendimento",
  manager: "Gerente",
  admin: "Administrador",
};

export type Permission =
  | "dashboard.view" | "products.read" | "products.write" | "products.delete"
  | "suppliers.read" | "suppliers.write" | "orders.read" | "orders.write" | "orders.approve"
  | "orders.cancel" | "payments.refund" | "customers.read" | "customers.write" | "customers.export"
  | "finance.read" | "finance.write" | "marketing.write" | "reviews.moderate" | "reports.read"
  | "settings.write" | "integrations.write" | "users.manage" | "monitoring.read" | "monitoring.retry"
  | "audit.read";

export type PermissionMap = Map<AppRole, Set<string>>;

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export function hasPermission(map: PermissionMap, role: AppRole | null | undefined, perm: Permission): boolean {
  if (!role || role === "customer") return false;
  return map.get(role)?.has(perm) ?? false;
}

export class ForbiddenError extends Error {
  constructor(public permission: string) {
    super(`Acesso negado: permissão "${permission}" necessária.`);
  }
}
