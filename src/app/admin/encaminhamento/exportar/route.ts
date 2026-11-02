import { assertPermission } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/rbac";
import { fulfillmentQueue } from "@/lib/fulfillment/queue";
import { toCSV, csvResponse, centsCell } from "@/lib/reports/csv";
import { audit } from "@/lib/audit";
import { todaySP } from "@/lib/ui/dates";
import type { SupplierOrderStatus } from "@/lib/types";

/**
 * CSV de encaminhamento manual: uma linha por item, com os dados de entrega,
 * para enviar a fornecedores sem API. Contém dados pessoais do cliente: o
 * download exige permissão e fica registrado na auditoria (LGPD).
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await assertPermission("orders.write");
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    return new Response("Faça login no painel.", { status: 401 });
  }
  const url = new URL(req.url);
  const supplierId = url.searchParams.get("fornecedor");
  const rows = await fulfillmentQueue({
    supplierId: supplierId && /^[0-9a-f-]{36}$/i.test(supplierId) ? supplierId : null,
    statuses: ["pending", "failed"] as SupplierOrderStatus[],
  });
  const flat = rows.flatMap((r) => (r.items ?? []).map((i) => ({ r, i })));
  const csv = toCSV(flat, [
    { header: "pedido", value: ({ r }) => r.number },
    { header: "fornecedor", value: ({ r }) => r.supplier_name },
    { header: "sku", value: ({ i }) => i.sku },
    { header: "ref_fornecedor", value: ({ i }) => i.ref },
    { header: "produto", value: ({ i }) => i.name },
    { header: "variacao", value: ({ i }) => (i.variant === "Padrão" ? "" : i.variant) },
    { header: "quantidade", value: ({ i }) => i.qty },
    { header: "custo_total_fornecedor", value: ({ r }) => centsCell(r.total_cost_cents) },
    { header: "destinatario", value: ({ r }) => r.shipping_address.recipient_name },
    { header: "cpf", value: ({ r }) => r.customer_cpf },
    { header: "telefone", value: ({ r }) => r.customer_phone },
    { header: "email", value: ({ r }) => r.customer_email },
    { header: "cep", value: ({ r }) => r.shipping_address.cep },
    { header: "logradouro", value: ({ r }) => r.shipping_address.street },
    { header: "numero", value: ({ r }) => r.shipping_address.number },
    { header: "complemento", value: ({ r }) => r.shipping_address.complement },
    { header: "bairro", value: ({ r }) => r.shipping_address.district },
    { header: "cidade", value: ({ r }) => r.shipping_address.city },
    { header: "uf", value: ({ r }) => r.shipping_address.state },
    { header: "frete_escolhido", value: ({ r }) => r.shipping_method },
  ]);
  await audit(user, "fulfillment.export_csv", "supplier_orders", supplierId, { after: { rows: flat.length } });
  return csvResponse(csv, `encaminhamento-${todaySP()}.csv`);
}
