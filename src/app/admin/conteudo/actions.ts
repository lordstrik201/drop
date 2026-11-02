"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str, optStr } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { slugify } from "@/lib/validation/br";

const httpsOrPath = (v: string | null, label: string) => {
  if (v && !/^(https:\/\/\S+|\/[\w\-/?=&%.#]*)$/.test(v)) throw new Error(`${label}: use https://… ou um caminho da loja começando com /`);
  return v;
};

export async function savePageAction(f: FormData) {
  const slug = str(f, "slug") || slugify(str(f, "title"));
  return runAdmin(`/admin/conteudo/paginas/${slug}`, async () => {
    const u = await assertPermission("settings.write");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("Endereço (slug) inválido: use letras minúsculas, números e hífens.");
    const title = str(f, "title");
    if (title.length < 2) throw new Error("Informe o título.");
    const content = str(f, "content");
    if (content.length > 100_000) throw new Error("Conteúdo muito longo.");
    const published = f.get("is_published") === "on";
    const [before] = await db()`select title, is_published from public.pages where slug = ${slug}`;
    await db()`insert into public.pages (slug, title, content, seo_description, is_published, updated_by)
               values (${slug}, ${title}, ${content}, ${optStr(f, "seo_description")}, ${published}, ${u.id})
               on conflict (slug) do update set title = excluded.title, content = excluded.content, seo_description = excluded.seo_description,
                 is_published = excluded.is_published, updated_by = excluded.updated_by, updated_at = now()`;
    await audit(u, before ? "page.update" : "page.create", "page", slug, { before, after: { title, is_published: published } });
    revalidatePath(`/institucional/${slug}`);
    return published ? "Página salva e publicada." : "Página salva como rascunho (não aparece na loja).";
  });
}

export async function saveBannerAction(f: FormData) {
  return runAdmin("/admin/conteudo", async () => {
    const u = await assertPermission("settings.write");
    const id = optStr(f, "id");
    const title = str(f, "title");
    if (title.length < 2) throw new Error("Informe o título do banner.");
    const placement = str(f, "placement") || "home_hero";
    if (!["home_hero", "home_strip", "category"].includes(placement)) throw new Error("Posição inválida.");
    const bg = optStr(f, "background_color");
    if (bg && !/^#[0-9a-fA-F]{6}$/.test(bg)) throw new Error("Cor de fundo inválida.");
    const startsAt = optStr(f, "starts_at"), endsAt = optStr(f, "ends_at");
    if (startsAt && endsAt && startsAt > endsAt) throw new Error("A data de término deve ser depois do início.");
    const v = {
      title, subtitle: optStr(f, "subtitle"), cta_label: optStr(f, "cta_label"),
      link_url: httpsOrPath(optStr(f, "link_url"), "Link"), image_url: httpsOrPath(optStr(f, "image_url"), "Imagem"),
      mobile_image_url: httpsOrPath(optStr(f, "mobile_image_url"), "Imagem para celular"), background_color: bg, placement,
      position: Number(str(f, "position")) || 0,
      starts_at: startsAt ? new Date(`${startsAt}T00:00:00-03:00`) : null, ends_at: endsAt ? new Date(`${endsAt}T23:59:59-03:00`) : null,
      is_active: f.get("is_active") === "on",
    };
    if (id) {
      const [r] = await db()`update public.banners set ${db()(v)} where id = ${id} returning id`;
      if (!r) throw new Error("Banner não encontrado.");
    } else {
      await db()`insert into public.banners ${db()(v)}`;
    }
    await audit(u, id ? "banner.update" : "banner.create", "banner", id, { after: v });
    revalidatePath("/");
    return "Banner salvo.";
  });
}

export async function deleteBannerAction(f: FormData) {
  return runAdmin("/admin/conteudo", async () => {
    const u = await assertPermission("settings.write");
    const [r] = await db()`delete from public.banners where id = ${str(f, "id")} returning title`;
    if (!r) throw new Error("Banner não encontrado.");
    await audit(u, "banner.delete", "banner", str(f, "id"), { before: r });
    revalidatePath("/");
    return "Banner excluído.";
  });
}
