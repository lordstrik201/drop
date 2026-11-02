import { z } from "zod";
import { db } from "@/lib/db/client";

const dt = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Data inválida.").nullable().optional();
/** Datas do formulário são horário de Brasília. */
export const spDateTime = (v: string | null | undefined, endOfDay = false) =>
  v ? new Date(v.length === 10 ? `${v}T${endOfDay ? "23:59:59" : "00:00:00"}-03:00` : `${v}:00-03:00`) : null;

export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, "Código: 3 a 40 letras, números, - ou _."),
  description: z.string().trim().max(200).nullable().optional(),
  kind: z.enum(["percent", "fixed", "free_shipping"]),
  value: z.number().int().min(0),
  max_discount_cents: z.number().int().positive().nullable().optional(),
  min_subtotal_cents: z.number().int().min(0).default(0),
  max_uses: z.number().int().positive().nullable().optional(),
  max_uses_per_customer: z.number().int().positive().nullable().optional(),
  first_order_only: z.boolean().default(false),
  returning_customers_only: z.boolean().default(false),
  starts_at: dt,
  ends_at: dt,
  is_active: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.kind === "percent" && (v.value < 1 || v.value > 9000)) ctx.addIssue({ code: "custom", path: ["value"], message: "Percentual entre 0,01% e 90%." });
  if (v.kind === "fixed" && v.value < 1) ctx.addIssue({ code: "custom", path: ["value"], message: "Informe o valor do desconto." });
  if (v.first_order_only && v.returning_customers_only) ctx.addIssue({ code: "custom", path: ["first_order_only"], message: "Escolha só uma restrição de cliente." });
  if (v.starts_at && v.ends_at && spDateTime(v.ends_at, true)! <= spDateTime(v.starts_at)!) ctx.addIssue({ code: "custom", path: ["ends_at"], message: "O fim deve ser depois do início." });
});

export async function saveCoupon(id: string | null, raw: unknown) {
  const v = couponSchema.parse(raw);
  const row = {
    code: v.code, description: v.description ?? null, kind: v.kind, value: v.kind === "free_shipping" ? 0 : v.value,
    max_discount_cents: v.kind === "percent" ? (v.max_discount_cents ?? null) : null, min_subtotal_cents: v.min_subtotal_cents,
    max_uses: v.max_uses ?? null, max_uses_per_customer: v.max_uses_per_customer ?? null,
    first_order_only: v.first_order_only, returning_customers_only: v.returning_customers_only,
    starts_at: spDateTime(v.starts_at), ends_at: spDateTime(v.ends_at, true), is_active: v.is_active,
  };
  const sql = db();
  const [dup] = await sql<{ id: string }[]>`select id from public.coupons where code = ${v.code} and id is distinct from ${id}`;
  if (dup) throw new Error(`Já existe um cupom com o código ${v.code}.`);
  if (id) {
    const [r] = await sql<{ id: string }[]>`update public.coupons set ${sql(row)} where id = ${id} and origin = 'admin' returning id`;
    if (!r) throw new Error("Cupom não encontrado (cupons de fidelidade não são editáveis).");
    return r.id;
  }
  const [r] = await sql<{ id: string }[]>`insert into public.coupons ${sql(row)} returning id`;
  return r.id;
}

export async function setCouponActive(id: string, active: boolean) {
  const [r] = await db()<{ code: string }[]>`update public.coupons set is_active = ${active} where id = ${id} returning code`;
  if (!r) throw new Error("Cupom não encontrado.");
  return r.code;
}

export const campaignSchema = z.object({
  name: z.string().trim().min(2, "Dê um nome à campanha.").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  discount_bps: z.number().int().min(1, "Informe o desconto.").max(9000, "Desconto máximo de 90%."),
  scope: z.enum(["all", "category", "product"]),
  category_id: z.string().uuid().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  utm_campaign: z.string().trim().regex(/^[a-z0-9_-]{0,60}$/i, "UTM: letras, números, - ou _.").nullable().optional(),
  starts_at: dt,
  ends_at: dt,
  is_active: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.scope === "category" && !v.category_id) ctx.addIssue({ code: "custom", path: ["category_id"], message: "Escolha a categoria." });
  if (v.scope === "product" && !v.product_id) ctx.addIssue({ code: "custom", path: ["product_id"], message: "Escolha o produto." });
  if (v.starts_at && v.ends_at && spDateTime(v.ends_at, true)! <= spDateTime(v.starts_at)!) ctx.addIssue({ code: "custom", path: ["ends_at"], message: "O fim deve ser depois do início." });
});

/**
 * Campanha de desconto automático (aplicado no preço exibido e no checkout).
 * Escopo: loja toda, uma categoria ou um produto; vale a maior campanha ativa.
 */
export async function saveCampaign(id: string | null, raw: unknown) {
  const v = campaignSchema.parse(raw);
  const row = {
    name: v.name, description: v.description ?? null, discount_bps: v.discount_bps,
    category_id: v.scope === "category" ? v.category_id! : null, product_id: v.scope === "product" ? v.product_id! : null,
    utm_campaign: v.utm_campaign || null, starts_at: spDateTime(v.starts_at), ends_at: spDateTime(v.ends_at, true), is_active: v.is_active,
  };
  const sql = db();
  if (id) {
    const [r] = await sql<{ id: string }[]>`update public.campaigns set ${sql(row)} where id = ${id} returning id`;
    if (!r) throw new Error("Campanha não encontrada.");
    return r.id;
  }
  const [r] = await sql<{ id: string }[]>`insert into public.campaigns ${sql(row)} returning id`;
  return r.id;
}

export async function setCampaignActive(id: string, active: boolean) {
  const [r] = await db()<{ name: string }[]>`update public.campaigns set is_active = ${active} where id = ${id} returning name`;
  if (!r) throw new Error("Campanha não encontrada.");
  return r.name;
}

export async function deleteCampaign(id: string) {
  const [r] = await db()<{ name: string }[]>`delete from public.campaigns where id = ${id} returning name`;
  if (!r) throw new Error("Campanha não encontrada.");
  return r.name;
}
