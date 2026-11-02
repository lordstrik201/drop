# Drop — plataforma de dropshipping nacional

Loja virtual completa para dropshipping no Brasil (pt-BR, R$, horário de Brasília):
vitrine, checkout com Mercado Pago (Pix, crédito e débito), encaminhamento de pedidos
a fornecedores (CJdropshipping por API; Dropi e fornecedores independentes por
operação manual/CSV), logística e rastreio, financeiro, CRM com LGPD, marketing,
relatórios em CSV/PDF e painel administrativo com permissões por papel.

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 · Supabase
(PostgreSQL, Auth, Storage) · Vercel · GitHub · Vitest.

## Começo rápido (desenvolvimento)

```bash
npm install
cp .env.example .env.local          # preencha DATABASE_URL e as chaves do Supabase
npm run db:migrate                  # aplica supabase/migrations em ordem
npm run db:create-admin -- --email voce@empresa.com.br
npm run dev                         # http://localhost:3000  (painel em /admin)
```

Testes (precisam de um PostgreSQL local; veja `docs/MANUTENCAO.md`):

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Visão geral, módulos, fluxo do pedido, fila de tarefas |
| [docs/DECISOES.md](docs/DECISOES.md) | Decisões técnicas e por quê |
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Supabase, Vercel, homologação e produção, passo a passo |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Rotina da loja: pedidos, fornecedores, envios, reembolsos, LGPD |
| [docs/INTEGRACOES.md](docs/INTEGRACOES.md) | O que cada integração faz, credenciais e limites |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | Papéis, RLS, dados de clientes, LGPD, segredos |
| [docs/MANUTENCAO.md](docs/MANUTENCAO.md) | Atualizações, migrations, backups, monitoramento, testes |
| [docs/CUSTOS.md](docs/CUSTOS.md) | Custos recorrentes e por venda |

## Regras de negócio que o sistema garante

- Pedido só vai ao fornecedor com **pagamento aprovado** (e, por padrão, aprovação manual no painel).
- Idempotência em pedidos, pagamentos, webhooks, encaminhamentos, e-mails e lançamentos financeiros.
- Nenhum dado de cartão passa pelo nosso servidor (Checkout Pro do Mercado Pago).
- Credenciais só em variáveis de ambiente ou cifradas no banco (AES-256-GCM), nunca no código.
- Integração sem credencial aparece como “aguardando configuração”, nunca como conectada.
- Prazos de entrega são exibidos como estimativa; nenhuma data é prometida sem confirmação.
- E-mails de marketing só com consentimento, com descadastro em um clique.
