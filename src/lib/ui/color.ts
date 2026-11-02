function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Escolhe texto branco ou escuro com maior contraste (WCAG) sobre a cor da marca. */
export function readableTextOn(hex: string): string {
  const L = luminance(hex);
  const dark = luminance("#111827");
  const vsWhite = 1.05 / (L + 0.05);
  const vsDark = (L + 0.05) / (dark + 0.05);
  return vsWhite >= vsDark ? "#ffffff" : "#111827";
}

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
