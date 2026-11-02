/**
 * Valores monetários são sempre inteiros em centavos (BRL).
 * Nunca usamos ponto flutuante para guardar ou somar dinheiro.
 */
export type Cents = number;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: Cents | null | undefined): string {
  return brl.format((cents ?? 0) / 100);
}

/** Converte texto digitado ("1.234,56", "1234.56", "R$ 10") em centavos. */
export function parseBRL(input: string | number | null | undefined): Cents {
  if (input === null || input === undefined || input === "") return 0;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("Valor inválido");
    return Math.round(input * 100);
  }
  let s = input.replace(/[R$\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Valor monetário inválido: ${input}`);
  const [int, dec = ""] = s.split(".");
  const sign = int.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(parseInt(int, 10)) * 100 + parseInt(dec.padEnd(2, "0"), 10));
}

export function assertCents(v: unknown, field = "valor"): Cents {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${field} deve ser inteiro em centavos`);
  return v;
}

/** Percentual em pontos base (1% = 100 bps) aplicado a centavos, com arredondamento bancário. */
export function applyBps(cents: Cents, bps: number): Cents {
  return roundHalfEven((cents * bps) / 10000);
}

export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}

/** Divide um total entre partes proporcionais sem perder centavos. */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k].i] += 1;
  return out;
}
