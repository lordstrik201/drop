import type { Metadata } from "next";
import { Catalog, type SearchParams } from "@/components/store/catalog";

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const q = (await searchParams).q;
  return { title: q ? `Busca: ${String(q).slice(0, 60)}` : "Todos os produtos", robots: { index: !q } };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  return <Catalog path="/busca" sp={sp} title={q ? `Resultados para "${q}"` : "Todos os produtos"} />;
}
