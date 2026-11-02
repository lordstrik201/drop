import type { SupplierAdapter } from "./types";

/**
 * Fornecedor sem API: o pedido fica na fila "encaminhar manualmente" do painel,
 * com os dados prontos para copiar ou exportar em CSV. O operador informa o
 * número do pedido no fornecedor e o rastreio quando recebê-los.
 */
export const manualAdapter: SupplierAdapter = {
  code: "manual",
  label: "Operação manual / CSV",
  async createOrder(input) {
    return {
      kind: "manual",
      instructions: `Encaminhe o pedido ${input.orderNumber} ao fornecedor pelo canal combinado (e-mail, WhatsApp ou painel do fornecedor) e registre o número do pedido no fornecedor.`,
    };
  },
};
