import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug, listReviews, relatedProducts } from "@/lib/catalog/queries";
import { ProductRail } from "@/components/store/product-card";
import { Gallery } from "@/components/store/gallery";
import { BuyBox } from "@/components/store/buy-box";
import { ReviewForm } from "@/components/store/review-form";
import { Stars } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProductBySlug((await params).slug);
  if (!p) return { title: "Produto não encontrado" };
  const description = p.seo_description || p.short_description || p.description?.slice(0, 160) || undefined;
  return {
    title: p.seo_title || p.name,
    description,
    alternates: { canonical: `/produto/${p.slug}` },
    openGraph: { title: p.name, description, images: p.images.slice(0, 1).map((i) => ({ url: i.url })), type: "website" },
  };
}

function paragraphs(text: string) {
  return text.split(/\n{2,}/).map((block, i) => (
    <p key={i}>{block.split("\n").map((line, j, arr) => <span key={j}>{line}{j < arr.length - 1 && <br />}</span>)}</p>
  ));
}

export default async function ProductPage({ params }: Props) {
  const p = await getProductBySlug((await params).slug);
  if (!p) notFound();
  const [reviews, related, user, identity] = await Promise.all([listReviews(p.id), relatedProducts(p.id), getSessionUser(), getSetting("store.identity")]);
  const inStock = p.variants.some((v) => v.stock > 0);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku,
    image: p.images.map((i) => i.url),
    description: p.short_description ?? p.description ?? undefined,
    brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
    aggregateRating: p.rating_count ? { "@type": "AggregateRating", ratingValue: p.rating_avg, reviewCount: p.rating_count } : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: (p.pricing.price / 100).toFixed(2),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: identity.name },
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Navegação estrutural" className="mb-4 text-xs text-muted">
        <ol className="flex flex-wrap gap-1">
          <li><Link href="/" className="hover:underline">Início</Link> /</li>
          {p.category && <li><Link href={`/categoria/${p.category.slug}`} className="hover:underline">{p.category.name}</Link> /</li>}
          <li aria-current="page" className="text-ink">{p.name}</li>
        </ol>
      </nav>
      <div className="grid gap-8 rounded-2xl border border-line bg-surface p-4 sm:p-6 lg:grid-cols-[1.1fr_1fr]">
        <Gallery images={p.images} name={p.name} />
        <div>
          {p.brand && <p className="text-xs uppercase tracking-wide text-muted">{p.brand}</p>}
          <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{p.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
            {p.rating_count > 0 ? <a href="#avaliacoes"><Stars value={p.rating_avg} count={p.rating_count} /></a> : <span>Sem avaliações ainda</span>}
            {p.sold_count > 0 && <span>{p.sold_count} vendidos</span>}
            <span>SKU {p.sku}</span>
          </div>
          {p.short_description && <p className="mt-4 text-sm leading-relaxed text-ink/80">{p.short_description}</p>}
          <BuyBox
            productId={p.id}
            variants={p.variants}
            optionNames={p.optionNames}
            leadTime={{ min: p.lead_time_min_days, max: p.lead_time_max_days, processing: p.supplier_processing_days }}
          />
        </div>
      </div>

      {p.description && (
        <section className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-xl font-bold">Descrição</h2>
          <div className="prose-store mt-2 text-sm text-ink/90">{paragraphs(p.description)}</div>
        </section>
      )}

      <section id="avaliacoes" className="mt-8 rounded-2xl border border-line bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Avaliações de clientes</h2>
          {p.rating_count > 0 && <div className="flex items-center gap-2"><span className="text-2xl font-bold">{p.rating_avg.toFixed(1)}</span><Stars value={p.rating_avg} count={p.rating_count} /></div>}
        </div>
        {reviews.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Este produto ainda não tem avaliações publicadas.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {reviews.map((r) => (
              <li key={r.id} className="py-4">
                <div className="flex items-center gap-2"><Stars value={r.rating} /><span className="text-sm font-semibold">{r.title}</span></div>
                {r.body && <p className="mt-1 text-sm text-ink/90">{r.body}</p>}
                <p className="mt-1 text-xs text-muted">
                  {r.author_name} · {r.created_at.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  {r.verified_purchase && " · Compra verificada"}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 border-t border-line pt-4">
          {user ? <ReviewForm productId={p.id} /> : <p className="text-sm text-muted"><Link href={`/entrar?next=/produto/${p.slug}`} className="font-semibold text-brand underline">Entre na sua conta</Link> para avaliar produtos que você recebeu.</p>}
        </div>
      </section>

      <ProductRail title="Produtos relacionados" items={related} />
    </div>
  );
}
