import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Button, Input, Textarea } from "@/components/ui";
import { Flash } from "@/components/admin/ui";
import { savePageAction } from "../../actions";

export const metadata = { title: "Editar página" };

export default async function EditPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireStaffPage("settings.write");
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const isNew = slug === "nova";
  const [page] = isNew ? [] : await db()<{ slug: string; title: string; content: string; seo_description: string | null; is_published: boolean }[]>`select * from public.pages where slug = ${slug}`;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Link href="/admin/conteudo" className="text-sm text-muted hover:text-ink">← Páginas e banners</Link>
      <h1 className="text-2xl font-bold">{isNew ? "Nova página" : page ? page.title : "Página não encontrada"}</h1>
      <Flash msg={sp.ok} error={sp.erro} />
      {(isNew || page) && (
        <form action={savePageAction} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">Título<Input name="title" defaultValue={page?.title} required maxLength={120} /></label>
          {isNew
            ? <label className="flex flex-col gap-1 text-sm font-medium">Endereço (opcional)<Input name="slug" placeholder="gerado a partir do título" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} /></label>
            : <input type="hidden" name="slug" value={page!.slug} />}
          <label className="flex flex-col gap-1 text-sm font-medium">Descrição para buscadores<Input name="seo_description" defaultValue={page?.seo_description ?? ""} maxLength={170} /></label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Conteúdo
            <Textarea name="content" defaultValue={page?.content} rows={24} className="font-mono text-xs" />
            <span className="text-xs font-normal text-muted">Formatação: linha com “## ” vira título, “- ” vira lista, **negrito**. Variáveis preenchidas com os dados da empresa: {"{{loja}} {{razao_social}} {{cnpj}} {{email}} {{endereco}} {{telefone}}"}</span>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_published" defaultChecked={page?.is_published} /> Publicada (visível na loja)</label>
          <div className="flex gap-3"><Button size="sm">Salvar</Button>{page && <a href={`/institucional/${page.slug}`} target="_blank" rel="noreferrer" className="self-center text-sm text-brand underline">Ver na loja ↗</a>}</div>
        </form>
      )}
    </div>
  );
}
