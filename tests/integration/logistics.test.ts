import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/lib/db/client";
import { addToCart } from "@/lib/cart/cart";
import { createOrderFromCart } from "@/lib/orders/create";
import { addShipment } from "@/lib/orders/admin";
import { refreshCjTracking, mapCjTrackingStatus } from "@/lib/shipping/tracking";
import { logisticsAlerts } from "@/lib/shipping/alerts";
import { makeCart, makeProduct, makeSupplier, validCheckout } from "../helpers";

afterAll(closeDb);

async function sentOrder(supplierId: string) {
  const { variantId } = await makeProduct({ supplierId });
  const cartId = await makeCart();
  await addToCart(cartId, variantId, 1);
  const o = await createOrderFromCart(cartId, null, validCheckout());
  await db()`update public.orders set status = 'sent_to_supplier', paid_at = now() - interval '10 days' where id = ${o.id}`;
  const [so] = await db()`insert into public.supplier_orders (order_id, supplier_id, status, idempotency_key, submitted_at)
    values (${o.id}, ${supplierId}, 'submitted', ${"k-" + o.id}, now()) returning id`;
  return { orderId: o.id, supplierOrderId: so.id as string };
}

describe("rastreio automático (CJ)", () => {
  let cjSupplier: string;
  beforeAll(async () => {
    process.env.CJ_API_KEY = "cj-key-test";
    await db()`update public.integrations set config = '{}' where provider = 'cj'`;
    cjSupplier = await makeSupplier({ integration_type: "cj" });
  });

  it("mapeia somente o status documentado", () => {
    expect(mapCjTrackingStatus("In transit")).toBe("in_transit");
    expect(mapCjTrackingStatus("Delivered")).toBeNull();
    expect(mapCjTrackingStatus(null)).toBeNull();
  });

  it("consulta em lote, avança para em trânsito e registra eventos sem marcar entrega", async () => {
    const a = await sentOrder(cjSupplier);
    const b = await sentOrder(cjSupplier);
    const c = await sentOrder(cjSupplier);
    const tag = Date.now().toString(36).toUpperCase();
    await addShipment(a.orderId, { carrier: "CJPacket", trackingCode: `CJA${tag}`, supplierOrderId: a.supplierOrderId }, null);
    await addShipment(b.orderId, { carrier: "CJPacket", trackingCode: `CJB${tag}`, supplierOrderId: b.supplierOrderId }, null);
    await addShipment(c.orderId, { carrier: "CJPacket", trackingCode: `CJC${tag}`, supplierOrderId: c.supplierOrderId }, null);
    const urls: string[] = [];
    const f = (async (url: RequestInfo | URL) => {
      const u = String(url);
      urls.push(u);
      const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, result: true, message: "Success", data }), { status: 200 });
      if (u.endsWith("/authentication/getAccessToken")) {
        return ok({ accessToken: "tok", accessTokenExpiryDate: new Date(Date.now() + 864e7).toISOString(), refreshToken: "r", refreshTokenExpiryDate: new Date(Date.now() + 864e7).toISOString() });
      }
      if (u.includes("/logistic/trackInfo")) {
        return ok([
          { trackingNumber: `CJA${tag}`, trackingStatus: "In transit", lastMileCarrier: "Correios", lastTrackNumber: "QB123456789BR" },
          { trackingNumber: `CJB${tag}`, trackingStatus: "Delivered" },
        ]);
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const ids = (await db()`select id from public.shipments where tracking_code in (${`CJA${tag}`}, ${`CJB${tag}`}, ${`CJC${tag}`})`).map((r) => r.id as string);
    const r = await refreshCjTracking({ f, gapMs: 0, shipmentIds: ids, limit: 3 });
    expect(r).toMatchObject({ checked: 3, updated: 1, notFound: 1 });
    const track = urls.find((u) => u.includes("trackInfo"))!;
    expect(new URL(track).searchParams.getAll("trackNumber")).toHaveLength(3);

    const [sa] = await db()`select status from public.shipments where tracking_code = ${`CJA${tag}`}`;
    expect(sa.status).toBe("in_transit");
    const [oa] = await db()`select status from public.orders where id = ${a.orderId}`;
    expect(oa.status).toBe("in_transit");
    const [ea] = await db()`select description from public.tracking_events te join public.shipments sh on sh.id = te.shipment_id where sh.tracking_code = ${`CJA${tag}`}`;
    expect(ea.description).toContain("QB123456789BR");

    // status não documentado: evento registrado, mas o envio NÃO vira "entregue"
    const [sb] = await db()`select status from public.shipments where tracking_code = ${`CJB${tag}`}`;
    expect(sb.status).toBe("posted");
    const evB = await db()`select description from public.tracking_events te join public.shipments sh on sh.id = te.shipment_id where sh.tracking_code = ${`CJB${tag}`}`;
    expect(evB.map((e) => e.description)).toContain("Delivered");

    // segunda consulta com o mesmo retorno não duplica eventos
    await refreshCjTracking({ f, gapMs: 0, shipmentIds: ids, limit: 3 });
    const evB2 = await db()`select count(*)::int as n from public.tracking_events te join public.shipments sh on sh.id = te.shipment_id where sh.tracking_code = ${`CJB${tag}`}`;
    expect(evB2[0].n).toBe(evB.length);
  });

  it("sem credencial da CJ não consulta nada", async () => {
    const prev = process.env.CJ_API_KEY;
    delete process.env.CJ_API_KEY;
    const r = await refreshCjTracking({ f: (() => { throw new Error("não deveria chamar"); }) as unknown as typeof fetch, gapMs: 0 });
    expect(r.skipped).toMatch(/não configurada/);
    process.env.CJ_API_KEY = prev;
  });
});

describe("alertas de logística", () => {
  it("aponta pedido pago sem rastreio, rastreio parado, prazo vencido e exceção", async () => {
    const sup = await makeSupplier();
    const noShip = await sentOrder(sup);
    const stale = await sentOrder(sup);
    const late = await sentOrder(sup);
    const exc = await sentOrder(sup);
    const tag = Date.now().toString(36).toUpperCase();
    await addShipment(stale.orderId, { carrier: "Correios", trackingCode: `ST${tag}` }, null);
    await db()`update public.shipments set shipped_at = now() - interval '20 days', last_event_at = now() - interval '15 days' where tracking_code = ${`ST${tag}`}`;
    await addShipment(late.orderId, { carrier: "Correios", trackingCode: `LT${tag}`, confirmedEta: "2026-01-10" }, null);
    await addShipment(exc.orderId, { carrier: "Correios", trackingCode: `EX${tag}` }, null);
    await db()`update public.shipments set status = 'exception' where tracking_code = ${`EX${tag}`}`;

    const all = await logisticsAlerts();
    const kindOf = (orderId: string) => all.filter((a) => a.order_id === orderId).map((a) => a.kind);
    expect(kindOf(noShip.orderId)).toEqual(["sem_envio"]);
    expect(kindOf(stale.orderId)).toEqual(["sem_atualizacao"]);
    expect(kindOf(late.orderId)).toEqual(["prazo_vencido"]);
    expect(kindOf(exc.orderId)).toEqual(["excecao"]);
    expect((await logisticsAlerts("excecao")).every((a) => a.kind === "excecao")).toBe(true);
  });
});
