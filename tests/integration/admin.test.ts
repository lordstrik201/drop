import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/lib/db/client";
import { setUserRole } from "@/lib/users/roles";
import { anonymizeCustomer, exportCustomerData } from "@/lib/customers/lgpd";
import { fulfillmentQueue } from "@/lib/fulfillment/queue";
import { testIntegration } from "@/lib/integrations/health";
import { addToCart } from "@/lib/cart/cart";
import { createOrderFromCart } from "@/lib/orders/create";
import { cancelOrder, setOrderStatus } from "@/lib/orders/admin";
import { makeCart, makeProduct, makeSupplier, validCheckout } from "../helpers";

afterAll(closeDb);

let n = 0;
async function user(role = "customer") {
  const email = `u${Date.now()}${++n}@example.com`;
  const [u] = await db()`insert into auth.users (email) values (${email}) returning id`;
  if (role !== "customer") await db()`update public.profiles set role = ${role} where id = ${u.id}`;
  return { id: u.id as string, email };
}

async function orderFor(profileId: string | null) {
  const supplierId = await makeSupplier();
  const { variantId } = await makeProduct({ supplierId });
  const cartId = await makeCart();
  await addToCart(cartId, variantId, 1);
  return createOrderFromCart(cartId, profileId, validCheckout());
}

describe("papéis de usuário", () => {
  it("não permite alterar o próprio papel nem ficar sem administrador", async () => {
    await db()`update public.profiles set role = 'manager' where role = 'admin'`;
    const a = await user("admin");
    const b = await user("customer");
    await expect(setUserRole({ id: a.id }, "customer", a.id)).rejects.toThrow(/próprio papel/);
    await setUserRole({ email: b.email.toUpperCase() }, "admin", a.id);
    const [r] = await db()`select role from public.profiles where id = ${b.id}`;
    expect(r.role).toBe("admin");
    await setUserRole({ id: a.id }, "operator", b.id); // b remove a: ainda resta b
    await expect(setUserRole({ id: b.id }, "customer", a.id)).rejects.toThrow(/pelo menos um administrador/);
  });
  it("exige conta existente", async () => {
    const a = await user("admin");
    await expect(setUserRole({ email: "ninguem@example.com" }, "operator", a.id)).rejects.toThrow(/criar a conta/);
  });
});

describe("LGPD", () => {
  it("exporta os dados do titular", async () => {
    const c = await user();
    await orderFor(c.id);
    const data = await exportCustomerData(c.id);
    expect((data.perfil as { email: string }).email).toBe(c.email);
    expect(data.pedidos).toHaveLength(1);
  });

  it("recusa eliminar com pedido em andamento; elimina e mantém o pedido depois", async () => {
    const c = await user();
    const staff = await user("admin");
    const order = await orderFor(c.id);
    await db()`insert into public.addresses (profile_id, recipient_name, cep, street, number, district, city, state) values (${c.id}, 'X', '01310100', 'Rua', '1', 'B', 'São Paulo', 'SP')`;
    await expect(anonymizeCustomer(c.id, staff.id, null)).rejects.toThrow(/em andamento/);
    await cancelOrder(order.id, "teste de eliminação", staff.id);
    await anonymizeCustomer(c.id, staff.id, "Pedido do titular");
    expect(await db()`select 1 from public.profiles where id = ${c.id}`).toHaveLength(0);
    expect(await db()`select 1 from auth.users where id = ${c.id}`).toHaveLength(0);
    expect(await db()`select 1 from public.addresses where profile_id = ${c.id}`).toHaveLength(0);
    const [o] = await db()`select profile_id, total_cents from public.orders where id = ${order.id}`;
    expect(o).toMatchObject({ profile_id: null, total_cents: order.total });
    const [req] = await db()`select status from public.privacy_requests where email = ${c.email} and kind = 'delete'`;
    expect(req.status).toBe("done");
  });

  it("não elimina contas da equipe", async () => {
    const s = await user("operator");
    const a = await user("admin");
    await expect(anonymizeCustomer(s.id, a.id, null)).rejects.toThrow(/equipe/);
  });
});

describe("painel de pedidos", () => {
  it("fila de encaminhamento não mostra pedidos não pagos", async () => {
    const o = await orderFor(null);
    const [s] = await db()`select supplier_id from public.order_items where order_id = ${o.id}`;
    await db()`insert into public.supplier_orders (order_id, supplier_id, idempotency_key) values (${o.id}, ${s.supplier_id}, ${"t-" + o.id})`;
    const q = await fulfillmentQueue();
    expect(q.find((r) => r.order_id === o.id)).toBeUndefined();
  });

  it("status manual não aprova pagamento nem pula para o fornecedor sem pagamento", async () => {
    const a = await user("admin");
    const o = await orderFor(null);
    await expect(setOrderStatus(o.id, "paid", a.id, null)).rejects.toThrow(/gateway/);
    await expect(setOrderStatus(o.id, "awaiting_supplier", a.id, null)).rejects.toThrow(/Sem pagamento aprovado/);
  });
});

describe("teste de conexão", () => {
  it("Mercado Pago: 404 = token aceito; 401 = recusado; nada é criado", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-123";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "x";
    const seen: string[] = [];
    const mk = (status: number) => (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${String(url)}`);
      return new Response(JSON.stringify({ message: "x" }), { status });
    }) as typeof fetch;
    const ok = await testIntegration("mercadopago", { staffEmail: "a@b.com", f: mk(404) });
    expect(ok.ok).toBe(true);
    expect(ok.message).toMatch(/TESTE/);
    let [i] = await db()`select status from public.integrations where provider = 'mercadopago'`;
    expect(i.status).toBe("connected");
    const bad = await testIntegration("mercadopago", { staffEmail: "a@b.com", f: mk(401) });
    expect(bad.ok).toBe(false);
    [i] = await db()`select status, last_error from public.integrations where provider = 'mercadopago'`;
    expect(i.status).toBe("error");
    expect(seen.every((s) => s.startsWith("GET https://api.mercadopago.com/v1/payments/0"))).toBe(true);
  });
  it("sem credenciais informa o que falta", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await testIntegration("resend", { staffEmail: "a@b.com", f: (async () => { throw new Error("não deve chamar"); }) as typeof fetch });
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/apiKey/);
  });
});
