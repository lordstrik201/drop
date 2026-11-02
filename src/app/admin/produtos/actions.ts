"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str, optStr } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { readSetting } from "@/lib/settings";
import {
  addProductImage, bulkReprice, deleteOrArchiveProduct, deleteVariant, duplicateProduct, moveProductImage, parseOptions,
  saveProduct, saveVariant, setProductsStatus,
} from "@/lib/catalog/admin";
import { removeImage, uploadImage } from "@/lib/storage/media";
import type { ProductStatus } from "@/lib/types";

const back = (f: FormData) => `/admin/produtos/${str(f, "productId")}`;

function productFields(f: FormData) {
  const keys = ["name", "slug", "sku", "short_description", "description", "brand", "category_id", "supplier_id", "supplier_product_ref", "status",
    "cost_cents", "shipping_cost_cents", "price_cents", "compare_at_cents", "promo_price_cents", "promo_starts_at", "promo_ends_at", "target_margin_bps",
    "weight_grams", "length_cm", "width_cm", "height_cm", "lead_time_min_days", "lead_time_max_days", "seo_title", "seo_description"];
  const o: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, str(f, k)]));
  o.is_featured = f.get("is_featured") === "on";
  // datas da promoção são digitadas no horário de Brasília
  for (const k of ["promo_starts_at", "promo_ends_at"]) if (o[k]) o[k] = `${o[k]}:00-03:00`;
  if (!o.slug) delete o.slug;
  return o;
}

export async function saveProductAction(f: FormData) {
  const id = optStr(f, "productId");
  return runAdmin(id ? `/admin/produtos/${id}` : "/admin/produtos/novo", async () => {
    const u = await assertPermission("products.write");
    const before = id ? (await db()`select status, price_cents, cost_cents from public.products where id = ${id}`)[0] : null;
    const r = await saveProduct(id, productFields(f), u.id);
    await audit(u, id ? "product.update" : "product.create", "product", r.id, { before, after: { status: str(f, "status"), price: str(f, "price_cents"), cost: str(f, "cost_cents") } });
    revalidatePath(`/produto/${r.slug}`);
    if (!id) redirect(`/admin/produtos/${r.id}?ok=${encodeURIComponent("Produto criado como rascunho. Agora adicione imagens e estoque.")}`);
    return "Produto salvo.";
  });
}

export async function productImageAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("products.write");
    const productId = str(f, "productId");
    const file = f.get("file");
    const alt = optStr(f, "alt");
    if (file instanceof File && file.size > 0) {
      const up = await uploadImage(file, `produtos/${productId}`);
      await addProductImage(productId, { url: up.url, storagePath: up.path, alt });
    } else if (str(f, "url")) {
      await addProductImage(productId, { url: str(f, "url"), alt });
    } else throw new Error("Escolha um arquivo ou informe a URL da imagem.");
    await audit(u, "product.image_add", "product", productId);
    return "Imagem adicionada.";
  });
}

export async function imageOrderAction(f: FormData) {
  return runAdmin(back(f), async () => {
    await assertPermission("products.write");
    await moveProductImage(str(f, "productId"), str(f, "imageId"), str(f, "dir") === "up" ? -1 : 1);
    return "Ordem das imagens atualizada.";
  });
}

export async function deleteImageAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("products.write");
    const [img] = await db()<{ storage_path: string | null; status: ProductStatus; n: number }[]>`
      select i.storage_path, p.status, (select count(*)::int from public.product_images x where x.product_id = p.id) as n
      from public.product_images i join public.products p on p.id = i.product_id where i.id = ${str(f, "imageId")} and i.product_id = ${str(f, "productId")}`;
    if (!img) throw new Error("Imagem não encontrada.");
    if (img.status === "active" && img.n <= 1) throw new Error("Produto ativo precisa de pelo menos uma imagem.");
    await db()`delete from public.product_images where id = ${str(f, "imageId")}`;
    // só apaga do armazenamento se nenhuma cópia do produto usa o mesmo arquivo
    if (img.storage_path) {
      const [other] = await db()`select 1 from public.product_images where storage_path = ${img.storage_path} limit 1`;
      if (!other) await removeImage(img.storage_path);
    }
    await audit(u, "product.image_delete", "product", str(f, "productId"));
    return "Imagem removida.";
  });
}

export async function saveVariantAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("products.write");
    const productId = str(f, "productId");
    const variantId = optStr(f, "variantId");
    await saveVariant(productId, variantId, {
      sku: str(f, "sku"), title: str(f, "title") || "Padrão", options: parseOptions(str(f, "options")), supplier_variant_ref: str(f, "supplier_variant_ref"),
      cost_cents: str(f, "cost_cents"), shipping_cost_cents: str(f, "shipping_cost_cents"), price_cents: str(f, "price_cents"), promo_price_cents: str(f, "promo_price_cents"),
      stock_quantity: str(f, "stock_quantity"), image_url: str(f, "image_url"), position: str(f, "position"), is_active: f.get("is_active") === "on",
    }, "manual", u.id);
    await audit(u, variantId ? "variant.update" : "variant.create", "product", productId, { after: { sku: str(f, "sku"), stock: str(f, "stock_quantity") } });
    return variantId ? "Variação salva." : "Variação criada.";
  });
}

export async function deleteVariantAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("products.write");
    const r = await deleteVariant(str(f, "productId"), str(f, "variantId"));
    await audit(u, `variant.${r}`, "product", str(f, "productId"), { after: { variantId: str(f, "variantId") } });
    return r === "deleted" ? "Variação excluída." : "A variação já foi vendida: foi desativada (o histórico dos pedidos é mantido).";
  });
}

export async function duplicateProductAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("products.write");
    const id = await duplicateProduct(str(f, "productId"), u.id);
    await audit(u, "product.duplicate", "product", id, { after: { from: str(f, "productId") } });
    redirect(`/admin/produtos/${id}?ok=${encodeURIComponent("Cópia criada como rascunho (estoque zerado).")}`);
  });
}

export async function deleteProductAction(f: FormData) {
  return runAdmin("/admin/produtos", async () => {
    const u = await assertPermission("products.delete");
    const r = await deleteOrArchiveProduct(str(f, "productId"));
    await audit(u, `product.${r}`, "product", str(f, "productId"));
    return r === "deleted" ? "Produto excluído." : "Produto já vendido: foi arquivado (sai da loja, mas o histórico é mantido).";
  });
}

/** Ações em massa na lista de produtos. */
export async function bulkProductsAction(f: FormData) {
  const backUrl = str(f, "back").startsWith("/admin/produtos") ? str(f, "back") : "/admin/produtos";
  return runAdmin(backUrl, async () => {
    const u = await assertPermission("products.write");
    const ids = f.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!ids.length) throw new Error("Selecione pelo menos um produto.");
    const op = str(f, "op");
    let msg: string;
    if (["active", "inactive", "draft", "archived"].includes(op)) {
      const r = await setProductsStatus(ids, op as ProductStatus);
      msg = `${r.updated} produto(s) atualizado(s).` + (r.skipped.length ? ` Não ativados (sem imagem, preço, fornecedor ou variação): ${r.skipped.slice(0, 5).join(", ")}${r.skipped.length > 5 ? "…" : ""}` : "");
    } else if (op === "percent") {
      const pct = Number(str(f, "value").replace(",", "."));
      if (!Number.isFinite(pct) || pct <= -90 || pct > 500) throw new Error("Informe um percentual entre -90 e 500.");
      msg = `${await bulkReprice(ids, { kind: "percent", bps: Math.round(pct * 100) }, u.id)} preço(s) reajustado(s) em ${pct}%.`;
    } else if (op === "margin") {
      const m = Number(str(f, "value").replace(",", "."));
      if (!Number.isFinite(m) || m <= 0 || m >= 90) throw new Error("Informe uma margem entre 0 e 90%.");
      const pricing = await readSetting("pricing");
      msg = `${await bulkReprice(ids, { kind: "margin", marginBps: Math.round(m * 100), feeBps: pricing.estimated_fee_bps, feeFixed: pricing.estimated_fee_fixed_cents }, u.id)} preço(s) recalculado(s) para margem de ${m}%.`;
    } else if (op === "category") {
      const cat = optStr(f, "value");
      if (cat && !/^[0-9a-f-]{36}$/i.test(cat)) throw new Error("Categoria inválida.");
      await db()`update public.products set category_id = ${cat} where id = any(${ids}::uuid[])`;
      msg = "Categoria alterada.";
    } else throw new Error("Ação inválida.");
    await audit(u, `products.bulk_${op}`, "product", null, { after: { ids, value: str(f, "value") } });
    revalidatePath("/", "layout");
    return msg;
  });
}

export async function ackPriceAlertsAction(f: FormData) {
  return runAdmin(back(f), async () => {
    await assertPermission("products.write");
    await db()`update public.price_history set acknowledged_at = now() where product_id = ${str(f, "productId")} and acknowledged_at is null`;
    return "Alertas de preço marcados como vistos.";
  });
}
