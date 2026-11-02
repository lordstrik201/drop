import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { Badge, Button, Stars } from "@/components/ui";
import { Flash } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/ui/dates";
import { moderateReviewAction } from "./actions";

export const metadata = { title: "Avaliações" };
const TABS = [["pending", "Para moderar"], ["approved", "Publicadas"], ["rejected", "Recusadas"]] as const;

export default async function ReviewsAdmin({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string; erro?: string }> }) {
  await requireStaffPage("reviews.moderate");
  const sp = await searchParams;
  const status = TABS.some(([k]) => k === sp.status) ? sp.status! : "pending";
  const sql = db();
  const [rows, counts] = await Promise.all([
    sql<{ id: string; author_name: string; rating: number; title: string | null; body: string | null; verified_purchase: boolean; created_at: Date; product_name: string; product_slug: string }[]>`
      select r.id, r.author_name, r.rating, r.title, r.body, r.verified_purchase, r.created_at, p.name as product_name, p.slug as product_slug
      from public.reviews r join public.products p on p.id = r.product_id where r.status = ${status} order by r.created_at desc limit 100`,
    sql<{ status: string; n: number }[]>`select status, count(*)::int as n from public.reviews group by status`,
  ]);
  const n = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Avaliações</h1>
        <p className="text-sm text-muted">Só clientes com pedido entregue podem avaliar. Nenhuma avaliação é publicada sem moderação.</p>
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      <nav className="flex gap-1 border-b border-line text-sm">
        {TABS.map(([k, l]) => <Link key={k} href={`/admin/avaliacoes?status=${k}`} className={`-mb-px border-b-2 px-3 py-2 ${status === k ? "border-brand font-semibold" : "border-transparent text-muted hover:text-ink"}`}>{l} ({n[k] ?? 0})</Link>)}
      </nav>
      {rows.length === 0 && <p className="py-8 text-center text-sm text-muted">Nada por aqui.</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Stars value={r.rating} /> <strong>{r.title ?? "(sem título)"}</strong></span>
              <span className="text-xs text-muted">{formatDateTime(r.created_at)}</span>
            </div>
            <p className="mt-1 text-xs text-muted">{r.author_name} {r.verified_purchase && <Badge tone="success">compra verificada</Badge>} · <Link href={`/produto/${r.product_slug}`} target="_blank" className="underline">{r.product_name}</Link></p>
            {r.body && <p className="mt-2 whitespace-pre-wrap text-sm">{r.body}</p>}
            <div className="mt-3 flex gap-2">
              {(status === "pending" ? ["approved", "rejected"] : status === "approved" ? ["rejected"] : ["approved"]).map((to) => (
                <form key={to} action={moderateReviewAction}>
                  <input type="hidden" name="reviewId" value={r.id} /><input type="hidden" name="status" value={to} /><input type="hidden" name="tab" value={status} />
                  <Button size="sm" variant={to === "approved" ? "primary" : "secondary"}>{to === "approved" ? "Publicar" : "Recusar"}</Button>
                </form>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
