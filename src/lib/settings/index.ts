import "server-only";
import { cache } from "react";
import { db, type DbOrTx } from "@/lib/db/client";

export type StoreIdentity = {
  name: string;
  tagline: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  accent_color: string;
};
export type StoreCompany = {
  legal_name: string; cnpj: string; state_registration: string;
  address: string; email: string; phone: string; whatsapp: string;
};
export type StoreSocial = { instagram: string; facebook: string; tiktok: string; youtube: string };
export type StoreSeo = { title: string; description: string; keywords: string };
export type AnalyticsSettings = { ga4_id: string; gtm_id: string; meta_pixel_id: string };
export type CheckoutSettings = { require_cpf: boolean; min_order_cents: number; pending_payment_expiration_hours: number };
export type FulfillmentSettings = { auto_forward_paid_orders: boolean; delay_alert_days: number };
export type ShippingSettings = { mode: "product" | "flat" | "melhorenvio"; flat_rate_cents: number; free_shipping_over_cents: number | null; origin_cep: string };
export type NotificationSettings = Record<
  "order_created" | "payment_approved" | "order_shipped" | "order_delivered" | "order_canceled" | "refund_completed",
  boolean
> & { staff_email: string };
export type MarketingSettings = { abandoned_cart_enabled: boolean; abandoned_cart_delay_hours: number };
export type PricingSettings = { estimated_fee_bps: number; estimated_fee_fixed_cents: number; default_target_margin_bps: number; min_margin_alert_bps: number };
export type LoyaltySettings = { enabled: boolean; points_per_real: number; cents_per_point: number };

export type SettingsMap = {
  "store.identity": StoreIdentity;
  "store.company": StoreCompany;
  "store.social": StoreSocial;
  "store.seo": StoreSeo;
  analytics: AnalyticsSettings;
  checkout: CheckoutSettings;
  fulfillment: FulfillmentSettings;
  shipping: ShippingSettings;
  notifications: NotificationSettings;
  marketing: MarketingSettings;
  loyalty: LoyaltySettings;
  pricing: PricingSettings;
};
export type SettingKey = keyof SettingsMap;

const loadAll = cache(async (): Promise<Partial<SettingsMap>> => {
  const rows = await db()<{ key: SettingKey; value: unknown }[]>`select key, value from public.settings`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<SettingsMap>;
});

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
  const all = await loadAll();
  const v = all[key];
  if (v === undefined) throw new Error(`Configuração ausente: ${key} (rode as migrations)`);
  return v as SettingsMap[K];
}

/** Leitura sem cache de requisição (para tarefas e transações). */
export async function readSetting<K extends SettingKey>(key: K, sql: DbOrTx = db()): Promise<SettingsMap[K]> {
  const [r] = await sql<{ value: SettingsMap[K] }[]>`select value from public.settings where key = ${key}`;
  if (!r) throw new Error(`Configuração ausente: ${key}`);
  return r.value;
}

export async function saveSetting<K extends SettingKey>(key: K, value: SettingsMap[K], actorId: string | null, sql: DbOrTx = db()) {
  await sql`update public.settings set value = ${sql.json(value as never)}, updated_by = ${actorId} where key = ${key}`;
}
