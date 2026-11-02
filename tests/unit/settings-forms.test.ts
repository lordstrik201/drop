import { describe, it, expect } from "vitest";
import { SETTING_FORMS, parseSettingForm } from "@/lib/settings/forms";

const form = (k: string) => SETTING_FORMS.find((f) => f.key === k)!;
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe("formulários de configuração", () => {
  it("frete: converte reais em centavos e valida CEP", () => {
    const v = parseSettingForm(form("shipping"), fd({ mode: "flat", flat_rate_cents: "19,90", free_shipping_over_cents: "", origin_cep: "01310-100" }), {});
    expect(v).toEqual({ mode: "flat", flat_rate_cents: 1990, free_shipping_over_cents: null, origin_cep: "01310100" });
    expect(() => parseSettingForm(form("shipping"), fd({ mode: "melhorenvio", origin_cep: "" }), {})).toThrow(/CEP de origem/);
    expect(() => parseSettingForm(form("shipping"), fd({ mode: "x" }), {})).toThrow(/opção inválida/);
  });
  it("checkbox desmarcado vira false; intervalos validados", () => {
    const v = parseSettingForm(form("fulfillment"), fd({ delay_alert_days: "5", stale_tracking_days: "7", tracking_refresh_hours: "12" }), { auto_forward_paid_orders: true });
    expect(v.auto_forward_paid_orders).toBe(false);
    expect(() => parseSettingForm(form("fulfillment"), fd({ delay_alert_days: "0" }), {})).toThrow();
  });
  it("rejeita IDs de rastreamento, cores e CNPJ inválidos", () => {
    expect(() => parseSettingForm(form("analytics"), fd({ ga4_id: "UA-123" }), {})).toThrow(/GA4/);
    expect(() => parseSettingForm(form("store.identity"), fd({ name: "Loja", primary_color: "red", accent_color: "#000000" }), {})).toThrow(/cor/);
    expect(() => parseSettingForm(form("store.company"), fd({ cnpj: "11.111.111/1111-11" }), {})).toThrow(/CNPJ/);
  });
  it("só aceita URLs https", () => {
    expect(() => parseSettingForm(form("store.social"), fd({ instagram: "javascript:alert(1)" }), {})).toThrow(/https/);
  });
});
