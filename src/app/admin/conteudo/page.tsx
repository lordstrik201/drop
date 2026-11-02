import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Badge, Button, Input, Select } from "@/components/ui";
import { Flash, Section } from "@/components/admin/ui";
import { formatDateTime, nowMs } from "@/lib/ui/dates";
import { deleteBannerAction, saveBannerAction } from "./actions";

export const metadata = { title: "Páginas e banners" };

type Banner = { id: string; title: string; subtitle: string | null; cta_label: string | null; link_url: string | null; image_url: string | null; mobile_image_url: string | null; background_color: string | null; placement: string; position: number; starts_at: Date | null; ends_at: Date | null; is_active: boolean };
const PLACEMENT: Record<string, string> = { home_hero: "Carrossel da página inicial", home_strip: "Faixa da página inicial", category: "Páginas de categoria" };
const dateStr = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d) : "");

function BannerForm({ b }: { b?: Banner }) {
  return (
    <form action={saveBannerAction} className="grid gap-2 sm:grid-cols-2">
      {b && <input type="hidden" name="id" value={b.id} />}
      <Input name="title" defaultValue={b?.title} placeholder="Título" required maxLength={120} />
      <Input name="subtitle" defaultValue={b?.subtitle ?? ""} placeholder="Subtítulo" maxLength={200} />
      <Input name="cta_label" defaultValue={b?.cta_label ?? ""} placeholder="Texto do botão (ex.: Ver ofertas)" maxLength={40} />
      <Input name="link_url" defaultValue={b?.link_url ?? ""} placeholder="Link (/ofertas ou https://…)" maxLength={500} />
      <Input name="image_url" defaultValue={b?.image_url ?? ""} placeholder="URL da imagem (1600×600)" maxLength={500} />
      <Input name="mobile_image_url" defaultValue={b?.mobile_image_url ?? ""} placeholder="URL da imagem para celular (800×800)" maxLength={500} />
      <Select name="placement" defaultValue={b?.placement ?? "home_hero"}>{Object.entries(PLACEMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      <label className="flex items-center gap-2 text-xs text-muted">Cor de fundo <input type="color" name="background_color" defaultValue={b?.background_color ?? "#0F766E"} className="h-9 w-16 rounded border border-line" /> Ordem <Input name="position" type="number" defaultValue={b?.position ?? 0} className="w-20" /></label>
      <label className="flex flex-col gap-1 text-xs text-muted">Início (opcional)<Input name="starts_at" type="date" defaultValue={dateStr(b?.starts_at ?? null)} /></label>
      <label className="flex flex-col gap-1 text-xs text-muted">Término (opcional)<Input name="ends_at" type="date" defaultValue={dateStr(b?.ends_at ?? null)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={b?.is_active ?? true} /> Ativo</label>
      <div><Button size="sm">{b ? "Salvar banner" : "Criar banner"}</Button></div>
    </form>
  );
}

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireStaffPage("settings.write");
  const sp = await searchParams;
  const sql = db();
  const [pages, banners] = await Promise.all([
    sql<{ slug: string; title: string; is_published: boolean; updated_at: Date }[]>`select slug, title, is_published, updated_at from public.pages order by title`,
    sql<Banner[]>`select * from public.banners order by placement, position, created_at`,
  ]);
  const now = nowMs();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Páginas e banners</h1>
      <Flash msg={sp.ok} error={sp.erro} />
      <Section title="Páginas institucionais" actions={<Link href="/admin/conteudo/paginas/nova" className="text-sm text-brand underline">Nova página</Link>}>
        <p className="mb-3 text-xs text-muted">Os modelos de Privacidade, Termos e Trocas vêm como rascunho: revise com seu jurídico, preencha os dados da empresa em Configurações e publique.</p>
        <ul className="divide-y divide-line text-sm">
          {pages.map((p) => (
            <li key={p.slug} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><Link href={`/admin/conteudo/paginas/${p.slug}`} className="font-medium text-brand hover:underline">{p.title}</Link> <span className="text-xs text-muted">/institucional/{p.slug} · editado {formatDateTime(p.updated_at)}</span></span>
              <Badge tone={p.is_published ? "success" : "warning"}>{p.is_published ? "Publicada" : "Rascunho"}</Badge>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Banners">
        <ul className="flex flex-col gap-4">
          {banners.map((b) => {
            const live = b.is_active && (!b.starts_at || +b.starts_at <= now) && (!b.ends_at || +b.ends_at >= now);
            return (
              <li key={b.id} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {b.image_url ? <img src={b.image_url} alt="" className="h-10 w-24 rounded object-cover" /> : <span className="h-10 w-24 rounded" style={{ background: b.background_color ?? "var(--brand)" }} />}
                    <span><strong>{b.title}</strong><span className="block text-xs text-muted">{PLACEMENT[b.placement]} · ordem {b.position}</span></span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={live ? "success" : "neutral"}>{live ? "No ar" : b.is_active ? "Agendado/expirado" : "Inativo"}</Badge>
                    <form action={deleteBannerAction}><input type="hidden" name="id" value={b.id} /><Button size="sm" variant="ghost">Excluir</Button></form>
                  </span>
                </div>
                <details><summary className="cursor-pointer text-sm text-brand">Editar</summary><div className="mt-2"><BannerForm b={b} /></div></details>
              </li>
            );
          })}
        </ul>
        <h3 className="mb-2 mt-6 text-sm font-semibold">Novo banner</h3>
        <BannerForm />
      </Section>
    </div>
  );
}
