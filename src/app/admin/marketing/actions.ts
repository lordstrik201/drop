"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { optStr, runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { parseBRL } from "@/lib/money";
import { deleteCampaign, saveCampaign, saveCoupon, setCampaignActive, setCouponActive } from "@/lib/marketing/admin";

const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const intOrNull = (v: string | null) => (v ? Number(v) : null);
/** "12,5" → 1250 bps */
const percentBps = (v: string) => {
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) throw new Error("Percentual inválido.");
  return Math.round(n * 100);
};

export async function saveCouponAction(f: FormData) {
  return runAdmin("/admin/marketing?aba=cupons", async () => {
    const u = await assertPermission("marketing.write");
    const id = uuid(optStr(f, "id"));
    const kind = str(f, "kind");
    const value = kind === "percent" ? percentBps(str(f, "value")) : kind === "fixed" ? parseBRL(str(f, "value")) : 0;
    const raw = {
      code: str(f, "code"), description: optStr(f, "description"), kind, value,
      max_discount_cents: optStr(f, "max_discount") ? parseBRL(str(f, "max_discount")) : null,
      min_subtotal_cents: parseBRL(str(f, "min_subtotal")),
      max_uses: intOrNull(optStr(f, "max_uses")), max_uses_per_customer: intOrNull(optStr(f, "max_uses_per_customer")),
      first_order_only: str(f, "audience") === "first", returning_customers_only: str(f, "audience") === "returning",
      starts_at: optStr(f, "starts_at"), ends_at: optStr(f, "ends_at"), is_active: f.get("is_active") === "on",
    };
    const saved = await saveCoupon(id, raw);
    await audit(u, id ? "coupon.update" : "coupon.create", "coupon", saved, { after: raw });
    revalidatePath("/carrinho");
    return id ? `Cupom ${raw.code.toUpperCase()} atualizado.` : `Cupom ${raw.code.toUpperCase()} criado.`;
  });
}

export async function toggleCouponAction(f: FormData) {
  return runAdmin("/admin/marketing?aba=cupons", async () => {
    const u = await assertPermission("marketing.write");
    const id = uuid(str(f, "id"));
    if (!id) throw new Error("Cupom inválido.");
    const active = str(f, "active") === "1";
    const code = await setCouponActive(id, active);
    await audit(u, active ? "coupon.activate" : "coupon.deactivate", "coupon", id);
    return `Cupom ${code} ${active ? "ativado" : "desativado"}.`;
  });
}

export async function saveCampaignAction(f: FormData) {
  return runAdmin("/admin/marketing?aba=campanhas", async () => {
    const u = await assertPermission("marketing.write");
    const id = uuid(optStr(f, "id"));
    const raw = {
      name: str(f, "name"), description: optStr(f, "description"), discount_bps: percentBps(str(f, "discount")),
      scope: str(f, "scope"), category_id: uuid(optStr(f, "category_id")), product_id: uuid(optStr(f, "product_id")),
      utm_campaign: optStr(f, "utm_campaign"), starts_at: optStr(f, "starts_at"), ends_at: optStr(f, "ends_at"), is_active: f.get("is_active") === "on",
    };
    const saved = await saveCampaign(id, raw);
    await audit(u, id ? "campaign.update" : "campaign.create", "campaign", saved, { after: raw });
    revalidatePath("/", "layout");
    return id ? "Campanha atualizada." : "Campanha criada.";
  });
}

export async function campaignStatusAction(f: FormData) {
  return runAdmin("/admin/marketing?aba=campanhas", async () => {
    const u = await assertPermission("marketing.write");
    const id = uuid(str(f, "id"));
    if (!id) throw new Error("Campanha inválida.");
    const op = str(f, "op");
    if (op === "delete") {
      const name = await deleteCampaign(id);
      await audit(u, "campaign.delete", "campaign", id, { before: { name } });
      revalidatePath("/", "layout");
      return `Campanha ${name} excluída.`;
    }
    const active = op === "activate";
    const name = await setCampaignActive(id, active);
    await audit(u, active ? "campaign.activate" : "campaign.deactivate", "campaign", id);
    revalidatePath("/", "layout");
    return `Campanha ${name} ${active ? "ativada" : "pausada"}.`;
  });
}
