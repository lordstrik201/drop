/**
 * Teste de fumaça do painel: renderiza cada página com um administrador real
 * no banco de teste (sessão simulada) para pegar erros de SQL/renderização.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prerenderToNodeStream } from "react-dom/static";
import { closeDb, db } from "@/lib/db/client";

const state = vi.hoisted(() => ({ sub: "" }));
vi.mock("@/lib/auth/supabase", () => ({
  isAuthConfigured: () => true,
  supabaseServer: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: state.sub } }, error: null }) } }),
  AuthNotConfiguredError: class extends Error {},
}));

async function render(el: React.ReactNode) {
  const { prelude } = await prerenderToNodeStream(el);
  let html = "";
  for await (const chunk of prelude) html += chunk;
  return html;
}

let orderId = "", profileId = "", productId = "", supplierId = "";
beforeAll(async () => {
  const [u] = await db()`insert into auth.users (email) values (${`admin${Date.now()}@example.com`}) returning id`;
  await db()`update public.profiles set role = 'admin', full_name = 'Admin Teste' where id = ${u.id}`;
  state.sub = u.id;
  const [c] = await db()`insert into auth.users (email) values (${`cli${Date.now()}@example.com`}) returning id`;
  profileId = c.id;
  const [s] = await db()`insert into public.suppliers (name) values ('Forn smoke') returning id`;
  const [o] = await db()`insert into public.orders (idempotency_key, profile_id, customer_name, customer_email, shipping_address, subtotal_cents, total_cents)
    values (${"smoke-" + Date.now()}, ${c.id}, 'Cliente', 'cli@example.com', ${db().json({ recipient_name: "C", cep: "01310100", street: "R", number: "1", district: "B", city: "SP", state: "SP" })}, 1000, 1000) returning id`;
  orderId = o.id;
  supplierId = s.id;
  const [pr] = await db()`insert into public.products (name, slug, sku, supplier_id, price_cents, cost_cents) values ('Produto smoke', ${"smoke-" + Date.now()}, ${"SMK-" + Date.now()}, ${s.id}, 1000, 400) returning id`;
  productId = pr.id;
  await db()`insert into public.product_variants (product_id, sku, stock_quantity) values (${pr.id}, ${"SMK-V-" + Date.now()}, 3)`;
  await db()`insert into public.order_items (order_id, supplier_id, product_name, sku, quantity, unit_price_cents, unit_cost_cents, total_cents) values (${o.id}, ${s.id}, 'P', 'S', 1, 1000, 400, 1000)`;
  await db()`insert into public.order_status_history (order_id, to_status, source) values (${o.id}, 'pending_payment', 'checkout')`;
  await db()`insert into public.contact_messages (name, email, subject, message) values ('A', 'a@b.com', 'Dúvida', 'Olá')`;
  await db()`insert into public.privacy_requests (profile_id, email, kind) values (${c.id}, 'cli@example.com', 'correct')`;
  await db()`insert into public.app_logs (level, source, message) values ('warn', 'smoke', 'teste')`;
});
afterAll(closeDb);

const sp = (o: Record<string, string> = {}) => Promise.resolve(o);

describe("páginas do painel renderizam", () => {
  const pages: [string, () => Promise<{ default: (p: never) => Promise<React.ReactNode> }>, () => Record<string, unknown>][] = [
    ["dashboard", () => import("@/app/admin/page"), () => ({ searchParams: sp() })],
    ["pedidos", () => import("@/app/admin/pedidos/page"), () => ({ searchParams: sp({ q: "Cliente" }) })],
    ["pedido", () => import("@/app/admin/pedidos/[id]/page"), () => ({ params: Promise.resolve({ id: orderId }), searchParams: sp({ ok: "x" }) })],
    ["encaminhamento", () => import("@/app/admin/encaminhamento/page"), () => ({ searchParams: sp() })],
    ["integracoes", () => import("@/app/admin/integracoes/page"), () => ({ searchParams: sp() })],
    ["monitoramento-tarefas", () => import("@/app/admin/monitoramento/page"), () => ({ searchParams: sp() })],
    ["monitoramento-webhooks", () => import("@/app/admin/monitoramento/page"), () => ({ searchParams: sp({ aba: "webhooks" }) })],
    ["monitoramento-logs", () => import("@/app/admin/monitoramento/page"), () => ({ searchParams: sp({ aba: "logs", nivel: "warn" }) })],
    ["clientes", () => import("@/app/admin/clientes/page"), () => ({ searchParams: sp({ q: "cli", filtro: "compradores" }) })],
    ["cliente", () => import("@/app/admin/clientes/[id]/page"), () => ({ params: Promise.resolve({ id: profileId }), searchParams: sp() })],
    ["atendimento", () => import("@/app/admin/atendimento/page"), () => ({ searchParams: sp() })],
    ["atendimento-lgpd", () => import("@/app/admin/atendimento/page"), () => ({ searchParams: sp({ aba: "lgpd" }) })],
    ["avaliacoes", () => import("@/app/admin/avaliacoes/page"), () => ({ searchParams: sp() })],
    ["usuarios", () => import("@/app/admin/usuarios/page"), () => ({ searchParams: sp() })],
    ["auditoria", () => import("@/app/admin/auditoria/page"), () => ({ searchParams: sp({ acao: "order" }) })],
    ["configuracoes", () => import("@/app/admin/configuracoes/page"), () => ({ searchParams: sp() })],
    ["conteudo", () => import("@/app/admin/conteudo/page"), () => ({ searchParams: sp() })],
    ["pagina", () => import("@/app/admin/conteudo/paginas/[slug]/page"), () => ({ params: Promise.resolve({ slug: "termos-de-uso" }), searchParams: sp() })],
    ["produtos", () => import("@/app/admin/produtos/page"), () => ({ searchParams: sp({ alerta: "margem_baixa" }) })],
    ["produtos-sem-estoque", () => import("@/app/admin/produtos/page"), () => ({ searchParams: sp({ alerta: "sem_estoque", q: "smoke" }) })],
    ["produto", () => import("@/app/admin/produtos/[id]/page"), () => ({ params: Promise.resolve({ id: productId }), searchParams: sp() })],
    ["produto-novo", () => import("@/app/admin/produtos/[id]/page"), () => ({ params: Promise.resolve({ id: "novo" }), searchParams: sp() })],
    ["importar", () => import("@/app/admin/produtos/importar/page"), () => ({ searchParams: sp() })],
    ["categorias", () => import("@/app/admin/categorias/page"), () => ({ searchParams: sp() })],
    ["fornecedores", () => import("@/app/admin/fornecedores/page"), () => ({ searchParams: sp() })],
    ["fornecedor", () => import("@/app/admin/fornecedores/[id]/page"), () => ({ params: Promise.resolve({ id: supplierId }), searchParams: sp() })],
    ["fornecedor-novo", () => import("@/app/admin/fornecedores/[id]/page"), () => ({ params: Promise.resolve({ id: "novo" }), searchParams: sp() })],
    ["pagamentos", () => import("@/app/admin/pagamentos/page"), () => ({ searchParams: sp({ status: "approved" }) })],
    ["financeiro", () => import("@/app/admin/financeiro/page"), () => ({ searchParams: sp() })],
    ["financeiro-contas", () => import("@/app/admin/financeiro/page"), () => ({ searchParams: sp({ aba: "contas", situacao: "todas" }) })],
    ["financeiro-lucro", () => import("@/app/admin/financeiro/page"), () => ({ searchParams: sp({ aba: "lucro" }) })],
    ["relatorios", () => import("@/app/admin/relatorios/page"), () => ({ searchParams: sp() })],
    ["marketing", () => import("@/app/admin/marketing/page"), () => ({ searchParams: sp() })],
    ["marketing-campanhas", () => import("@/app/admin/marketing/page"), () => ({ searchParams: sp({ aba: "campanhas" }) })],
    ["marketing-carrinho", () => import("@/app/admin/marketing/page"), () => ({ searchParams: sp({ aba: "carrinho" }) })],
    ["marketing-fidelidade", () => import("@/app/admin/marketing/page"), () => ({ searchParams: sp({ aba: "fidelidade" }) })],
    ["envios", () => import("@/app/admin/envios/page"), () => ({ searchParams: sp() })],
    ["envios-todos", () => import("@/app/admin/envios/page"), () => ({ searchParams: sp({ aba: "todos", status: "posted", q: "BR" }) })],
  ];
  for (const [name, load, props] of pages) {
    it(name, async () => {
      const mod = await load();
      const html = await render(await mod.default(props() as never));
      expect(html.length).toBeGreaterThan(200);
    });
  }
  it("componentes assíncronos internos (logs) são renderizados", async () => {
    const mod = await import("@/app/admin/monitoramento/page");
    const html = await render(await mod.default({ searchParams: sp({ aba: "logs" }) } as never));
    expect(html).toContain("smoke");
  });
  it("detalhe do pedido mostra margem e ações", async () => {
    const mod = await import("@/app/admin/pedidos/[id]/page");
    const html = await render(await mod.default({ params: Promise.resolve({ id: orderId }), searchParams: sp() } as never));
    expect(html).toContain("Cancelar pedido");
    expect(html).toContain("Margem");
  });
});
