import type { NextConfig } from "next";

/**
 * Decisão técnica (ver docs/DECISOES.md#cache-components):
 * cacheComponents fica desativado. Quase todas as páginas da loja e do painel
 * dependem de sessão, carrinho (cookie) e estoque em tempo real; renderização
 * dinâmica tradicional é mais previsível para um sistema transacional.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Imagens de fornecedores vêm de muitos domínios; servimos sem o otimizador
  // (evita proxy aberto e custo de otimização na hospedagem).
  images: { unoptimized: true },
  serverExternalPackages: ["postgres"],
  // Upload de imagens (até 4 MB) e CSV de importação pelo painel. A Vercel limita
  // o corpo da requisição de funções a 4,5 MB, então não adianta subir além disso.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
