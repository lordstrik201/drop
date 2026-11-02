"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str, optStr } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { deleteCategory, saveCategory } from "@/lib/catalog/admin";

export async function saveCategoryAction(f: FormData) {
  return runAdmin("/admin/categorias", async () => {
    const u = await assertPermission("products.write");
    const id = optStr(f, "id");
    const saved = await saveCategory(id, {
      name: str(f, "name"), slug: str(f, "slug") || undefined, parent_id: str(f, "parent_id"), description: str(f, "description"),
      image_url: str(f, "image_url"), seo_title: str(f, "seo_title"), seo_description: str(f, "seo_description"), position: str(f, "position"),
      is_active: f.get("is_active") === "on",
    });
    await audit(u, id ? "category.update" : "category.create", "category", saved, { after: { name: str(f, "name") } });
    revalidatePath("/", "layout");
    return "Categoria salva.";
  });
}

export async function deleteCategoryAction(f: FormData) {
  return runAdmin("/admin/categorias", async () => {
    const u = await assertPermission("products.delete");
    await deleteCategory(str(f, "id"));
    await audit(u, "category.delete", "category", str(f, "id"));
    revalidatePath("/", "layout");
    return "Categoria excluída.";
  });
}
