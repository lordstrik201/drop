import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db, type Tx } from "@/lib/db/client";
import { addToCart } from "@/lib/cart/cart";
import { createOrderFromCart } from "@/lib/orders/create";
import { postSaleEntries, realizeSupplierCosts } from "@/lib/finance/ledger";
import { saveExpense, saveRevenue, setExpenseStatus, setRevenueStatus } from "@/lib/finance/admin";
import { cashFlow, financeDre, profitBy } from "@/lib/finance/summary";
import { REPORTS } from "@/lib/reports/exports";
import { toCSV } from "@/lib/reports/csv";
import { pdfSafe, toPDF } from "@/lib/reports/pdf";
import { parseRange } from "@/lib/reports/dashboard";
import { makeCart, makeProduct, makeSupplier, validCheckout } from "../helpers";

afterAll(closeDb);

const FAR = { de: "2031-03-01", ate: "2031-03-31" };
const at = new Date("2031-03-10T15:00:00-03:00");

describe("financeiro", () => {
  it("demonstrativo separa faturamento, custo previsto/realizado, taxa e despesas", async () => {
    const supplierId = await makeSupplier();
    const { productId, variantId } = await makeProduct({ supplierId, price: 10000, cost: 4000, ship: 1500 });
    const cartId = await makeCart();
    await addToCart(cartId, variantId, 2);
    const o = await createOrderFromCart(cartId, null, validCheckout());
    const [pay] = await db()`insert into public.payments (order_id, provider, status, amount_cents, fee_cents, net_cents)
      values (${o.id}, 'mercadopago', 'approved', ${o.total}, 990, ${o.total - 990}) returning id`;
    await db().begin((tx: Tx) => postSaleEntries(tx, o.id, { id: pay.id, fee: 990, releaseDate: new Date("2031-03-20T12:00:00-03:00"), approvedAt: at }));
    const range = parseRange(FAR);

    let d = await financeDre(range);
    expect(d.sales).toBe(20000);
    expect(d.fees).toBe(-990);
    expect(d.productCost).toBe(0); // ainda previsto
    expect(d.expectedCosts).toBe(-(8000 + 3000));

    await db().begin((tx: Tx) => realizeSupplierCosts(tx, o.id, supplierId));
    d = await financeDre(range);
    expect(d.productCost).toBe(-8000);
    expect(d.shippingCost).toBe(-3000);
    expect(d.expectedCosts).toBe(0);

    // conta paga entra como despesa; reabrir cancela o lançamento; pagar de novo lança uma vez só
    const exp = await saveExpense(null, { category: "marketing", description: "Anúncios março", amount_cents: 5000, due_date: "2031-03-15" }, null);
    await setExpenseStatus(exp, "pay", "2031-03-15");
    await expect(setExpenseStatus(exp, "pay", "2031-03-15")).rejects.toThrow(/já paga/);
    expect((await financeDre(range)).otherExpense).toBe(-5000);
    await setExpenseStatus(exp, "reopen");
    expect((await financeDre(range)).otherExpense).toBe(0);
    await setExpenseStatus(exp, "pay", "2031-03-16");
    expect((await financeDre(range)).otherExpense).toBe(-5000);
    await expect(setExpenseStatus(exp, "cancel")).rejects.toThrow(/em aberto/);
    await expect(saveExpense(null, { category: "x", description: "a", amount_cents: 1, due_date: "2031-03-01" }, null)).rejects.toThrow();

    const rev = await saveRevenue(null, { category: "venda_externa", description: "Venda balcão", amount_cents: 2500, expected_date: "2031-03-12", received: false }, null);
    await setRevenueStatus(rev, "receive", "2031-03-12");
    d = await financeDre(range);
    expect(d.otherIncome).toBe(2500);
    expect(d.net).toBe(d.gross - 8000 - 3000 - 990 - 5000 + 2500);

    // caixa: venda entra na data de liberação do gateway
    const flow = await cashFlow(range);
    expect(flow).toHaveLength(31);
    expect(flow.find((x) => x.day === "2031-03-20")!.inflow).toBeGreaterThanOrEqual(20000);
    expect(flow.find((x) => x.day === "2031-03-16")!.outflow).toBe(5000);

    const byProduct = await profitBy("product", range);
    const row = byProduct.find((x) => x.id === productId)!;
    expect(row).toMatchObject({ units: 2, revenue: 20000, cost: 8000, shipping_cost: 3000, profit: 9000 });
    const bySupplier = await profitBy("supplier", range);
    expect(bySupplier.find((x) => x.id === supplierId)!.profit).toBe(9000);
  });

  it("todos os relatórios geram CSV e PDF", async () => {
    const range = parseRange(FAR);
    for (const r of Object.values(REPORTS)) {
      const rows = await r.load(range, {});
      const csv = toCSV(rows, r.columns);
      expect(csv.split("\n")[0]).toContain(r.columns[0].header);
      const pdf = await toPDF({ title: r.title, subtitle: "teste", rows, columns: r.columns });
      expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    }
    const dre = await REPORTS.dre.load(range, {});
    expect(dre.find((x: { linha: string }) => x.linha === "Resultado do período")).toBeTruthy();
  });

  it("PDF aceita acentos e substitui caracteres fora da fonte", () => {
    expect(pdfSafe("Ação → ok 😀")).toBe("Ação ? ok ?");
  });
});
