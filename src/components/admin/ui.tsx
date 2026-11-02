import Link from "next/link";
import { cn } from "@/lib/ui/color";
import { nowMs } from "@/lib/ui/dates";

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "danger" | "warning" | "success" }) {
  const t = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tracking-tight tabular-nums", t)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: string | false }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-bg/60 text-left text-xs uppercase tracking-wide text-muted">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-10 text-center text-sm text-muted">{empty}</p>}
    </div>
  );
}

export const td = "px-3 py-2.5 align-middle";

export function DateRangeFilter({ path, from, to, extra }: { path: string; from: string; to: string; extra?: React.ReactNode }) {
  const presets = [7, 30, 90];
  return (
    <form method="get" action={path} className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs text-muted">De<input type="date" name="de" defaultValue={from} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" /></label>
      <label className="flex flex-col gap-1 text-xs text-muted">Até<input type="date" name="ate" defaultValue={to} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink" /></label>
      {extra}
      <button className="h-9 rounded-lg bg-brand px-3 font-semibold text-brand-contrast">Filtrar</button>
      <span className="flex gap-1">
        {presets.map((d) => {
          const end = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
          const start = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(nowMs() - (d - 1) * 86400000));
          return <Link key={d} href={`${path}?de=${start}&ate=${end}`} className="flex h-9 items-center rounded-lg border border-line px-2.5 text-xs hover:bg-bg">{d} dias</Link>;
        })}
      </span>
    </form>
  );
}

/** Gráfico de barras de série única (faturamento por dia), com dica ao passar o mouse e tabela alternativa. */
export function BarChart({ data, format, label }: { data: { x: string; y: number }[]; format: (v: number) => string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.y));
  const W = 720, H = 200, pad = 28, gap = 2;
  const bw = Math.max(2, (W - pad) / Math.max(data.length, 1) - gap);
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full" role="img" aria-label={label}>
        {ticks.map((t) => {
          const y = H - (t / max) * (H - 10);
          return <g key={t}><line x1={pad} x2={W} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} /><text x={0} y={y + 4} fontSize={10} fill="var(--muted)">{t >= 100000 ? `${Math.round(t / 100000)}k` : Math.round(t / 100)}</text></g>;
        })}
        {data.map((d, i) => {
          const h = (d.y / max) * (H - 10);
          const x = pad + i * (bw + gap);
          return (
            <g key={d.x} className="group">
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent"><title>{`${d.x.split("-").reverse().join("/")}: ${format(d.y)}`}</title></rect>
              {d.y > 0 && <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(4, bw / 2)} fill="var(--brand)" className="pointer-events-none group-hover:opacity-80"><title>{`${d.x.split("-").reverse().join("/")}: ${format(d.y)}`}</title></rect>}
            </g>
          );
        })}
        {data.length > 0 && [0, Math.floor(data.length / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={pad + i * (bw + gap) + bw / 2} y={H + 16} fontSize={10} fill="var(--muted)" textAnchor="middle">{data[i].x.slice(8, 10)}/{data[i].x.slice(5, 7)}</text>
        ))}
      </svg>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Ver como tabela</summary>
        <table className="mt-2 w-full max-w-sm"><tbody>{data.map((d) => <tr key={d.x}><td className="py-0.5">{d.x.split("-").reverse().join("/")}</td><td className="text-right tabular-nums">{format(d.y)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

export function Flash({ msg, error }: { msg?: string; error?: string }) {
  if (!msg && !error) return null;
  return <div role={error ? "alert" : "status"} className={cn("mb-4 rounded-lg border px-4 py-3 text-sm", error ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")}>{error ?? msg}</div>;
}
