import { describe, it, expect } from "vitest";
import { buildCjOrderBody, mapCjProduct, parseUsd, stockOf, stripHtml } from "@/lib/integrations/suppliers/cj";
import { sniffImageType } from "@/lib/storage/media";

const product = {
  pid: "04A22450-67F0-4617-A132-E7AE7F8963B0", productNameEn: "Garrafa térmica", productSku: "CJJJ123",
  productImageSet: ["http://cf.cjdropshipping.com/a.jpg", "https://cf.cjdropshipping.com/b.jpg"], sellPrice: "4.10-5.20",
  description: "<p>Aço <b>inox</b></p><ul><li>500 ml</li></ul>",
  variants: [
    { vid: "V1", variantSku: "CJJJ123-BL", variantKey: "Blue-500ml", variantSellPrice: 4.1, inventories: [{ countryCode: "CN", totalInventory: 100 }, { countryCode: "BR", totalInventory: 7 }] },
    { vid: "V2", variantSku: "CJJJ123-RD", variantKey: "Red-500ml", variantSellPrice: "5.20", inventories: [{ countryCode: "CN", totalInventory: 0 }] },
  ],
};

describe("CJ: mapeamento", () => {
  it("converte USD com a cotação do lojista e soma estoque por país", () => {
    const p = mapCjProduct(product, { usd_brl_rate: 5.5 });
    expect(p.costCents).toBe(Math.round(4.1 * 5.5 * 100));
    expect(p.variants[1].costCents).toBe(2860);
    expect(p.variants[0].stock).toBe(107);
    expect(p.variants[0].options).toEqual({ "Opção": "Blue", "Opção 2": "500ml" });
    expect(p.images.every((u) => u.startsWith("https://"))).toBe(true);
    expect(mapCjProduct(product, { usd_brl_rate: 5.5, warehouse_country: "BR" }).variants[0].stock).toBe(7);
  });
  it("exige cotação do dólar", () => {
    expect(() => mapCjProduct(product, {})).toThrow(/cotação/);
  });
  it("utilitários", () => {
    expect(parseUsd("4.10-5.20")).toBe(4.1);
    expect(parseUsd("abc")).toBeNull();
    expect(stockOf({ vid: "x", variantSku: "x" })).toBeNull();
    expect(stripHtml("<p>Aço <b>inox</b></p><ul><li>500 ml</li></ul>")).toBe("Aço inox\n- 500 ml");
  });
  it("pedido: payType 3 (sem pagamento automático), endereço brasileiro e vid obrigatório", () => {
    const input = {
      supplierOrderId: "11111111-2222-3333-4444-555555555555", idempotencyKey: "k", orderNumber: 100123,
      customer: { name: "Maria", email: "m@e.com", phone: "11987654321", cpf: "52998224725" },
      address: { recipient_name: "Maria", cep: "01310100", street: "Av. Paulista", number: "1000", complement: "ap 5", district: "Bela Vista", city: "São Paulo", state: "SP" },
      items: [{ sku: "S", supplierProductRef: "P", supplierVariantRef: "V1", quantity: 2, name: "x" }], shippingMethod: null, config: {},
    };
    const body = buildCjOrderBody(input, { logistic_name: "CJPacket", from_country_code: "CN" });
    expect(body).toMatchObject({ payType: 3, shippingCountryCode: "BR", shippingProvince: "SP", shippingZip: "01310100", taxId: "52998224725", products: [{ vid: "V1", quantity: 2 }], orderNumber: "100123-11111111" });
    expect(() => buildCjOrderBody(input, {})).toThrow(/logisticName/);
    expect(() => buildCjOrderBody({ ...input, items: [{ ...input.items[0], supplierVariantRef: null }] }, { logistic_name: "x" })).toThrow(/vid/);
  });
});

describe("upload: tipo real do arquivo", () => {
  it("reconhece assinaturas e recusa o resto (ex.: SVG/HTML)", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});
