import type { Metadata } from "next";
import { Catalog, type SearchParams } from "@/components/store/catalog";

export const metadata: Metadata = { title: "Ofertas e descontos", alternates: { canonical: "/ofertas" } };

export default async function OffersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Catalog path="/ofertas" sp={await searchParams} base={{ onSale: true, sort: "discount" }} title="Ofertas e descontos" />;
}
