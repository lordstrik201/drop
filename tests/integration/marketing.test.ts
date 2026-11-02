import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { closeDb, db } from "@/lib/db/client";
import { addToCart, loadCartLines } from "@/lib/cart/cart";
import { createOrderFromCart } from "@/lib/orders/create";
import { saveSetting } from "@/lib/settings";
import { saveCampaign, saveCoupon, setCampaignActive } from "@/lib/marketing/admin";
import { abandonedCandidates, sendAbandonedCartEmails, signToken, unsubscribe, verifyToken } from "@/lib/marketing/abandoned";
import { awardLoyaltyPoints, loyaltyBalance, redeemPoints } from "@/lib/marketing/loyalty";
import { validateCoupon, type Coupon } from "@/lib/cart/totals";
import { makeCart, makeProduct, makeSupplier, validCheckout } from "../helpers";

afterAll(closeDb);
beforeAll(() => { process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString("base64"); });

let n = 0;
async function customer(consent: boolean) {
  const email = `mkt${Date.now()}${++n}@example.com`;
  const [u] = await db()`insert into auth.users (email) values (${email}) returning id`;
  await db()`update public.profiles set marketing_consent = ${consent}, full_name = 'Ana Souza' where id = ${u.id}`;
  return { id: u.id as string, email };
}

describe("cupons e campanhas", () => {
  it("valida regras e impede código duplicado", async () => {
    const code = `T${Date.now().toString(36).toUpperCase()}`;
    const id = await saveCoupon(null, { code: code.toLowerCase(), kind: "percent", value: 1000, min_subtotal_cents: 0, max_uses_per_customer: 1 });
    const [c] = await db()`select code, is_active from public.coupons where id = ${id}`;
    expect(c).toMatchObject({ code, is_active: true });
    await expect(saveCoupon(null, { code, kind: "fixed", value: 500 })).rejects.toThrow(/Já existe/);
    await expect(saveCoupon(null, { code: `${code}X`, kind: "percent", value: 9500 })).rejects.toThrow();
    await expect(saveCoupon(null, { code: `${code}Y`, kind: "fixed", value: 100, first_order_only: true, returning_customers_only: true })).rejects.toThrow();
    await expect(saveCoupon(null, { code: `${code}Z`, kind: "fixed", value: 100, starts_at: "2031-02-10", ends_at: "2031-02-01" })).rejects.toThrow();
    await saveCoupon(id, { code, kind: "free_shipping", value: 999 });
    const [c2] = await db()`select kind, value from public.coupons where id = ${id}`;
    expect(c2).toMatchObject({ kind: "free_shipping", value: 0 });
  });

  it("cupom pessoal só vale para o e-mail dono", () => {
    const c = { id: "x", code: "PONTOS-1", kind: "fixed", value: 500, max_discount_cents: null, min_subtotal_cents: 0, max_uses: 1, max_uses_per_customer: 1, used_count: 0,
      first_order_only: false, returning_customers_only: false, starts_at: null, ends_at: null, is_active: true, customer_email: "ana@example.com" } as Coupon;
    const ctx = { subtotal: 10000, customerPaidOrders: 0, customerCouponUses: 0 };
    expect(validateCoupon(c, { ...ctx, email: "ANA@example.com " }).ok).toBe(true);
    expect(validateCoupon(c, { ...ctx, email: "outro@example.com" }).ok).toBe(false);
    expect(validateCoupon(c, ctx).ok).toBe(false);
  });

  it("campanha de produto reduz o preço no carrinho e para quando pausada", async () => {
    const supplierId = await makeSupplier();
    const { productId, variantId } = await makeProduct({ supplierId, price: 10000 });
    const cartId = await makeCart();
    await addToCart(cartId, variantId, 1);
    const id = await saveCampaign(null, { name: "Semana", discount_bps: 1500, scope: "product", product_id: productId, is_active: true });
    expect((await loadCartLines(cartId))[0].unitPrice).toBe(8500);
    await setCampaignActive(id, false);
    expect((await loadCartLines(cartId))[0].unitPrice).toBe(10000);
    await expect(saveCampaign(null, { name: "X", discount_bps: 1000, scope: "category", is_active: true })).rejects.toThrow();
  });
});

describe("carrinho abandonado", () => {
  it("envia uma vez, só para quem consentiu, com link de recuperação e descadastro", async () => {
    const supplierId = await makeSupplier();
    const { variantId } = await makeProduct({ supplierId });
    const yes = await customer(true);
    const no = await customer(false);
    const carts: Record<string, string> = {};
    for (const u of [yes, no]) {
      const id = await makeCart();
      await addToCart(id, variantId, 1);
      await db()`update public.carts set profile_id = ${u.id} where id = ${id}`;
      // o gatilho set_updated_at sobrescreveria a data: simula a inatividade sem gatilhos
      await db().begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update public.carts set updated_at = now() - interval '6 hours' where id = ${id}`;
      });
      carts[u.email] = id;
    }
    const ids = (await abandonedCandidates(4, 1000)).map((c) => c.id);
    expect(ids).toContain(carts[yes.email]);
    expect(ids).not.toContain(carts[no.email]);

    // desligado por padrão
    expect(await sendAbandonedCartEmails()).toMatchObject({ skipped: expect.stringMatching(/desativada/) });

    await saveSetting("marketing", { abandoned_cart_enabled: true, abandoned_cart_delay_hours: 4 }, null);
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Loja <loja@example.com>";
    const sent: { to: string[]; html: string; headers?: Record<string, string> }[] = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200 });
    }) as typeof fetch;
    await sendAbandonedCartEmails(f);
    const mine = sent.filter((m) => m.to[0] === yes.email);
    expect(mine).toHaveLength(1);
    expect(sent.some((m) => m.to[0] === no.email)).toBe(false);
    expect(mine[0].headers?.["List-Unsubscribe"]).toMatch(/descadastrar\?t=/);
    const link = /carrinho\/recuperar\?t=([^"]+)"/.exec(mine[0].html)![1];
    expect(verifyToken("cart", decodeURIComponent(link))).toBe(carts[yes.email]);
    expect(verifyToken("cart", decodeURIComponent(link).replace(/.$/, "0"))).toBeNull();

    const before = sent.length;
    await sendAbandonedCartEmails(f);
    expect(sent.filter((m) => m.to[0] === yes.email)).toHaveLength(1);
    expect(sent.length).toBeGreaterThanOrEqual(before);

    await unsubscribe(signToken("unsub", yes.id));
    const [p] = await db()`select marketing_consent from public.profiles where id = ${yes.id}`;
    expect(p.marketing_consent).toBe(false);
    await expect(unsubscribe(`${yes.id}.deadbeef`)).rejects.toThrow(/inválido/);
    await saveSetting("marketing", { abandoned_cart_enabled: false, abandoned_cart_delay_hours: 4 }, null);
  });
});

describe("fidelidade", () => {
  it("credita na entrega, estorna no reembolso e troca por cupom pessoal", async () => {
    const u = await customer(false);
    const supplierId = await makeSupplier();
    const { variantId } = await makeProduct({ supplierId, price: 20000 });
    const cartId = await makeCart();
    await addToCart(cartId, variantId, 1);
    const o = await createOrderFromCart(cartId, u.id, validCheckout({ email: u.email }));
    await db()`update public.orders set status = 'delivered', paid_at = now() where id = ${o.id}`;

    expect(await awardLoyaltyPoints()).toMatchObject({ skipped: expect.any(String) });
    await saveSetting("loyalty", { enabled: true, points_per_real: 1, cents_per_point: 1, min_redeem_points: 50, coupon_valid_days: 30 }, null);
    await awardLoyaltyPoints();
    await awardLoyaltyPoints(); // idempotente
    const earned = Math.floor(o.total / 100);
    expect(await loyaltyBalance(u.id)).toBe(earned);

    await expect(redeemPoints(u.id, 10)).rejects.toThrow(/pelo menos 50/);
    await expect(redeemPoints(u.id, earned + 1)).rejects.toThrow(/insuficiente/);
    const r = await redeemPoints(u.id, 100);
    expect(r.valueCents).toBe(100);
    const [c] = await db()`select customer_email, origin, max_uses, kind from public.coupons where code = ${r.code}`;
    expect(c).toMatchObject({ customer_email: u.email.toLowerCase(), origin: "loyalty", max_uses: 1, kind: "fixed" });
    expect(await loyaltyBalance(u.id)).toBe(earned - 100);

    await db()`update public.orders set status = 'refunded' where id = ${o.id}`;
    await awardLoyaltyPoints();
    expect(await loyaltyBalance(u.id)).toBe(-100);
    await saveSetting("loyalty", { enabled: false, points_per_real: 1, cents_per_point: 1, min_redeem_points: 500, coupon_valid_days: 60 }, null);
  });
});
