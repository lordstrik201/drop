import { z } from "zod";
import { db } from "@/lib/db/client";
import { isValidCNPJ, onlyDigits } from "@/lib/validation/br";

const textOpt = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable().optional());
const intOpt = (max: number) => z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).max(max).nullable());

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  company_name: textOpt(200),
  cnpj: z.preprocess((v) => (typeof v === "string" && v.trim() ? onlyDigits(v) : null), z.string().nullable().refine((v) => !v || isValidCNPJ(v), "CNPJ inválido")),
  contact_name: textOpt(120),
  email: z.preprocess((v) => (v === "" ? null : v), z.string().trim().toLowerCase().email("E-mail inválido").nullable()),
  phone: z.preprocess((v) => (typeof v === "string" && v.trim() ? onlyDigits(v) : null), z.string().max(13).nullable()),
  address: textOpt(300),
  website: z.preprocess((v) => (v === "" ? null : v), z.string().trim().regex(/^https:\/\/\S+$/, "Site deve começar com https://").max(300).nullable()),
  avg_processing_days: intOpt(120),
  avg_delivery_days: intOpt(180),
  return_policy: textOpt(4000),
  integration_type: z.enum(["manual", "csv", "cj", "dropi"]),
  requires_manual_approval: z.boolean(),
  internal_rating: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(5).nullable()),
  notes: textOpt(4000),
  is_active: z.boolean(),
  integration_config: z.object({
    usd_brl_rate: z.preprocess((v) => (v === "" || v == null ? undefined : Number(String(v).replace(",", "."))), z.number().positive().max(100).optional()),
    logistic_name: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(80).optional()),
    from_country_code: z.preprocess((v) => (v === "" ? undefined : String(v).toUpperCase()), z.string().regex(/^[A-Z]{2}$/, "País de origem: código de 2 letras").optional()),
    warehouse_country: z.preprocess((v) => (v === "" ? undefined : String(v).toUpperCase()), z.string().regex(/^[A-Z]{2}$/, "País do estoque: código de 2 letras").optional()),
  }).default({}),
});

export async function saveSupplier(id: string | null, raw: unknown) {
  const s = supplierSchema.parse(raw);
  const sql = db();
  const status = s.integration_type === "cj" ? "configured" : "not_configured";
  const values = { ...s, integration_config: sql.json(s.integration_config as never) };
  if (id) {
    const [r] = await sql<{ id: string }[]>`update public.suppliers set ${sql(values as never)} where id = ${id} returning id`;
    if (!r) throw new Error("Fornecedor não encontrado.");
    if (!s.is_active) {
      const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.products where supplier_id = ${id} and status = 'active'`;
      if (n.n > 0) await sql`update public.products set status = 'inactive' where supplier_id = ${id} and status = 'active'`;
      return { id, deactivatedProducts: n.n };
    }
    return { id, deactivatedProducts: 0 };
  }
  const [r] = await sql<{ id: string }[]>`insert into public.suppliers ${sql({ ...values, integration_status: status } as never)} returning id`;
  return { id: r.id, deactivatedProducts: 0 };
}

export const ISSUE_KINDS: Record<string, string> = {
  delay: "Atraso", wrong_item: "Item errado", damaged: "Avariado", out_of_stock: "Sem estoque", price_change: "Mudança de preço", communication: "Comunicação", other: "Outro",
};

/** Indicadores de desempenho do fornecedor (últimos 90 dias). */
export async function supplierStats(id: string) {
  const [r] = await db()<{ products: number; active: number; orders: number; failed: number; avg_submit_h: number | null; avg_ship_d: number | null; delayed: number; open_issues: number; cost_90d: number }[]>`
    select
      (select count(*)::int from public.products where supplier_id = ${id} and status <> 'archived') as products,
      (select count(*)::int from public.products where supplier_id = ${id} and status = 'active') as active,
      (select count(*)::int from public.supplier_orders where supplier_id = ${id} and created_at > now() - interval '90 days') as orders,
      (select count(*)::int from public.supplier_orders where supplier_id = ${id} and status = 'failed') as failed,
      (select round(avg(extract(epoch from submitted_at - created_at) / 3600)::numeric, 1)::float from public.supplier_orders where supplier_id = ${id} and submitted_at is not null and created_at > now() - interval '90 days') as avg_submit_h,
      (select round(avg(extract(epoch from sh.shipped_at - so.submitted_at) / 86400)::numeric, 1)::float
         from public.supplier_orders so join public.shipments sh on sh.supplier_order_id = so.id
        where so.supplier_id = ${id} and so.submitted_at is not null and sh.shipped_at is not null and so.created_at > now() - interval '90 days') as avg_ship_d,
      (select count(*)::int from public.supplier_orders so where so.supplier_id = ${id} and so.status in ('submitted','confirmed','processing')
         and so.submitted_at < now() - make_interval(days => coalesce((select (value->>'delay_alert_days')::int from public.settings where key = 'fulfillment'), 3))
         and not exists (select 1 from public.shipments sh where sh.supplier_order_id = so.id)) as delayed,
      (select count(*)::int from public.supplier_issues where supplier_id = ${id} and status = 'open') as open_issues,
      (select coalesce(-sum(amount_cents), 0)::int from public.financial_entries where supplier_id = ${id} and kind in ('product_cost','shipping_cost') and status = 'realized' and occurred_at > now() - interval '90 days') as cost_90d`;
  return r;
}

export const INTEGRATION_LABEL: Record<string, string> = { manual: "Manual", csv: "Planilha (CSV)", cj: "CJdropshipping (API)", dropi: "Dropi (manual/CSV)", api: "API" };
