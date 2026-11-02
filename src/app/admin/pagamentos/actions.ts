"use server";

import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { readSetting, saveSetting } from "@/lib/settings";
import { syncMercadoPagoPayment } from "@/lib/payments/service";
import { db } from "@/lib/db/client";

const BACK = "/admin/pagamentos";
const TYPE_RE = /^[a-z_]{2,40}$/;

export async function savePaymentSettingsAction(f: FormData) {
  return runAdmin(`${BACK}#config`, async () => {
    const u = await assertPermission("settings.write");
    const offered = f.getAll("offered").map(String).filter((t) => TYPE_RE.test(t));
    const enabled = new Set(f.getAll("enabled").map(String));
    const excluded = offered.filter((t) => !enabled.has(t) && t !== "account_money");
    if (offered.length && offered.filter((t) => enabled.has(t)).length === 0) throw new Error("Deixe pelo menos um meio de pagamento ativo.");
    const inst = Number(str(f, "max_installments"));
    if (!Number.isInteger(inst) || inst < 1 || inst > 36) throw new Error("Parcelas: escolha entre 1 e 36.");
    const before = await readSetting("payments");
    const value = { excluded_payment_types: offered.length ? excluded : before.excluded_payment_types, max_installments: inst };
    await saveSetting("payments", value, u.id);
    await audit(u, "settings.update", "settings", "payments", { before, after: value });
    return "Meios de pagamento salvos. Valem para os próximos checkouts.";
  });
}

/** Reconsulta no Mercado Pago os pagamentos pendentes recentes (caso algum webhook tenha falhado). */
export async function reconcileAction() {
  return runAdmin(BACK, async () => {
    const u = await assertPermission("orders.write");
    const rows = await db()<{ provider_payment_id: string }[]>`
      select provider_payment_id from public.payments
      where provider = 'mercadopago' and provider_payment_id is not null and status in ('pending','in_process','authorized')
        and created_at > now() - interval '15 days' order by created_at desc limit 30`;
    let changed = 0, failed = 0;
    for (const r of rows) {
      try { if ((await syncMercadoPagoPayment(r.provider_payment_id)).changed) changed++; } catch { failed++; }
    }
    await audit(u, "payments.reconcile", "payment", null, { after: { checked: rows.length, changed, failed } });
    if (failed && !changed) throw new Error(`Não foi possível consultar ${failed} pagamento(s). Veja Monitoramento → Logs.`);
    return `${rows.length} pagamento(s) pendente(s) consultado(s): ${changed} atualizado(s)${failed ? `, ${failed} com erro` : ""}.`;
  });
}
