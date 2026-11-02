"use server";

import { assertPermission } from "@/lib/auth/session";
import { optStr, runAdmin, str } from "@/lib/admin/action";
import { audit } from "@/lib/audit";
import { parseBRL } from "@/lib/money";
import { saveExpense, saveRevenue, setExpenseStatus, setRevenueStatus } from "@/lib/finance/admin";

const BACK = "/admin/financeiro?aba=contas";
const uuidOrNull = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export async function saveExpenseAction(f: FormData) {
  return runAdmin(`${BACK}#pagar`, async () => {
    const u = await assertPermission("finance.write");
    const id = uuidOrNull(optStr(f, "id"));
    const amount = parseBRL(str(f, "amount"));
    const newId = await saveExpense(id, {
      category: str(f, "category"), description: str(f, "description"), amount_cents: amount, due_date: str(f, "due_date"),
      supplier_id: uuidOrNull(optStr(f, "supplier_id")), notes: optStr(f, "notes"), paid: f.get("paid") === "on",
    }, u.id);
    await audit(u, id ? "expense.update" : "expense.create", "expense", newId, { after: { amount, category: str(f, "category") } });
    return id ? "Conta atualizada." : "Conta a pagar lançada.";
  });
}

export async function expenseStatusAction(f: FormData) {
  return runAdmin(`${BACK}#pagar`, async () => {
    const u = await assertPermission("finance.write");
    const id = uuidOrNull(str(f, "id"));
    const action = str(f, "action") as "pay" | "cancel" | "reopen";
    if (!id || !["pay", "cancel", "reopen"].includes(action)) throw new Error("Ação inválida.");
    await setExpenseStatus(id, action, optStr(f, "on"));
    await audit(u, `expense.${action}`, "expense", id);
    return action === "pay" ? "Pagamento registrado." : action === "cancel" ? "Conta cancelada." : "Conta reaberta; o lançamento anterior foi cancelado no razão.";
  });
}

export async function saveRevenueAction(f: FormData) {
  return runAdmin(`${BACK}#receber`, async () => {
    const u = await assertPermission("finance.write");
    const id = uuidOrNull(optStr(f, "id"));
    const amount = parseBRL(str(f, "amount"));
    const newId = await saveRevenue(id, {
      category: str(f, "category"), description: str(f, "description"), amount_cents: amount, expected_date: str(f, "expected_date"),
      notes: optStr(f, "notes"), received: f.get("received") === "on",
    }, u.id);
    await audit(u, id ? "revenue.update" : "revenue.create", "revenue", newId, { after: { amount, category: str(f, "category") } });
    return id ? "Valor atualizado." : "Conta a receber lançada.";
  });
}

export async function revenueStatusAction(f: FormData) {
  return runAdmin(`${BACK}#receber`, async () => {
    const u = await assertPermission("finance.write");
    const id = uuidOrNull(str(f, "id"));
    const action = str(f, "action") as "receive" | "cancel" | "reopen";
    if (!id || !["receive", "cancel", "reopen"].includes(action)) throw new Error("Ação inválida.");
    await setRevenueStatus(id, action, optStr(f, "on"));
    await audit(u, `revenue.${action}`, "revenue", id);
    return action === "receive" ? "Recebimento registrado." : action === "cancel" ? "Lançamento cancelado." : "Valor reaberto.";
  });
}
