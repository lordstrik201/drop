import Link from "next/link";
import Image from "next/image";
import { Search, ShoppingCart, User, Package } from "lucide-react";
import { getSetting } from "@/lib/settings";
import { listCategories } from "@/lib/catalog/queries";
import { getCart } from "@/lib/cart/cart";
import { getSessionUser } from "@/lib/auth/session";

export async function StoreHeader() {
  const [identity, categories, cart, user] = await Promise.all([getSetting("store.identity"), listCategories(), getCart(), getSessionUser()]);
  const top = categories.filter((c) => !c.parent_id).slice(0, 10);
  return (
    <header className="sticky top-0 z-40 bg-brand text-brand-contrast shadow">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 md:flex-nowrap md:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-extrabold tracking-tight" aria-label={`${identity.name} — página inicial`}>
          {identity.logo_url ? (
            <Image src={identity.logo_url} alt={identity.name} width={140} height={40} className="h-9 w-auto object-contain" priority />
          ) : (
            <span>{identity.name}</span>
          )}
        </Link>
        <form action="/busca" role="search" className="order-last flex w-full md:order-none md:flex-1">
          <label htmlFor="q" className="sr-only">Buscar produtos</label>
          <input id="q" name="q" type="search" placeholder="O que você está procurando?" autoComplete="off"
            className="h-11 w-full rounded-l-lg border-0 bg-white px-4 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent" />
          <button type="submit" className="flex h-11 w-12 items-center justify-center rounded-r-lg bg-accent text-ink hover:brightness-105" aria-label="Buscar">
            <Search size={20} aria-hidden />
          </button>
        </form>
        <nav className="ml-auto flex items-center gap-1 text-sm md:ml-0" aria-label="Conta e carrinho">
          {user?.isStaff && (
            <Link href="/admin" className="hidden rounded-lg px-3 py-2 font-medium hover:bg-white/10 lg:block">Painel</Link>
          )}
          <Link href={user ? "/conta" : "/entrar"} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10">
            <User size={20} aria-hidden />
            <span className="hidden leading-tight sm:block">
              <span className="block text-[11px] opacity-80">{user ? `Olá, ${(user.fullName ?? user.email).split(" ")[0]}` : "Olá, faça login"}</span>
              <span className="block font-semibold">{user ? "Minha conta" : "Entrar"}</span>
            </span>
          </Link>
          <Link href="/conta/pedidos" className="hidden items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10 md:flex">
            <Package size={20} aria-hidden />
            <span className="font-semibold">Pedidos</span>
          </Link>
          <Link href="/carrinho" className="relative flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10" aria-label={`Carrinho com ${cart.itemCount} itens`}>
            <ShoppingCart size={22} aria-hidden />
            {cart.itemCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-ink">{cart.itemCount}</span>
            )}
          </Link>
        </nav>
      </div>
      {top.length > 0 && (
        <nav className="bg-black/10" aria-label="Categorias">
          <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 text-sm [scrollbar-width:none]">
            <li><Link href="/ofertas" className="block whitespace-nowrap rounded-md px-3 py-1 font-semibold hover:bg-white/10">Ofertas</Link></li>
            {top.map((c) => (
              <li key={c.id}><Link href={`/categoria/${c.slug}`} className="block whitespace-nowrap rounded-md px-3 py-1 hover:bg-white/10">{c.name}</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
