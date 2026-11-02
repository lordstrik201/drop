const TZ = "America/Sao_Paulo";

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { timeZone: TZ });
}

/** Início do dia em São Paulo (UTC-3, sem horário de verão desde 2019) para filtros por data. */
export function spDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00-03:00`);
}

export function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
