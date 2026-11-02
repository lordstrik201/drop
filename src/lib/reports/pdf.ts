import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { CsvColumn } from "@/lib/reports/csv";

/**
 * Gera um PDF tabular (A4 paisagem) com as mesmas colunas do CSV.
 * Fonte padrão Helvetica (WinAnsi): caracteres fora desse conjunto viram "?".
 */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function pdfSafe(s: string): string {
  return Array.from(s.replace(/[\r\n\t]+/g, " "))
    .map((c) => {
      const code = c.charCodeAt(0);
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(c) ? c : "?";
    })
    .join("");
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(v);
  if (typeof v === "boolean") return v ? "sim" : "não";
  return String(v);
}

function fit(text: string, font: PDFFont, size: number, max: number) {
  if (font.widthOfTextAtSize(text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > max) t = t.slice(0, -1);
  return t + "…";
}

export async function toPDF<T>(opts: { title: string; subtitle?: string; rows: T[]; columns: CsvColumn<T>[]; numericHeaders?: RegExp; footer?: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(opts.title));
  doc.setCreator("Drop");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 842, H = 595, M = 32, size = opts.columns.length > 12 ? 6.5 : 8, rowH = size + 5;
  const headers = opts.columns.map((c) => pdfSafe(c.header.replace(/_/g, " ")));
  const data = opts.rows.map((r) => opts.columns.map((c) => pdfSafe(cellText(c.value(r)))));
  // largura proporcional ao conteúdo (amostra), com mínimo e máximo
  const sample = data.slice(0, 200);
  const want = headers.map((h, i) => Math.min(160, Math.max(28, ...[h, ...sample.map((r) => r[i])].map((t) => font.widthOfTextAtSize(t, size) + 6))));
  const scale = (W - 2 * M) / want.reduce((a, b) => a + b, 0); // ocupa a largura útil da página
  const widths = want.map((w) => w * scale);
  const numeric = opts.numericHeaders ?? /^(valor|total|subtotal|desconto|frete|taxa|custo|receita|lucro|margem|entradas|saidas|saldo|reembolsado|itens|unidades|qtd)/i;

  let page = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;
  const drawHeader = (first: boolean) => {
    if (first) {
      page.drawText(pdfSafe(opts.title), { x: M, y: y - 14, size: 14, font: bold });
      y -= 20;
      if (opts.subtitle) { page.drawText(pdfSafe(opts.subtitle), { x: M, y: y - 10, size: 9, font, color: rgb(0.35, 0.35, 0.35) }); y -= 16; }
      y -= 6;
    }
    let x = M;
    page.drawRectangle({ x: M, y: y - rowH + 2, width: W - 2 * M, height: rowH, color: rgb(0.93, 0.93, 0.93) });
    headers.forEach((h, i) => { page.drawText(fit(h, bold, size, widths[i] - 4), { x: x + 2, y: y - size, size, font: bold }); x += widths[i]; });
    y -= rowH + 2;
  };
  const drawFooter = () => {
    page.drawText(pdfSafe(`${opts.footer ?? "Gerado pelo painel"} — página ${pageNo}`), { x: M, y: 16, size: 7, font, color: rgb(0.45, 0.45, 0.45) });
  };
  drawHeader(true);
  if (!data.length) page.drawText("Nenhum registro no período.", { x: M, y: y - size, size: 9, font });
  for (const [ri, r] of data.entries()) {
    if (y - rowH < M + 10) {
      drawFooter();
      page = doc.addPage([W, H]); pageNo++; y = H - M;
      drawHeader(false);
    }
    if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - rowH + 2, width: W - 2 * M, height: rowH, color: rgb(0.975, 0.975, 0.975) });
    let x = M;
    r.forEach((t, i) => {
      const txt = fit(t, font, size, widths[i] - 4);
      const right = numeric.test(opts.columns[i].header);
      const tx = right ? x + widths[i] - 2 - font.widthOfTextAtSize(txt, size) : x + 2;
      page.drawText(txt, { x: tx, y: y - size, size, font });
      x += widths[i];
    });
    y -= rowH;
  }
  drawFooter();
  return doc.save();
}

export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
