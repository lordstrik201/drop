# Arquitetura

## Visão geral

```
Cliente (navegador) ──► Vercel (Next.js 16, região gru1/São Paulo)
                          ├─ Loja (App Router, renderização dinâmica no servidor)
                          ├─ Painel /admin (Server Components + Server Actions, RBAC)
                          ├─ /api/webhooks/mercadopago  (assinatura HMAC validada)
                          ├─ /api/cron/jobs             (fila de tarefas, exige CRON_SECRET)
                          └─ /api/conta/exportar, /api/cep/[cep]
                                │
                                ▼
Supabase ── PostgreSQL (dados, fila de tarefas, razão financeiro, auditoria, RLS)
        ── Auth (login, cadastro, recuperação de senha)
        ── Storage (bucket público "public-media" para imagens de produto)

Serviços externos (opcionais, ativados por credencial):
  Mercado Pago (Checkout Pro) · Melhor Envio (cotação) · CJdropshipping (API 2.0)
  Resend (e-mail) · Dropi e fornecedores independentes (manual/CSV)
```

O servidor acessa o banco diretamente (postgres.js, conexão pelo pooler do Supabase) e aplica
as regras de autorização no código (`src/lib/auth/rbac.ts`). As políticas RLS do banco são
defesa em profundidade: pela API pública do Supabase (chave anon) só é possível ler o catálogo
publicado e os dados do próprio cliente.

## Módulos (`src/lib`)

| Pasta | Responsabilidade |
|---|---|
| `auth` | Sessão (Supabase Auth), papéis e permissões |
| `catalog` | Produtos, variações, categorias, preços, importação CSV |
| `cart` | Carrinho (cookie), totais, cupons |
| `orders` | Criação do pedido (idempotente), máquina de estados, ações do painel |
| `payments` | Checkout Pro, webhook, sincronização e reembolso no Mercado Pago |
| `fulfillment` | Encaminhamento ao fornecedor (API ou manual), aprovação, fila |
| `suppliers` + `integrations/suppliers` | Cadastro, sincronização de custo/estoque, adaptadores (CJ, manual) |
| `shipping` | Cotação de frete, rastreio automático (CJ), alertas de atraso |
| `finance` | Razão financeiro, contas a pagar/receber, DRE, caixa, lucro |
| `marketing` | Cupons, campanhas, carrinho abandonado (com consentimento), fidelidade |
| `customers` | LGPD: exportação e anonimização |
| `reports` | Painel, relatórios CSV e PDF |
| `jobs` | Fila de tarefas em PostgreSQL |
| `notifications` | E-mails transacionais (Resend) |
| `settings` | Configurações da loja (tabela `settings`) |
| `security` | Criptografia, rate limit, autenticação do cron |

## Fluxo do pedido

```
pending_payment ─► paid ─► awaiting_supplier ─► sent_to_supplier ─► preparing ─► shipped ─► in_transit ─► delivered
       │             │                                                                                    │
       └► canceled   └► refunded / under_review (em qualquer etapa, por regra de pagamento ou manual) ◄───┘
```

1. **Checkout**: o pedido é criado com chave de idempotência (clique duplo não duplica), estoque
   reservado e cupom validado dentro de uma transação. O cliente é levado ao Mercado Pago.
2. **Pagamento**: o webhook (assinatura validada) dispara a consulta do pagamento na API do
   Mercado Pago; só o status consultado na API muda o pedido. Pedido não pago expira e devolve o estoque.
3. **Aprovado**: lança no razão a receita, a taxa e os custos *previstos*; cria um pedido por
   fornecedor. Por padrão cada um fica em **aguardando aprovação** no painel (Encaminhamento).
4. **Encaminhamento**: CJ por API (pedido criado sem pagamento automático; o lojista paga no painel
   da CJ). Dropi e independentes: dados prontos para copiar ou exportar em CSV. O custo previsto vira realizado.
5. **Envio**: rastreio lançado no pedido (ou vindo da CJ); o cliente é avisado por e-mail.
   Para a CJ o rastreio é consultado automaticamente; a entrega é confirmada pela equipe.
6. **Pós-venda**: reembolso total ou parcial pelo painel (via API do Mercado Pago), avaliações,
   pontos de fidelidade na entrega.

## Fila de tarefas

Tabela `jobs` com `FOR UPDATE SKIP LOCKED`, tentativas com espera crescente e chave de
idempotência por tarefa. O endpoint `/api/cron/jobs` processa a fila e agenda as rotinas:

| Tarefa | Frequência | O que faz |
|---|---|---|
| `orders.expire` | 15 min | Cancela pedidos não pagos vencidos e devolve estoque |
| `payment.sync` | sob demanda | Consulta pagamento no Mercado Pago (webhook/conciliação) |
| `supplier.forward` | sob demanda | Envia pedido aprovado ao fornecedor com API |
| `notify.order` | sob demanda | E-mail transacional do pedido |
| `suppliers.sync_all` / `supplier.sync` | diária | Custo e estoque da CJ (nunca muda o preço de venda) |
| `shipments.track` | horária | Rastreio CJ em lote |
| `logistics.alerts` | diária | Resumo de atrasos no log do sistema |
| `carts.abandoned` | horária | Lembrete de carrinho (só com consentimento; desligado por padrão) |
| `loyalty.award` | horária | Pontos de pedidos entregues e estornos (desligado por padrão) |

Tarefas lentas (sincronização e rastreio da CJ, limitadas a ~1 requisição/s pela API) rodam uma
por execução. O agendamento a cada 5 minutos é feito pelo `pg_cron` do Supabase
(`scripts/sql/agendamento-supabase.sql`); o `vercel.json` mantém uma execução diária de segurança.

## Dinheiro e datas

- Valores em **centavos inteiros**; percentuais em pontos-base (1% = 100).
- Datas gravadas em UTC (`timestamptz`), exibidas e filtradas em `America/Sao_Paulo`.
- O razão (`financial_entries`) tem uma chave única por lançamento: reprocessar um webhook não duplica valores.
