import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage, loadPermissionMap } from "@/lib/auth/session";
import { hasPermission, ROLE_LABELS, type Permission } from "@/lib/auth/rbac";
import { getSetting } from "@/lib/settings";
import { AdminNav } from "@/components/admin/nav";

export const metadata: Metadata = { title: { default: "Painel", template: "%s · Painel" }, robots: { index: false, follow: false } };

const ITEMS: { href: string; label: string; icon: string; perm: Permission; group: string }[] = [
  { href: "/admin", label: "Dashboard", icon: "gauge", perm: "dashboard.view", group: "Visão geral" },
  { href: "/admin/pedidos", label: "Pedidos", icon: "receipt", perm: "orders.read", group: "Operação" },
  { href: "/admin/encaminhamento", label: "Encaminhamento", icon: "send", perm: "orders.read", group: "Operação" },
  { href: "/admin/produtos", label: "Produtos", icon: "package", perm: "products.read", group: "Catálogo" },
  { href: "/admin/categorias", label: "Categorias", icon: "folder", perm: "products.read", group: "Catálogo" },
  { href: "/admin/fornecedores", label: "Fornecedores", icon: "factory", perm: "suppliers.read", group: "Catálogo" },
  { href: "/admin/clientes", label: "Clientes", icon: "users", perm: "customers.read", group: "Clientes" },
  { href: "/admin/atendimento", label: "Atendimento", icon: "message", perm: "customers.read", group: "Clientes" },
  { href: "/admin/avaliacoes", label: "Avaliações", icon: "star", perm: "reviews.moderate", group: "Clientes" },
  { href: "/admin/pagamentos", label: "Pagamentos", icon: "card", perm: "finance.read", group: "Gestão" },
  { href: "/admin/financeiro", label: "Financeiro", icon: "wallet", perm: "finance.read", group: "Gestão" },
  { href: "/admin/relatorios", label: "Relatórios", icon: "chart", perm: "reports.read", group: "Gestão" },
  { href: "/admin/marketing", label: "Marketing", icon: "megaphone", perm: "marketing.write", group: "Gestão" },
  { href: "/admin/conteudo", label: "Páginas e banners", icon: "file", perm: "settings.write", group: "Loja" },
  { href: "/admin/configuracoes", label: "Configurações", icon: "settings", perm: "settings.write", group: "Loja" },
  { href: "/admin/integracoes", label: "Integrações", icon: "plug", perm: "monitoring.read", group: "Loja" },
  { href: "/admin/usuarios", label: "Usuários", icon: "shield", perm: "users.manage", group: "Loja" },
  { href: "/admin/monitoramento", label: "Monitoramento", icon: "activity", perm: "monitoring.read", group: "Sistema" },
  { href: "/admin/auditoria", label: "Auditoria", icon: "history", perm: "audit.read", group: "Sistema" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffPage("dashboard.view", "/admin");
  const [map, identity] = await Promise.all([loadPermissionMap(), getSetting("store.identity")]);
  const items = ITEMS.filter((i) => hasPermission(map, user.role, i.perm));
  const env = process.env.APP_ENV ?? "development";
  return (
    <div className="flex min-h-dvh bg-bg">
      <AdminNav items={items} storeName={identity.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-2 pl-10 text-sm lg:pl-0">
            {env !== "production" && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{env === "staging" ? "HOMOLOGAÇÃO" : "DESENVOLVIMENTO"}</span>}
            <Link href="/" target="_blank" className="text-muted hover:text-ink">Ver loja ↗</Link>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-right leading-tight sm:block"><span className="block font-medium">{user.fullName ?? user.email}</span><span className="block text-xs text-muted">{ROLE_LABELS[user.role]}</span></span>
            <form action="/auth/sair" method="post"><button className="rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-bg">Sair</button></form>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
