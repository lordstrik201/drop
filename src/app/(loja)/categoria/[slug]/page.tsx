import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Catalog, type SearchParams } from "@/components/store/catalog";
import { getCategory } from "@/lib/catalog/queries";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await getCategory((await params).slug);
  if (!c) return {};
  return { title: c.seo_title || c.name, description: c.seo_description || c.description || undefined, alternates: { canonical: `/categoria/${c.slug}` } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const c = await getCategory((await params).slug);
  if (!c) notFound();
  return <Catalog path={`/categoria/${c.slug}`} sp={await searchParams} base={{ categorySlug: c.slug }} title={c.name} description={c.description} />;
}
