import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getSetting } from "@/lib/settings";
import { recoveryStats } from "@/lib/marketing/abandoned";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { Flash, Section, Stat, Table, td } from "@/components/admin/ui";
import { formatBRL } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/ui/dates";
import { campaignStatusAction, saveCampaignAction, saveCouponAction, toggleCouponAction } from "./actions";

export const metadata = { title: "Marketing" };
type SP = { aba?: string; editar?: string; ok?: string; erro?: string };
const TABS = [["cupons", "Cupons"], ["campanhas", "Campanhas de desconto"], ["carrinho", "Carrinho abandonado"], ["fidelidade", "Fidelidade"]] as const;
const pct = (bps: number) => `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const brl = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
const ymd = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d) : "");

export default async function MarketingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaffPage("marketing.write");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.aba) ? sp.aba! : "cupons";
  const edit = sp.editar && /^[0-9a-f-]{36}$/i.test(sp.editar) ? sp.editar : null;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Marketing</h1>
        <p className="text-sm text-muted">Cupons, descontos automáticos, lembrete de carrinho e fidelidade. Banners ficam em Páginas e banners. Nenhum anúncio pago é ativado por aqui.</p>
      </div>
      <Flash msg={sp.ok} error={sp.erro} />
      <nav className="flex flex-wrap gap-2 text-sm">
        {TABS.map(([k, label]) => <Link key={k} href={`/admin/marketing?aba=${k}`} className={`rounded-lg px-3 py-1.5 ${tab === k ? "bg-ink text-white" : "border border-line"}`}>{label}</Link>)}
      </nav>
      {tab === "cupons" && <Coupons edit={edit} />}
      {tab === "campanhas" && <Campaigns edit={edit} />}
      {tab === "carrinho" && <Abandoned />}
      {tab === "fidelidade" && <Loyalty />}
    </div>
  );
}

type CouponRow = {
  id: string; code: string; description: string | null; kind: "percent" | "fixed" | "free_shipping"; value: number; max_discount_cents: number | null;
  min_subtotal_cents: number; max_uses: number | null; max_uses_per_customer: number | null; used_count: number; first_order_only: boolean;
  returning_customers_only: boolean; starts_at: Date | null; ends_at: Date | null; is_active: boolean; discount: number; orders: number;
};

async function Coupons({ edit }: { edit: string | null }) {
  const rows = await db()<CouponRow[]>`
    select c.*, coalesce(sum(r.discount_cents) filter (where o.paid_at is not null), 0)::int as discount,
           count(r.id) filter (where o.paid_at is not null)::int as orders
    from public.coupons c left join public.coupon_redemptions r on r.coupon_id = c.id left join public.orders o on o.id = r.order_id
    where c.origin = 'admin' group by c.id order by c.is_active desc, c.created_at desc limit 200`;
  const cur = edit ? rows.find((r) => r.id === edit) : undefined;
  const now = new Date();
  const describe = (c: CouponRow) => c.kind === "percent" ? `${pct(c.value)}${c.max_discount_cents ? ` (até ${formatBRL(c.max_discount_cents)})` : ""}` : c.kind === "fixed" ? formatBRL(c.value) : "Frete grátis";
  return (
    <>
      <Section title="Cupons">
        <Table head={["Código", "Desconto", "Regras", "Validade", "Usos (pagos)", "Desconto concedido", "Situação", ""]} empty="Nenhum cupom criado.">
          {rows.map((c) => {
            const expired = c.ends_at && new Date(c.ends_at) <= now;
            return (
              <tr key={c.id} className="border-t border-line">
                <td className={td}><span className="font-mono font-semibold">{c.code}</span>{c.description && <div className="text-xs text-muted">{c.description}</div>}</td>
                <td className={td}>{describe(c)}</td>
                <td className={`${td} text-xs`}>
                  {c.min_subtotal_cents > 0 && <div>mínimo {formatBRL(c.min_subtotal_cents)}</div>}
                  {c.first_order_only && <div>só 1ª compra</div>}
                  {c.returning_customers_only && <div>só clientes antigos</div>}
                  {c.max_uses_per_customer && <div>{c.max_uses_per_customer}× por cliente</div>}
                </td>
                <td className={`${td} text-xs`}>{c.starts_at ? `de ${formatDate(c.starts_at)} ` : ""}{c.ends_at ? `até ${formatDate(c.ends_at)}` : "sem prazo"}</td>
                <td className={td}>{c.orders}{c.max_uses ? ` / ${c.max_uses}` : ""}</td>
                <td className={td}>{formatBRL(c.discount)}</td>
                <td className={td}>{!c.is_active ? <Badge>Inativo</Badge> : expired ? <Badge tone="warning">Expirado</Badge> : <Badge tone="success">Ativo</Badge>}</td>
                <td className={td}>
                  <div className="flex gap-1">
                    <Link href={`/admin/marketing?aba=cupons&editar=${c.id}#form`} className="rounded-lg px-2 py-1 text-sm hover:bg-bg">Editar</Link>
                    <form action={toggleCouponAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.is_active ? "0" : "1"} /><Button size="sm" variant="ghost">{c.is_active ? "Desativar" : "Ativar"}</Button></form>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Section>
      <Section title={cur ? `Editar cupom ${cur.code}` : "Novo cupom"} actions={cur ? <Link href="/admin/marketing?aba=cupons" className="text-sm text-muted">Cancelar edição</Link> : undefined}>
        <form id="form" action={saveCouponAction} className="grid gap-3 md:grid-cols-4" key={cur?.id ?? "novo"}>
          {cur && <input type="hidden" name="id" value={cur.id} />}
          <Field label="Código"><Input name="code" required defaultValue={cur?.code} placeholder="BEMVINDO10" className="uppercase" /></Field>
          <Field label="Tipo"><Select name="kind" defaultValue={cur?.kind ?? "percent"}><option value="percent">Percentual</option><option value="fixed">Valor fixo (R$)</option><option value="free_shipping">Frete grátis</option></Select></Field>
          <Field label="Valor (% ou R$)" hint="Ignorado para frete grátis"><Input name="value" inputMode="decimal" defaultValue={cur ? (cur.kind === "percent" ? String(cur.value / 100).replace(".", ",") : brl(cur.value)) : ""} /></Field>
          <Field label="Desconto máximo (R$)" hint="Só para percentual"><Input name="max_discount" inputMode="decimal" defaultValue={brl(cur?.max_discount_cents ?? null)} /></Field>
          <Field label="Pedido mínimo (R$)"><Input name="min_subtotal" inputMode="decimal" defaultValue={brl(cur?.min_subtotal_cents ?? 0)} /></Field>
          <Field label="Limite total de usos"><Input name="max_uses" type="number" min={1} defaultValue={cur?.max_uses ?? ""} /></Field>
          <Field label="Usos por cliente"><Input name="max_uses_per_customer" type="number" min={1} defaultValue={cur?.max_uses_per_customer ?? 1} /></Field>
          <Field label="Público"><Select name="audience" defaultValue={cur?.first_order_only ? "first" : cur?.returning_customers_only ? "returning" : "all"}><option value="all">Todos</option><option value="first">Só primeira compra</option><option value="returning">Só quem já comprou</option></Select></Field>
          <Field label="Início"><Input name="starts_at" type="date" defaultValue={ymd(cur?.starts_at ?? null)} /></Field>
          <Field label="Fim (inclusive)"><Input name="ends_at" type="date" defaultValue={ymd(cur?.ends_at ?? null)} /></Field>
          <Field label="Descrição interna" className="md:col-span-2"><Input name="description" maxLength={200} defaultValue={cur?.description ?? ""} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={cur ? cur.is_active : true} /> Ativo</label>
          <div className="flex items-end md:col-span-3"><Button size="sm">{cur ? "Salvar cupom" : "Criar cupom"}</Button></div>
        </form>
      </Section>
    </>
  );
}

type CampaignRow = { id: string; name: string; description: string | null; discount_bps: number; category_id: string | null; product_id: string | null; utm_campaign: string | null; starts_at: Date | null; ends_at: Date | null; is_active: boolean; target: string | null };

async function Campaigns({ edit }: { edit: string | null }) {
  const sql = db();
  const [rows, categories, products] = await Promise.all([
    sql<CampaignRow[]>`
      select c.*, coalesce((select name from public.categories where id = c.category_id), (select name from public.products where id = c.product_id)) as target
      from public.campaigns c order by c.is_active desc, c.created_at desc limit 200`,
    sql<{ id: string; name: string }[]>`select id, name from public.categories order by name`,
    sql<{ id: string; name: string }[]>`select id, name from public.products where status <> 'archived' order by name limit 1000`,
  ]);
  const cur = edit ? rows.find((r) => r.id === edit) : undefined;
  const now = new Date();
  return (
    <>
      <Section title="Campanhas de desconto automático">
        <p className="mb-3 text-sm text-muted">O desconto aparece no preço da vitrine e vale no checkout. Se mais de uma campanha cobrir o produto, vale a maior. Confira a margem antes de ativar.</p>
        <Table head={["Campanha", "Desconto", "Alcance", "Período", "Situação", ""]} empty="Nenhuma campanha criada.">
          {rows.map((c) => {
            const live = c.is_active && (!c.starts_at || new Date(c.starts_at) <= now) && (!c.ends_at || new Date(c.ends_at) > now);
            return (
              <tr key={c.id} className="border-t border-line">
                <td className={td}><span className="font-semibold">{c.name}</span>{c.utm_campaign && <div className="text-xs text-muted">utm_campaign={c.utm_campaign}</div>}</td>
                <td className={td}>{pct(c.discount_bps)}</td>
                <td className={td}>{c.category_id ? `Categoria: ${c.target}` : c.product_id ? `Produto: ${c.target}` : "Loja toda"}</td>
                <td className={`${td} text-xs`}>{c.starts_at ? formatDateTime(c.starts_at) : "agora"} → {c.ends_at ? formatDateTime(c.ends_at) : "sem fim"}</td>
                <td className={td}>{live ? <Badge tone="success">No ar</Badge> : c.is_active ? <Badge tone="warning">Agendada/encerrada</Badge> : <Badge>Pausada</Badge>}</td>
                <td className={td}>
                  <div className="flex gap-1">
                    <Link href={`/admin/marketing?aba=campanhas&editar=${c.id}#form`} className="rounded-lg px-2 py-1 text-sm hover:bg-bg">Editar</Link>
                    <form action={campaignStatusAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="op" value={c.is_active ? "pause" : "activate"} /><Button size="sm" variant="ghost">{c.is_active ? "Pausar" : "Ativar"}</Button></form>
                    {!c.is_active && <form action={campaignStatusAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="op" value="delete" /><Button size="sm" variant="ghost">Excluir</Button></form>}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Section>
      <Section title={cur ? `Editar ${cur.name}` : "Nova campanha"} actions={cur ? <Link href="/admin/marketing?aba=campanhas" className="text-sm text-muted">Cancelar edição</Link> : undefined}>
        <form id="form" action={saveCampaignAction} className="grid gap-3 md:grid-cols-4" key={cur?.id ?? "nova"}>
          {cur && <input type="hidden" name="id" value={cur.id} />}
          <Field label="Nome" className="md:col-span-2"><Input name="name" required maxLength={120} defaultValue={cur?.name} /></Field>
          <Field label="Desconto (%)"><Input name="discount" required inputMode="decimal" defaultValue={cur ? String(cur.discount_bps / 100).replace(".", ",") : ""} /></Field>
          <Field label="Alcance"><Select name="scope" defaultValue={cur?.category_id ? "category" : cur?.product_id ? "product" : "all"}><option value="all">Loja toda</option><option value="category">Uma categoria</option><option value="product">Um produto</option></Select></Field>
          <Field label="Categoria" hint="Se o alcance for categoria"><Select name="category_id" defaultValue={cur?.category_id ?? ""}>{[<option key="" value="">—</option>, ...categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)]}</Select></Field>
          <Field label="Produto" hint="Se o alcance for produto"><Select name="product_id" defaultValue={cur?.product_id ?? ""}>{[<option key="" value="">—</option>, ...products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</Select></Field>
          <Field label="Início"><Input name="starts_at" type="datetime-local" defaultValue={cur?.starts_at ? `${ymd(cur.starts_at)}T${new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(cur.starts_at)}` : ""} /></Field>
          <Field label="Fim"><Input name="ends_at" type="date" defaultValue={ymd(cur?.ends_at ?? null)} /></Field>
          <Field label="utm_campaign (opcional)"><Input name="utm_campaign" maxLength={60} defaultValue={cur?.utm_campaign ?? ""} /></Field>
          <Field label="Descrição interna" className="md:col-span-2"><Input name="description" maxLength={500} defaultValue={cur?.description ?? ""} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={cur?.is_active ?? false} /> Ativar</label>
          <div className="flex items-end md:col-span-4"><Button size="sm">{cur ? "Salvar campanha" : "Criar campanha"}</Button></div>
        </form>
      </Section>
    </>
  );
}

async function Abandoned() {
  const [cfg, stats, recent, consent] = await Promise.all([
    getSetting("marketing"),
    recoveryStats(30),
    db()<{ recipient: string; status: string; error: string | null; created_at: Date }[]>`
      select recipient, status, error, created_at from public.notifications where template = 'cart_recovery' order by created_at desc limit 30`,
    db()<{ n: number }[]>`select count(*)::int as n from public.profiles where marketing_consent and role = 'customer'`,
  ]);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Situação" value={<span className="text-base">{cfg.abandoned_cart_enabled ? "Ativo" : "Desligado"}</span>} hint={`após ${cfg.abandoned_cart_delay_hours} h sem atividade`} />
        <Stat label="Lembretes (30 dias)" value={stats.reminded} />
        <Stat label="Recuperados" value={stats.recovered} hint={formatBRL(stats.recovered_cents) + " em pedidos pagos"} />
        <Stat label="Clientes com consentimento" value={consent[0].n} hint="únicos que podem receber" />
      </div>
      <Section title="Como funciona" actions={<Link href="/admin/configuracoes#marketing" className="text-sm text-brand underline">Configurar</Link>}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Só clientes com conta que marcaram “aceito receber ofertas” recebem o lembrete (base legal: consentimento, LGPD).</li>
          <li>Um único e-mail por carrinho, com link para voltar ao carrinho e link de descadastro em um clique.</li>
          <li>O e-mail avisa que preço e estoque podem mudar; nenhum prazo de entrega é prometido.</li>
          <li>Requer o provedor de e-mail (Resend) configurado em Integrações.</li>
        </ul>
      </Section>
      <Section title="Últimos lembretes">
        <Table head={["Quando", "Para", "Situação"]} empty="Nenhum lembrete enviado ainda.">
          {recent.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <td className={td}>{formatDateTime(r.created_at)}</td>
              <td className={td}>{r.recipient}</td>
              <td className={td}>{r.status === "sent" ? <Badge tone="success">Enviado</Badge> : <Badge tone="danger">Falhou</Badge>}{r.error && <div className="text-xs text-muted">{r.error}</div>}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}

async function Loyalty() {
  const [cfg, totals, top] = await Promise.all([
    getSetting("loyalty"),
    db()<{ points: number; members: number; redeemed: number }[]>`
      select coalesce(sum(points), 0)::int as points, count(distinct profile_id)::int as members,
             coalesce(-sum(points) filter (where dedupe_key like 'redeem:%'), 0)::int as redeemed
      from public.loyalty_ledger`,
    db()<{ email: string; full_name: string | null; points: number }[]>`
      select p.email, p.full_name, sum(l.points)::int as points from public.loyalty_ledger l join public.profiles p on p.id = l.profile_id
      group by p.id having sum(l.points) > 0 order by points desc limit 20`,
  ]);
  const t = totals[0];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Programa" value={<span className="text-base">{cfg.enabled ? "Ativo" : "Desligado"}</span>} hint={`${cfg.points_per_real} ponto(s) por R$ · ponto = ${formatBRL(cfg.cents_per_point)}`} />
        <Stat label="Pontos em aberto" value={t.points} hint={`passivo de ${formatBRL(t.points * cfg.cents_per_point)}`} tone={t.points ? "warning" : undefined} />
        <Stat label="Clientes com pontos" value={t.members} />
        <Stat label="Pontos trocados" value={t.redeemed} />
      </div>
      <Section title="Regras" actions={<Link href="/admin/configuracoes#loyalty" className="text-sm text-brand underline">Configurar</Link>}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Pontos são creditados quando o pedido é marcado como entregue, sobre o valor pago menos reembolsos.</li>
          <li>Se o pedido for reembolsado ou cancelado depois, os pontos são estornados.</li>
          <li>O cliente troca a partir de {cfg.min_redeem_points} pontos, em Minha conta, por um cupom pessoal válido por {cfg.coupon_valid_days} dias.</li>
        </ul>
      </Section>
      <Section title="Maiores saldos">
        <Table head={["Cliente", "Pontos", "Valor"]} empty="Ninguém tem pontos ainda.">
          {top.map((r) => (
            <tr key={r.email} className="border-t border-line">
              <td className={td}>{r.full_name ?? r.email}<div className="text-xs text-muted">{r.email}</div></td>
              <td className={td}>{r.points}</td>
              <td className={td}>{formatBRL(r.points * cfg.cents_per_point)}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </>
  );
}
