import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/ui/color";
import { formatBRL } from "@/lib/money";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
const btn: Record<BtnVariant, string> = {
  primary: "bg-brand text-brand-contrast hover:brightness-110 shadow-sm",
  accent: "bg-accent text-ink hover:brightness-105 shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:bg-bg",
  ghost: "text-ink hover:bg-bg",
  danger: "bg-danger text-white hover:brightness-110",
};
const size = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };

export function buttonClass(variant: BtnVariant = "primary", s: keyof typeof size = "md", extra?: string) {
  return cn("inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:opacity-50 disabled:pointer-events-none", btn[variant], size[s], extra);
}

export function Button({ variant = "primary", size: s = "md", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: keyof typeof size }) {
  return <button className={buttonClass(variant, s, className)} {...p} />;
}

export function LinkButton({ href, variant = "primary", size: s = "md", className, children }: { href: string; variant?: BtnVariant; size?: keyof typeof size; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, s, className)}>
      {children}
    </Link>
  );
}

export const inputClass = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-bg";

export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor?: string; error?: string | null; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputClass, p.className)} />;
}

export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(inputClass, "h-auto min-h-24 py-2", p.className)} />;
}

export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cn(inputClass, "pr-8", p.className)} />;
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";
const toneClass: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700",
  info: "bg-sky-50 text-sky-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-700",
  brand: "bg-brand/10 text-brand",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", toneClass[tone], className)}>{children}</span>;
}

export function Price({ price, original, size: s = "md" }: { price: number; original?: number | null; size?: "sm" | "md" | "lg" }) {
  const big = { sm: "text-base", md: "text-xl", lg: "text-3xl" }[s];
  return (
    <div className="flex flex-col">
      {original && original > price && <span className="text-xs text-muted line-through">{formatBRL(original)}</span>}
      <span className={cn("font-bold tracking-tight text-ink", big)}>{formatBRL(price)}</span>
    </div>
  );
}

export function Stars({ value, count, size: s = 14 }: { value: number; count?: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Nota ${value.toFixed(1)} de 5`}>
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} size={s} className={i <= Math.round(value) ? "fill-accent text-accent" : "text-zinc-300"} aria-hidden />
        ))}
      </span>
      {count !== undefined && <span className="text-xs text-muted">({count})</span>}
    </span>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-line bg-surface", className)}>{children}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface px-6 py-14 text-center">
      <p className="text-base font-semibold">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const c = { info: "border-sky-200 bg-sky-50 text-sky-900", success: "border-emerald-200 bg-emerald-50 text-emerald-900", warning: "border-amber-200 bg-amber-50 text-amber-900", danger: "border-red-200 bg-red-50 text-red-900" }[tone];
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", c)}>{children}</div>;
}

export function Pagination({ page, total, perPage, hrefFor }: { page: number; total: number; perPage: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const nums = Array.from(new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))).sort((a, b) => a - b);
  return (
    <nav className="mt-8 flex items-center justify-center gap-1" aria-label="Paginação">
      {page > 1 && <Link className={buttonClass("secondary", "sm")} href={hrefFor(page - 1)}>Anterior</Link>}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && nums[i - 1] !== n - 1 && <span className="px-1 text-muted">…</span>}
          <Link aria-current={n === page ? "page" : undefined} className={buttonClass(n === page ? "primary" : "secondary", "sm", "min-w-8")} href={hrefFor(n)}>{n}</Link>
        </span>
      ))}
      {page < pages && <Link className={buttonClass("secondary", "sm")} href={hrefFor(page + 1)}>Próxima</Link>}
    </nav>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
