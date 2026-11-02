import Link from "next/link";
import { ShieldCheck, Truck, CreditCard, RotateCcw } from "lucide-react";
import { activeBanners, listCategories, listProducts } from "@/lib/catalog/queries";
import { ProductRail } from "@/components/store/product-card";
import { HeroCarousel } from "@/components/store/hero";
import { getSetting } from "@/lib/settings";
import { EmptyState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";

export default async function HomePage() {
  const [banners, featured, best, offers, categories, identity] = await Promise.all([
    activeBanners("home_hero"),
    listProducts({ featured: true, perPage: 10 }),
    listProducts({ sort: "bestsellers", perPage: 10 }),
    listProducts({ onSale: true, sort: "discount", perPage: 10 }),
    listCategories(),
    getSetting("store.identity"),
  ]);
  const empty = featured.total === 0 && best.total === 0;
  const user = empty ? await getSessionUser() : null;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-6 pt-4">
      {banners.length > 0 ? (
        <HeroCarousel banners={banners} />
      ) : (
        <section className="rounded-2xl bg-gradient-to-br from-brand to-brand/70 px-6 py-12 text-brand-contrast sm:px-10 sm:py-16">
          <h1 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">{identity.name}</h1>
          {identity.tagline && <p className="mt-3 max-w-xl text-base opacity-90">{identity.tagline}</p>}
          <Link href="/busca" className="mt-6 inline-flex h-11 items-center rounded-lg bg-accent px-6 font-semibold text-ink">Ver produtos</Link>
        </section>
      )}

      <ul className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        {[
          { icon: CreditCard, t: "Pix e cartão", d: "Pagamento seguro pelo Mercado Pago" },
          { icon: ShieldCheck, t: "Compra protegida", d: "Seus dados não ficam com a loja" },
          { icon: Truck, t: "Envio para todo o Brasil", d: "Acompanhe pelo código de rastreio" },
          { icon: RotateCcw, t: "Trocas e devoluções", d: "Conforme o Código de Defesa do Consumidor" },
        ].map(({ icon: I, t, d }) => (
          <li key={t} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
            <I className="shrink-0 text-brand" size={22} aria-hidden />
            <div><p className="font-semibold">{t}</p><p className="text-xs text-muted">{d}</p></div>
          </li>
        ))}
      </ul>

      {categories.filter((c) => !c.parent_id).length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-xl font-bold tracking-tight">Categorias</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {categories.filter((c) => !c.parent_id).slice(0, 16).map((c) => (
              <Link key={c.id} href={`/categoria/${c.slug}`} className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface p-3 text-center text-xs font-medium hover:border-brand">
                <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-brand/10 text-lg font-bold text-brand">
                  {c.image_url ? <img src={c.image_url} alt="" className="h-full w-full object-cover" /> : c.name.charAt(0)}
                </span>
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {empty ? (
        <div className="mt-10">
          <EmptyState
            title="A loja ainda não tem produtos publicados"
            description={user?.isStaff ? "Cadastre ou importe produtos no painel e publique-os para que apareçam aqui." : "Volte em breve: estamos preparando o catálogo."}
            action={user?.isStaff ? <Link className="font-semibold text-brand underline" href="/admin/produtos">Ir para produtos</Link> : undefined}
          />
        </div>
      ) : (
        <>
          <ProductRail title="Ofertas" href="/ofertas" items={offers.items} />
          <ProductRail title="Destaques" href="/busca?destaque=1" items={featured.items} />
          <ProductRail title="Mais vendidos" href="/busca?ordem=bestsellers" items={best.items} />
        </>
      )}
    </div>
  );
}
