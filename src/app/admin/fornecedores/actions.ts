"use server";

import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/session";
import { runAdmin, str, optStr } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { saveSupplier, ISSUE_KINDS } from "@/lib/suppliers/admin";
import { syncSupplier } from "@/lib/suppliers/sync";
import { getSupplierAdapter } from "@/lib/integrations/suppliers/registry";
import type { IntegrationType } from "@/lib/types";

const back = (f: FormData) => `/admin/fornecedores/${str(f, "supplierId")}`;

export async function saveSupplierAction(f: FormData) {
  const id = optStr(f, "supplierId");
  return runAdmin(id ? `/admin/fornecedores/${id}` : "/admin/fornecedores/novo", async () => {
    const u = await assertPermission("suppliers.write");
    const r = await saveSupplier(id, {
      name: str(f, "name"), company_name: str(f, "company_name"), cnpj: str(f, "cnpj"), contact_name: str(f, "contact_name"), email: str(f, "email"),
      phone: str(f, "phone"), address: str(f, "address"), website: str(f, "website"), avg_processing_days: str(f, "avg_processing_days"),
      avg_delivery_days: str(f, "avg_delivery_days"), return_policy: str(f, "return_policy"), integration_type: str(f, "integration_type") || "manual",
      requires_manual_approval: f.get("requires_manual_approval") === "on", internal_rating: str(f, "internal_rating"), notes: str(f, "notes"),
      is_active: f.get("is_active") === "on",
      integration_config: { usd_brl_rate: str(f, "usd_brl_rate"), logistic_name: str(f, "logistic_name"), from_country_code: str(f, "from_country_code"), warehouse_country: str(f, "warehouse_country") },
    });
    await audit(u, id ? "supplier.update" : "supplier.create", "supplier", r.id, { after: { name: str(f, "name"), type: str(f, "integration_type"), manual: f.get("requires_manual_approval") === "on" } });
    if (!id) redirect(`/admin/fornecedores/${r.id}?ok=${encodeURIComponent("Fornecedor cadastrado.")}`);
    return r.deactivatedProducts ? `Fornecedor desativado. ${r.deactivatedProducts} produto(s) ativo(s) foram desativados na loja.` : "Fornecedor salvo.";
  });
}

export async function issueAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("suppliers.write");
    const kind = str(f, "kind");
    if (!(kind in ISSUE_KINDS)) throw new Error("Tipo de ocorrência inválido.");
    if (str(f, "description").length < 3) throw new Error("Descreva a ocorrência.");
    let orderId: string | null = null;
    if (str(f, "orderNumber")) {
      const [o] = await db()<{ id: string }[]>`select id from public.orders where number = ${Number(str(f, "orderNumber").replace(/\D/g, "")) || 0}`;
      if (!o) throw new Error("Pedido não encontrado.");
      orderId = o.id;
    }
    await db()`insert into public.supplier_issues (supplier_id, order_id, kind, description, created_by) values (${str(f, "supplierId")}, ${orderId}, ${kind}, ${str(f, "description").slice(0, 2000)}, ${u.id})`;
    await audit(u, "supplier.issue_create", "supplier", str(f, "supplierId"), { after: { kind } });
    return "Ocorrência registrada.";
  });
}

export async function resolveIssueAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("suppliers.write");
    await db()`update public.supplier_issues set status = 'resolved', resolved_at = now() where id = ${str(f, "issueId")} and supplier_id = ${str(f, "supplierId")}`;
    await audit(u, "supplier.issue_resolve", "supplier", str(f, "supplierId"));
    return "Ocorrência resolvida.";
  });
}

export async function syncSupplierAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("suppliers.write");
    // sincronização no painel: lote limitado (limite de requisições da API); o restante roda na fila
    const r = await syncSupplier(str(f, "supplierId"), u.id, { limit: 40 });
    await audit(u, "supplier.sync", "supplier", str(f, "supplierId"), { after: { status: r.status, ok: r.ok, failed: r.failed } });
    const msg = `Sincronização: ${r.ok} produto(s) ok, ${r.failed} falha(s), ${r.stockChanged} estoque(s) e ${r.costChanged} custo(s) alterados.`;
    if (r.status === "failed") throw new Error(`${msg} ${r.errors[0] ?? ""}`);
    return msg;
  });
}

export async function testSupplierAction(f: FormData) {
  return runAdmin(back(f), async () => {
    const u = await assertPermission("suppliers.write");
    const [s] = await db()<{ integration_type: IntegrationType }[]>`select integration_type from public.suppliers where id = ${str(f, "supplierId")}`;
    if (!s) throw new Error("Fornecedor não encontrado.");
    const adapter = getSupplierAdapter(s.integration_type);
    if (!adapter.ping) throw new Error("Este fornecedor opera de forma manual/CSV: não há conexão para testar.");
    const r = await adapter.ping();
    await db()`update public.suppliers set integration_status = ${r.ok ? "connected" : "error"} where id = ${str(f, "supplierId")}`;
    await db()`update public.integrations set status = ${r.ok ? "connected" : "error"}, last_check_at = now(), last_success_at = case when ${r.ok} then now() else last_success_at end where provider = ${s.integration_type}`;
    await audit(u, "supplier.test", "supplier", str(f, "supplierId"), { after: r });
    return r.message;
  });
}
