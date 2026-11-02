import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";
import { db } from "@/lib/db/client";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [products, categories, pages] = await Promise.all([
    db()<{ slug: string; updated_at: Date }[]>`select slug, updated_at from public.products where status = 'active' order by updated_at desc limit 45000`,
    db()<{ slug: string; updated_at: Date }[]>`select slug, updated_at from public.categories where is_active`,
    db()<{ slug: string; updated_at: Date }[]>`select slug, updated_at from public.pages where is_published`,
  ]);
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/ofertas`, changeFrequency: "daily", priority: 0.8 },
    ...categories.map((c) => ({ url: `${base}/categoria/${c.slug}`, lastModified: c.updated_at, priority: 0.7 })),
    ...products.map((p) => ({ url: `${base}/produto/${p.slug}`, lastModified: p.updated_at, priority: 0.6 })),
    ...pages.map((p) => ({ url: `${base}/institucional/${p.slug}`, lastModified: p.updated_at, priority: 0.3 })),
  ];
}
