import { PRODUCT_COLUMNS, STOCK_COLUMNS } from "@/lib/catalog/csv-import";
import { csvResponse, toCSV } from "@/lib/reports/csv";

/** Modelos de planilha (somente cabeçalho + uma linha de exemplo marcada como EXEMPLO). */
export async function GET(req: Request) {
  const tipo = new URL(req.url).searchParams.get("tipo") === "estoque" ? "estoque" : "produtos";
  const cols = tipo === "estoque" ? STOCK_COLUMNS : PRODUCT_COLUMNS;
  const example: Record<string, string> = tipo === "estoque"
    ? { sku: "EXEMPLO-SKU-AZUL-M", ref_variacao: "", estoque: "25", custo: "39,90" }
    : { sku: "EXEMPLO-SKU-AZUL-M", nome: "EXEMPLO — apague esta linha", sku_produto: "EXEMPLO-SKU", variacao: "Azul / M", opcoes: "Cor: Azul; Tamanho: M", preco: "129,90", custo: "45,00", frete_fornecedor: "12,00", estoque: "25", categoria: "", marca: "", descricao: "", imagens: "https://exemplo.com/foto1.jpg|https://exemplo.com/foto2.jpg", ref_fornecedor: "", ref_variacao: "", peso_g: "300", comprimento_cm: "20", largura_cm: "15", altura_cm: "5", prazo_min: "5", prazo_max: "12" };
  return csvResponse(toCSV([example], cols.map((c) => ({ header: c, value: (r: Record<string, string>) => r[c] ?? "" }))), `modelo-${tipo}.csv`);
}
