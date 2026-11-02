import Link from "next/link";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import type { ProductCard as Card } from "@/lib/catalog/queries";
import { Badge, Price, Stars } from "@/components/ui";

export function ProductCard({ p }: { p: Card }) {
  return (
    <Link href={`/produto/${p.slug}`} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-square bg-white">
        {p.image ? (
          <Image src={p.image} alt={p.name} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw" className="object-contain p-3 transition group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted"><ImageOff aria-hidden /><span className="sr-only">Sem imagem</span></div>
        )}
        {p.pricing.discountPercent ? <Badge tone="danger" className="absolute left-2 top-2">-{p.pricing.discountPercent}%</Badge> : null}
        {!p.in_stock && <Badge className="absolute right-2 top-2">Esgotado</Badge>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {p.brand && <span className="text-[11px] uppercase tracking-wide text-muted">{p.brand}</span>}
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink">{p.name}</h3>
        {p.rating_count > 0 && <Stars value={p.rating_avg} count={p.rating_count} size={12} />}
        <div className="mt-auto pt-1"><Price price={p.pricing.price} original={p.pricing.original} /></div>
      </div>
    </Link>
  );
}

export function ProductGrid({ items }: { items: Card[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((p) => <ProductCard key={p.id} p={p} />)}
    </div>
  );
}

export function ProductRail({ title, href, items }: { title: string; href?: string; items: Card[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {href && <Link href={href} className="text-sm font-semibold text-brand hover:underline">Ver todos</Link>}
      </div>
      <ProductGrid items={items} />
    </section>
  );
}
