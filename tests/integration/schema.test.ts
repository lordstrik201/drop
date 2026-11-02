import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/lib/db/client";
import { rateLimit } from "@/lib/security/rate-limit";

afterAll(closeDb);

describe("esquema do banco", () => {
  it("cria perfil automaticamente ao registrar usuário no auth", async () => {
    const [u] = await db()`insert into auth.users (email, raw_user_meta_data) values ('ana@example.com', '{"full_name":"Ana"}') returning id`;
    const [p] = await db()`select email, full_name, role from public.profiles where id = ${u.id}`;
    expect(p).toMatchObject({ email: "ana@example.com", full_name: "Ana", role: "customer" });
  });

  it("exige total coerente no pedido", async () => {
    await expect(db()`
      insert into public.orders (idempotency_key, customer_name, customer_email, shipping_address, subtotal_cents, discount_cents, shipping_cents, total_cents)
      values ('k1', 'X', 'x@x.com', '{}', 1000, 0, 0, 999)`).rejects.toThrow(/orders_total_ck/);
  });

  it("chave de idempotência impede pedido duplicado", async () => {
    const ins = () => db()`
      insert into public.orders (idempotency_key, customer_name, customer_email, shipping_address, subtotal_cents, total_cents)
      values ('dup-1', 'X', 'x@x.com', '{}', 1000, 1000)`;
    await ins();
    await expect(ins()).rejects.toThrow(/duplicate key/);
  });

  it("RLS: visitante anônimo não lê pedidos nem integrações", async () => {
    const rows = await db().begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select count(*)::int as n from public.orders`;
    });
    expect(rows[0].n).toBe(0);
    await expect(
      db().begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select * from public.integrations`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("RLS: catálogo público só mostra produtos ativos", async () => {
    await db()`insert into public.products (name, slug, sku, status, price_cents) values ('Rascunho', 'rascunho', 'R1', 'draft', 100), ('Ativo', 'ativo', 'A1', 'active', 100)`;
    const rows = await db().begin(async (tx) => {
      await tx`set local role anon`;
      return tx`select slug from public.products where slug in ('ativo', 'rascunho')`;
    });
    expect(rows.map((r) => r.slug)).toEqual(["ativo"]);
  });

  it("busca textual ignora acentos", async () => {
    await db()`insert into public.products (name, slug, sku, status, price_cents) values ('Tênis Esportivo Leve', 'tenis-esportivo', 'T1', 'active', 100)`;
    const rows = await db()`select slug from public.products where search_vector @@ websearch_to_tsquery('portuguese', public.f_unaccent('tenis'))`;
    expect(rows.map((r) => r.slug)).toContain("tenis-esportivo");
  });

  it("permissões: atendimento não pode reembolsar; admin pode", async () => {
    const rows = await db()`select role, permission from public.role_permissions where permission = 'payments.refund'`;
    const roles = rows.map((r) => r.role).sort();
    expect(roles).toEqual(["admin", "manager"]);
  });

  it("rate limit bloqueia após o limite", async () => {
    const key = `t:${Date.now()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60)).allowed).toBe(true);
    expect((await rateLimit(key, 3, 60)).allowed).toBe(false);
  });
});
