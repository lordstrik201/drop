import Link from "next/link";
import { requireUser } from "@/lib/auth/session";

const NAV = [
  { href: "/conta", label: "Visão geral" },
  { href: "/conta/pedidos", label: "Meus pedidos" },
  { href: "/conta/enderecos", label: "Endereços" },
  { href: "/conta/dados", label: "Dados e privacidade" },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/conta");
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:grid-cols-[220px_1fr]">
      <aside>
        <p className="mb-3 text-sm text-muted">Olá, <strong className="text-ink">{user.fullName ?? user.email}</strong></p>
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Minha conta">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm hover:bg-surface">{n.label}</Link>)}
          <form action="/auth/sair" method="post"><button className="w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-surface">Sair</button></form>
        </nav>
      </aside>
      <div>{children}</div>
    </div>
  );
}
