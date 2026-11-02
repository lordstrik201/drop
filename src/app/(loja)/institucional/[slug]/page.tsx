import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/settings";
import { renderPageContent } from "@/lib/content/render";
import { Alert } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const [p] = await db()<{ title: string; content: string; seo_description: string | null; is_published: boolean; updated_at: Date }[]>`
    select title, content, seo_description, is_published, updated_at from public.pages where slug = ${slug}`;
  return p ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).slug);
  return p ? { title: p.title, description: p.seo_description ?? undefined } : {};
}

export default async function InstitutionalPage({ params }: Props) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const user = await getSessionUser();
  if (!p.is_published && !user?.isStaff) {
    return <div className="mx-auto max-w-3xl px-4 py-10"><h1 className="text-2xl font-bold">{p.title}</h1><p className="mt-4 text-muted">Conteúdo em elaboração. Em caso de dúvidas, entre em contato pelo nosso formulário.</p></div>;
  }
  const [identity, company] = await Promise.all([getSetting("store.identity"), getSetting("store.company")]);
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">{p.title}</h1>
      <p className="mt-1 text-xs text-muted">Atualizado em {p.updated_at.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
      {!p.is_published && <div className="mt-4"><Alert tone="warning">Pré-visualização: página não publicada (visível só para a equipe).</Alert></div>}
      <div className="prose-store mt-6 text-sm">{renderPageContent(p.content, { loja: identity.name, razao_social: company.legal_name, cnpj: company.cnpj, email: company.email, endereco: company.address, telefone: company.phone })}</div>
    </article>
  );
}
