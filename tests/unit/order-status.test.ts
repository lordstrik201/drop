import { describe, expect, it } from "vitest";
import { allowedTransitions, canTransition, isPaidState } from "@/lib/orders/status";

describe("máquina de estados do pedido", () => {
  it("só permite ir ao fornecedor depois do pagamento", () => {
    expect(canTransition("pending_payment", "awaiting_supplier")).toBe(false);
    expect(canTransition("pending_payment", "sent_to_supplier")).toBe(false);
    expect(canTransition("paid", "awaiting_supplier")).toBe(true);
    expect(canTransition("awaiting_supplier", "sent_to_supplier")).toBe(true);
  });
  it("reembolsado é estado final", () => {
    expect(allowedTransitions("refunded")).toEqual([]);
  });
  it("pedido entregue não pode ser cancelado, apenas reembolsado", () => {
    expect(canTransition("delivered", "canceled")).toBe(false);
    expect(canTransition("delivered", "refunded")).toBe(true);
  });
  it("identifica estados pagos", () => {
    expect(isPaidState("pending_payment")).toBe(false);
    expect(isPaidState("in_transit")).toBe(true);
    expect(isPaidState("canceled")).toBe(false);
  });
});
