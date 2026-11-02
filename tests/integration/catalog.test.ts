import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/lib/db/client";
import { addProductImage, bulkReprice, deleteOrArchiveProduct, duplicateProduct, saveProduct, saveVariant, setProductsStatus, saveCategory, deleteCategory } from "@/lib/catalog/admin";
import { importCsv } from "@/lib/catalog/csv-import";
import { importSupplierProduct, syncSupplier } from "@/lib/suppliers/sync";
import { registerSupplierAdapter } from "@/lib/integrations/suppliers/registry";
import { cjAdapter } from "@/lib/integrations/suppliers/cj";
import type { ImportedProduct } from "@/lib/integrations/suppliers/types";
import { makeSupplier } from "../helpers";

afterAll(closeDb);
let n = 0;
const u = () => `${Date.now().toString(36)}${++n}`;
const base = (over: Record<string, unknown> = {}) => ({ name: "Fone Bluetooth " + u(), sku: "FONE-" + u(), status: "draft", is_featured: false, category_id: "", supplier_id: "", cost_cents: "40,00", shipping_cost_cents: "10,00", price_cents: "99,90", ...over });

describe("produtos", () => {
  it("cria rascunho com variação padrão e histórico; ativar exige imagem e fornecedor", async () => {
    const supplierId = await makeSupplier();
    const r = await saveProduct(null, base({ supplier_id: supplierId }), null);
    const vs = await db()`select sku, title from public.product_variants where product_id = ${r.id}`;
    expect(vs).toHaveLength(1);
    expect(vs[0].title).toBe("Padrão");
    await expect(saveProduct(r.id, base({ status: "active", supplier_id: supplierId, sku: vs[0].sku }), null)).rejects.toThrow(/imagem/);
    await expect(saveProduct(r.id, base({ status: "active", sku: vs[0].sku }), null)).rejects.toThrow(/fornecedor/);
    await addProductImage(r.id, { url: "https://exemplo.com/a.jpg" });
    await saveProduct(r.id, base({ status: "active", supplier_id: supplierId, sku: vs[0].sku, price_cents: "109,90" }), null);
    const hist = await db()`select price_cents from public.price_history where product_id = ${r.id} order by id`;
    expect(hist.map((h) => h.price_cents)).toEqual([9990, 10990]);
  });

  it("valida promoção e SKU duplicado", async () => {
    await expect(saveProduct(null, base({ promo_price_cents: "120,00" }), null)).rejects.toThrow(/promocional/);
    const sku = "DUP-" + u();
    await saveProduct(null, base({ sku }), null);
    await expect(saveProduct(null, base({ sku: sku.toLowerCase() }), null)).rejects.toThrow(/SKU/);
  });

  it("variação registra estoque; ativação em massa pula produtos incompletos", async () => {
    const supplierId = await makeSupplier();
    const r = await saveProduct(null, base({ supplier_id: supplierId }), null);
    const vid = await saveVariant(r.id, null, { sku: "VAR-" + u(), title: "Azul", options: { Cor: "Azul" }, stock_quantity: "5", is_active: true, position: "1" }, "manual", null);
    await saveVariant(r.id, vid, { sku: (await db()`select sku from public.product_variants where id = ${vid}`)[0].sku, title: "Azul", options: {}, stock_quantity: "3", is_active: true }, "manual", null);
    const h = await db()`select previous_quantity, new_quantity from public.stock_history where variant_id = ${vid} order by id`;
    expect(h.map((x) => [x.previous_quantity, x.new_quantity])).toEqual([[null, 5], [5, 3]]);
    const res = await setProductsStatus([r.id], "active");
    expect(res.updated).toBe(0);
    expect(res.skipped).toHaveLength(1);
  });

  it("reajuste por margem, duplicação e exclusão/arquivamento", async () => {
    const r = await saveProduct(null, base({ cost_cents: "50,00", shipping_cost_cents: "0", price_cents: "60,00", promo_price_cents: "55,00" }), null);
    expect(await bulkReprice([r.id], { kind: "margin", marginBps: 5000, feeBps: 0, feeFixed: 0 }, null)).toBe(1);
    const [p] = await db()`select price_cents, promo_price_cents from public.products where id = ${r.id}`;
    expect(p.price_cents).toBe(10090);
    expect(p.promo_price_cents).toBe(5500);
    await bulkReprice([r.id], { kind: "percent", bps: -5000 }, null);
    const [p2] = await db()`select price_cents, promo_price_cents from public.products where id = ${r.id}`;
    expect(p2.price_cents).toBe(5045);
    expect(p2.promo_price_cents).toBeNull(); // promo ≥ preço é removida
    const copy = await duplicateProduct(r.id, null);
    const [c] = await db()`select status, slug from public.products where id = ${copy}`;
    expect(c.status).toBe("draft");
    expect(await deleteOrArchiveProduct(copy)).toBe("deleted");
  });

  it("categorias: impede ciclo e exclusão com produtos", async () => {
    const a = await saveCategory(null, { name: "Casa " + u(), is_active: true, parent_id: "" });
    const b = await saveCategory(null, { name: "Cozinha " + u(), is_active: true, parent_id: a });
    await expect(saveCategory(a, { name: "Casa", is_active: true, parent_id: b })).rejects.toThrow(/dentro dela mesma/);
    await saveProduct(null, base({ category_id: b }), null);
    await expect(deleteCategory(b)).rejects.toThrow(/produto/);
  });
});

describe("importação CSV", () => {
  it("simulação não grava; erros desfazem tudo; variações agrupadas por sku_produto", async () => {
    const supplierId = await makeSupplier();
    const g = "CAM-" + u();
    const csv = `sku;nome;sku_produto;variacao;opcoes;preco;custo;estoque;imagens\n${g}-P;Camiseta;${g};P;Tamanho: P;59,90;20,00;10;https://exemplo.com/c.jpg\n${g}-M;Camiseta;${g};M;Tamanho: M;59,90;20,00;4;\n`;
    const dry = await importCsv(csv, "produtos", { supplierId, apply: false, actorId: null });
    expect(dry).toMatchObject({ ok: true, applied: false, created: 1 });
    expect(await db()`select 1 from public.products where sku = ${g}`).toHaveLength(0);
    const bad = await importCsv(csv + `X-${u()};Outro;;;;abc;;;\n`, "produtos", { supplierId, apply: true, actorId: null });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].message).toMatch(/preco inválido/);
    expect(await db()`select 1 from public.products where sku = ${g}`).toHaveLength(0);
    const ok = await importCsv(csv, "produtos", { supplierId, apply: true, actorId: null });
    expect(ok).toMatchObject({ ok: true, applied: true, created: 1 });
    const vs = await db()`select v.sku, v.stock_quantity, v.options from public.product_variants v join public.products p on p.id = v.product_id where p.sku = ${g} order by v.position`;
    expect(vs.map((v) => [v.sku, v.stock_quantity])).toEqual([[`${g}-P`, 10], [`${g}-M`, 4]]);
    const [p] = await db()`select status, price_cents from public.products where sku = ${g}`;
    expect(p).toMatchObject({ status: "draft", price_cents: 5990 });
    // estoque
    const st = await importCsv(`sku,estoque\n${g}-M,0\n${g}-ZZ,3\n`, "estoque", { supplierId: null, apply: true, actorId: null });
    expect(st.ok).toBe(false);
    const st2 = await importCsv(`sku,estoque\n${g}-M,0\n`, "estoque", { supplierId: null, apply: true, actorId: null });
    expect(st2).toMatchObject({ ok: true, updated: 1 });
  });
  it("neutraliza URLs não https e categorias inexistentes", async () => {
    const supplierId = await makeSupplier();
    const r = await importCsv(`sku;nome;imagens;categoria\nA-${u()};Produto X;javascript:alert(1);\nB-${u()};Produto Y;;Inexistente\n`, "produtos", { supplierId, apply: true, actorId: null });
    expect(r.errors.map((e) => e.message).join(" ")).toMatch(/https[\s\S]*categoria|categoria[\s\S]*https/);
  });
});

describe("fornecedor com API", () => {
  it("importa como rascunho e a sincronização altera custo/estoque mas não o preço", async () => {
    const supplierId = await makeSupplier({ integration_type: "api" });
    const remote: ImportedProduct = { externalId: "EXT-" + u(), name: "Luminária", description: "d", images: ["https://exemplo.com/l.jpg"], costCents: 3000, shippingCostCents: null,
      variants: [{ externalId: "VA", sku: "LUM-" + u(), title: "Branca", options: {}, costCents: 3000, stock: 12 }] };
    registerSupplierAdapter("api", { code: "api", label: "teste", fetchProduct: async () => structuredClone(remote) });
    const r = await importSupplierProduct(supplierId, remote.externalId, null);
    expect(r.created).toBe(true);
    await db()`update public.products set price_cents = 8990 where id = ${r.productId}`;
    remote.costCents = 3500; remote.variants[0].costCents = 3500; remote.variants[0].stock = 2;
    const s = await syncSupplier(supplierId, null);
    expect(s).toMatchObject({ status: "succeeded", ok: 1, costChanged: 1, stockChanged: 1 });
    const [p] = await db()`select price_cents, cost_cents, status from public.products where id = ${r.productId}`;
    expect(p).toMatchObject({ price_cents: 8990, cost_cents: 3500, status: "draft" });
    const [alert] = await db()`select count(*)::int as n from public.price_history where product_id = ${r.productId} and acknowledged_at is null`;
    expect(alert.n).toBe(1);
    // variação removida no fornecedor → estoque zerado
    remote.variants = [];
    await syncSupplier(supplierId, null);
    const [v] = await db()`select stock_quantity from public.product_variants where product_id = ${r.productId}`;
    expect(v.stock_quantity).toBe(0);
  });

  it("CJ: obtém token, cria pedido sem pagamento e trata pedido duplicado", async () => {
    process.env.CJ_API_KEY = "cj-key-test";
    const calls: { url: string; body: unknown; token: string | null }[] = [];
    let dup = false;
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const token = new Headers(init?.headers).get("CJ-Access-Token");
      calls.push({ url: String(url), body, token });
      const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, result: true, message: "Success", data }), { status: 200 });
      if (String(url).endsWith("/authentication/getAccessToken")) {
        return ok({ accessToken: "tok-1", accessTokenExpiryDate: new Date(Date.now() + 86400e3 * 100).toISOString(), refreshToken: "r", refreshTokenExpiryDate: new Date(Date.now() + 86400e3 * 100).toISOString() });
      }
      if (String(url).endsWith("/shopping/order/createOrderV2")) {
        if (dup) return new Response(JSON.stringify({ code: 1600200, result: false, message: "ORDER_CODE_EXIST", data: null }), { status: 200 });
        return ok({ orderId: "CJ-ORDER-9", orderNumber: body.orderNumber, orderStatus: "CREATED" });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    await db()`update public.integrations set config = '{}' where provider = 'cj'`;
    const a = cjAdapter(f, 0);
    const input = { supplierOrderId: "11111111-2222-3333-4444-555555555555", idempotencyKey: "k", orderNumber: 100500,
      customer: { name: "M", email: "m@e.com", phone: null, cpf: null },
      address: { recipient_name: "M", cep: "01310100", street: "R", number: "1", district: "B", city: "SP", state: "SP" },
      items: [{ sku: "S", supplierProductRef: "P", supplierVariantRef: "V1", quantity: 1, name: "x" }], shippingMethod: null, config: { logistic_name: "CJPacket" } };
    const r = await a.createOrder!(input);
    expect(r).toMatchObject({ kind: "submitted", externalOrderId: "CJ-ORDER-9" });
    const order = calls.find((c) => c.url.endsWith("createOrderV2"))!;
    expect(order.token).toBe("tok-1");
    expect((order.body as { payType: number }).payType).toBe(3);
    // token reaproveitado (cifrado no banco)
    const [cfg] = await db()`select config from public.integrations where provider = 'cj'`;
    expect(String(cfg.config.tokens)).toMatch(/^v1\./);
    dup = true;
    await expect(a.createOrder!(input)).rejects.toThrow(/já existe na CJ/);
    expect(calls.filter((c) => c.url.endsWith("getAccessToken"))).toHaveLength(1);
  });
});
