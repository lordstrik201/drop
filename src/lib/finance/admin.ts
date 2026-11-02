import { z } from "zod";
import { db, type Tx } from "@/lib/db/client";
import { postLedger } from "@/lib/finance/ledger";

export const EXPENSE_CATEGORIES = ["fornecedor", "frete", "marketing", "software", "impostos", "taxas", "pessoal", "estrutura", "outros"] as const;
export const REVENUE_CATEGORIES = ["venda_externa", "reembolso_fornecedor", "rendimento", "outros"] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  fornecedor: "Fornecedor", frete: "Frete", marketing: "Marketing e anúncios", software: "Sistemas e assinaturas", impostos: "Impostos",
  taxas: "Taxas bancárias", pessoal: "Pessoal", estrutura: "Estrutura", outros: "Outros",
  venda_externa: "Venda fora do site", reembolso_fornecedor: "Reembolso de fornecedor", rendimento: "Rendimentos",
};

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const base = {
  description: z.string().trim().min(2, "Descreva o lançamento.").max(200),
  amount_cents: z.number().int().positive("Informe um valor maior que zero.").max(1_000_000_000),
  notes: z.string().trim().max(1000).nullable().optional(),
  order_id: z.string().uuid().nullable().optional(),
};
export const expenseSchema = z.object({
  ...base,
  category: z.enum(EXPENSE_CATEGORIES),
  due_date: iso,
  supplier_id: z.string().uuid().nullable().optional(),
  paid: z.boolean().default(false),
});
export const revenueSchema = z.object({
  ...base,
  category: z.enum(REVENUE_CATEGORIES),
  expected_date: iso,
  received: z.boolean().default(false),
});

const spDate = (d: string) => new Date(`${d}T12:00:00-03:00`);

/** Conta a pagar. Quando paga, vira saída realizada no razão (uma única vez). */
export async function saveExpense(id: string | null, raw: unknown, actorId: string | null) {
  const v = expenseSchema.parse(raw);
  return db().begin(async (tx: Tx) => {
    let rowId = id;
    if (id) {
      const [cur] = await tx<{ status: string }[]>`select status from public.expenses where id = ${id} for update`;
      if (!cur) throw new Error("Conta não encontrada.");
      if (cur.status !== "open") throw new Error("Só é possível editar contas em aberto.");
      await tx`update public.expenses set category = ${v.category}, description = ${v.description}, amount_cents = ${v.amount_cents},
                 supplier_id = ${v.supplier_id ?? null}, order_id = ${v.order_id ?? null}, due_date = ${v.due_date}, notes = ${v.notes ?? null}
               where id = ${id}`;
    } else {
      const [r] = await tx<{ id: string }[]>`
        insert into public.expenses (category, description, amount_cents, supplier_id, order_id, due_date, notes, created_by)
        values (${v.category}, ${v.description}, ${v.amount_cents}, ${v.supplier_id ?? null}, ${v.order_id ?? null}, ${v.due_date}, ${v.notes ?? null}, ${actorId})
        returning id`;
      rowId = r.id;
    }
    if (v.paid) await settleExpense(tx, rowId!, new Date());
    return rowId!;
  });
}

async function settleExpense(tx: Tx, id: string, paidAt: Date) {
  const [e] = await tx<{ status: string; amount_cents: number; description: string; supplier_id: string | null; order_id: string | null; category: string }[]>`
    update public.expenses set status = 'paid', paid_at = ${paidAt} where id = ${id} and status = 'open'
    returning status, amount_cents, description, supplier_id, order_id, category`;
  if (!e) throw new Error("Conta já paga ou cancelada.");
  await postLedger(tx, { kind: "other_expense", amount: e.amount_cents, supplierId: e.supplier_id, orderId: e.order_id,
    description: `${CATEGORY_LABEL[e.category] ?? e.category}: ${e.description}`, dedupeKey: `expense:${id}:${paidAt.getTime()}`, occurredAt: paidAt });
}

export async function setExpenseStatus(id: string, action: "pay" | "cancel" | "reopen", paidOn?: string | null) {
  return db().begin(async (tx: Tx) => {
    const [cur] = await tx<{ status: string }[]>`select status from public.expenses where id = ${id} for update`;
    if (!cur) throw new Error("Conta não encontrada.");
    if (action === "pay") return settleExpense(tx, id, paidOn ? spDate(paidOn) : new Date());
    if (action === "cancel") {
      if (cur.status !== "open") throw new Error("Só contas em aberto podem ser canceladas. Para desfazer um pagamento, reabra a conta.");
      await tx`update public.expenses set status = 'canceled' where id = ${id}`;
      return;
    }
    if (cur.status === "open") throw new Error("A conta já está em aberto.");
    // reabrir: o lançamento realizado é marcado como cancelado (o histórico fica no razão)
    await tx`update public.expenses set status = 'open', paid_at = null where id = ${id}`;
    await tx`update public.financial_entries set status = 'canceled' where dedupe_key like ${`expense:${id}:%`} and status = 'realized'`;
  });
}

/** Conta a receber fora do gateway. Quando recebida, vira entrada realizada. */
export async function saveRevenue(id: string | null, raw: unknown, actorId: string | null) {
  const v = revenueSchema.parse(raw);
  return db().begin(async (tx: Tx) => {
    let rowId = id;
    if (id) {
      const [cur] = await tx<{ status: string }[]>`select status from public.revenues where id = ${id} for update`;
      if (!cur) throw new Error("Lançamento não encontrado.");
      if (cur.status !== "open") throw new Error("Só é possível editar valores em aberto.");
      await tx`update public.revenues set category = ${v.category}, description = ${v.description}, amount_cents = ${v.amount_cents},
                 order_id = ${v.order_id ?? null}, expected_date = ${v.expected_date}, notes = ${v.notes ?? null} where id = ${id}`;
    } else {
      const [r] = await tx<{ id: string }[]>`
        insert into public.revenues (category, description, amount_cents, order_id, expected_date, notes, created_by)
        values (${v.category}, ${v.description}, ${v.amount_cents}, ${v.order_id ?? null}, ${v.expected_date}, ${v.notes ?? null}, ${actorId})
        returning id`;
      rowId = r.id;
    }
    if (v.received) await settleRevenue(tx, rowId!, new Date());
    return rowId!;
  });
}

async function settleRevenue(tx: Tx, id: string, at: Date) {
  const [r] = await tx<{ amount_cents: number; description: string; order_id: string | null; category: string }[]>`
    update public.revenues set status = 'received', received_at = ${at} where id = ${id} and status = 'open'
    returning amount_cents, description, order_id, category`;
  if (!r) throw new Error("Valor já recebido ou cancelado.");
  await postLedger(tx, { kind: "other_income", amount: r.amount_cents, orderId: r.order_id,
    description: `${CATEGORY_LABEL[r.category] ?? r.category}: ${r.description}`, dedupeKey: `revenue:${id}:${at.getTime()}`, occurredAt: at });
}

export async function setRevenueStatus(id: string, action: "receive" | "cancel" | "reopen", on?: string | null) {
  return db().begin(async (tx: Tx) => {
    const [cur] = await tx<{ status: string }[]>`select status from public.revenues where id = ${id} for update`;
    if (!cur) throw new Error("Lançamento não encontrado.");
    if (action === "receive") return settleRevenue(tx, id, on ? spDate(on) : new Date());
    if (action === "cancel") {
      if (cur.status !== "open") throw new Error("Só valores em aberto podem ser cancelados.");
      await tx`update public.revenues set status = 'canceled' where id = ${id}`;
      return;
    }
    if (cur.status === "open") throw new Error("O valor já está em aberto.");
    await tx`update public.revenues set status = 'open', received_at = null where id = ${id}`;
    await tx`update public.financial_entries set status = 'canceled' where dedupe_key like ${`revenue:${id}:%`} and status = 'realized'`;
  });
}
