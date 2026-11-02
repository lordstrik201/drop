import { requireStaffPage, can } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Badge, Button, inputClass } from "@/components/ui";
import { Flash, Section } from "@/components/admin/ui";
import { deleteCategoryAction, saveCategoryAction } from "./actions";

export const metadata = { title: "Categorias" };
type C = { id: string; parent_id: string | null; name: string; slug: string; description: string | null; image_url: string | null; seo_title: string | null; seo_description: string | null; position: number; is_active: boolean; products: number };

function CategoryForm({ c, all, disabled }: { c?: C; all: C[]; disabled: boolean }) {
  return (
    <form action={saveCategoryAction} className="grid gap-2 text-sm sm:grid-cols-4">
      {c && <input type="hidden" name="id" value={c.id} />}
      <input name="name" defaultValue={c?.name} placeholder="Nome" required maxLength={80} disabled={disabled} className={inputClass} />
      <input name="slug" defaultValue={c?.slug} placeholder="endereço (opcional)" maxLength={80} disabled={disabled} className={inputClass} />
      <select name="parent_id" defaultValue={c?.parent_id ?? ""} disabled={disabled} className={inputClass}>
        <option value="">Categoria principal</option>
        {all.filter((x) => x.id !== c?.id && !x.parent_id).map((x) => <option key={x.id} value={x.id}>Dentro de: {x.name}</option>)}
      </select>
      <input name="position" type="number" defaultValue={c?.position ?? 0} disabled={disabled} className={inputClass} title="Ordem" />
      <input name="image_url" defaultValue={c?.image_url ?? ""} placeholder="URL da imagem (https://)" disabled={disabled} className={`${inputClass} sm:col-span-2`} />
      <input name="seo_title" defaultValue={c?.seo_title ?? ""} placeholder="Título SEO" maxLength={70} disabled={disabled} className={inputClass} />
      <input name="seo_description" defaultValue={c?.seo_description ?? ""} placeholder="Descrição SEO" maxLength={170} disabled={disabled} className={inputClass} />
      <textarea name="description" defaultValue={c?.description ?? ""} placeholder="Descrição exibida na página da categoria" rows={2} maxLength={2000} disabled={disabled} className={`${inputClass} h-auto py-2 sm:col-span-4`} />
      <div className="flex items-center gap-3 sm:col-span-4">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={c?.is_active ?? true} disabled={disabled} /> Ativa</label>
        {!disabled && <Button size="sm" variant={c ? "secondary" : "primary"}>{c ? "Salvar" : "Criar categoria"}</Button>}
      </div>
    </form>
  );
}

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const user = await requireStaffPage("products.read");
  const sp = await searchParams;
  const [rows, canWrite, canDelete] = await Promise.all([
    db()<C[]>`select c.*, (select count(*)::int from public.products p where p.category_id = c.id and p.status <> 'archived') as products from public.categories c order by c.position, c.name`,
    can(user, "products.write"), can(user, "products.delete"),
  ]);
  const roots = rows.filter((c) => !c.parent_id || !rows.some((r) => r.id === c.parent_id));
  const childrenOf = (id: string) => rows.filter((c) => c.parent_id === id);
  const Item = ({ c, depth }: { c: C; depth: number }) => (
    <li className={depth ? "ml-6 border-l border-line pl-4" : ""}>
      <details className="rounded-lg border border-line bg-surface p-3">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
          <strong>{c.name}</strong><span className="text-xs text-muted">/categoria/{c.slug} · {c.products} produto(s)</span>
          {!c.is_active && <Badge>inativa</Badge>}
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <CategoryForm c={c} all={rows} disabled={!canWrite} />
          {canDelete && <form action={deleteCategoryAction}><input type="hidden" name="id" value={c.id} /><button className="text-xs text-danger underline">Excluir categoria</button></form>}
        </div>
      </details>
      {childrenOf(c.id).length > 0 && <ul className="mt-2 flex flex-col gap-2">{childrenOf(c.id).map((x) => <Item key={x.id} c={x} depth={depth + 1} />)}</ul>}
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Categorias</h1>
      <Flash msg={sp.ok} error={sp.erro} />
      {canWrite && <Section title="Nova categoria"><CategoryForm all={rows} disabled={false} /></Section>}
      {rows.length === 0 ? <p className="text-sm text-muted">Nenhuma categoria cadastrada.</p> : <ul className="flex flex-col gap-2">{roots.map((c) => <Item key={c.id} c={c} depth={0} />)}</ul>}
    </div>
  );
}
