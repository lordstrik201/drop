import { describe, it, expect } from "vitest";
import { toCSV, parseCSV, csvCell, centsCell } from "@/lib/reports/csv";

describe("csv", () => {
  it("escapa aspas, separador e quebra de linha", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell("linha1\nlinha2")).toBe('"linha1\nlinha2"');
  });
  it("neutraliza fórmulas, mas não números negativos", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-12,50")).toBe("-12,50");
  });
  it("gera e lê de volta (ida e volta)", () => {
    const rows = [{ a: "x;y", b: 'q"t' }, { a: "ç ã", b: "multi\nlinha" }];
    const out = toCSV(rows, [{ header: "A", value: (r) => r.a }, { header: "B", value: (r) => r.b }]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(parseCSV(out)).toEqual([["A", "B"], ["x;y", 'q"t'], ["ç ã", "multi\nlinha"]]);
  });
  it("detecta separador vírgula", () => {
    expect(parseCSV("sku,preco\r\nA1,\"10,5\"\n\n")).toEqual([["sku", "preco"], ["A1", "10,5"]]);
  });
  it("centavos em formato brasileiro", () => {
    expect(centsCell(123456)).toBe("1234,56");
    expect(centsCell(-5)).toBe("-0,05");
  });
});
