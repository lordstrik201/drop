import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSetting } from "@/lib/settings";
import { Analytics } from "@/components/store/analytics";
import { readableTextOn } from "@/lib/ui/color";

// Loja transacional: estoque, preço e sessão mudam a cada requisição.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [identity, seo] = await Promise.all([getSetting("store.identity"), getSetting("store.seo")]);
  const title = seo.title || identity.name;
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: { default: title, template: `%s | ${identity.name}` },
    description: seo.description || identity.tagline || undefined,
    keywords: seo.keywords || undefined,
    icons: identity.favicon_url ? [{ url: identity.favicon_url }] : undefined,
    openGraph: { siteName: identity.name, locale: "pt_BR", type: "website" },
  };
}

export const viewport: Viewport = { themeColor: "#0f766e", width: "device-width", initialScale: 1 };

const HEX = /^#[0-9a-fA-F]{6}$/;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [identity, analytics] = await Promise.all([getSetting("store.identity"), getSetting("analytics")]);
  const brand = HEX.test(identity.primary_color) ? identity.primary_color : "#0f766e";
  const accent = HEX.test(identity.accent_color) ? identity.accent_color : "#f59e0b";
  return (
    <html lang="pt-BR">
      <body
        className="min-h-dvh flex flex-col antialiased"
        style={{ ["--brand" as string]: brand, ["--accent" as string]: accent, ["--brand-contrast" as string]: readableTextOn(brand) }}
      >
        {children}
        <Analytics ga4Id={analytics.ga4_id} gtmId={analytics.gtm_id} metaPixelId={analytics.meta_pixel_id} />
      </body>
    </html>
  );
}
