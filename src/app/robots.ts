import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  // Fora de produção, nada é indexado (homologação não aparece no Google).
  if (process.env.APP_ENV !== "production") return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/conta", "/checkout", "/carrinho", "/api", "/rastreio/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
