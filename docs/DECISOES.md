# Decisões técnicas

Cada decisão traz o motivo. Mudanças de arquitetura devem ser registradas aqui antes de implementadas.

## Acesso a dados
O servidor acessa o PostgreSQL do Supabase diretamente com **postgres.js** (pooler em modo
Transaction, `prepare: false`), e não pela API REST do Supabase. Motivo: o fluxo de pedido precisa
de transações, `SELECT … FOR UPDATE` (estoque, cupom, saldo de pontos) e `SKIP LOCKED` (fila).
A autorização fica no código (RBAC) e o RLS do banco bloqueia o acesso direto pela chave pública.

## Cache Components
`cacheComponents` desativado e páginas dinâmicas. Quase tudo depende de sessão, carrinho e estoque
em tempo real; renderização dinâmica é mais previsível para um sistema transacional.

## Pagamento: Checkout Pro do Mercado Pago
O cliente paga na página oficial do Mercado Pago. Nenhum dado de cartão passa pelo nosso servidor
(fora do escopo PCI), e Pix, crédito e débito ficam disponíveis sem formulário próprio. O status do
pedido só muda pela consulta ao pagamento na API (o conteúdo do webhook não é confiável sozinho).

## Aprovação manual antes do fornecedor
Padrão seguro: todo pedido pago aguarda aprovação no painel antes de ir ao fornecedor. A
automação pode ser ligada em Configurações, e fornecedores marcados com “exige aprovação” sempre aguardam.

## CJdropshipping: pedido sem pagamento automático
Pedidos são criados com `payType = 3` (sem débito automático). O lojista confere e paga no painel
da CJ, evitando compras reais sem revisão humana. Custos em USD usam a cotação informada pelo lojista
no cadastro do fornecedor (o sistema não inventa câmbio).

## CJdropshipping: rastreio
A documentação oficial só exemplifica o status “In transit”. Esse status atualiza o envio; os demais
textos são registrados como eventos, e a entrega é confirmada pela equipe.

## Dropi e fornecedores sem API
A Dropi não publica documentação de API aberta. Esses fornecedores operam pela fila de
encaminhamento manual (copiar dados ou exportar CSV) e por importação CSV de produtos e estoque.

## Sincronização não altera preço de venda
Mudança de custo vinda do fornecedor gera alerta de margem; o preço é decisão do lojista.

## Fila de tarefas no PostgreSQL
Nenhum serviço pago de filas: tabela `jobs` com `SKIP LOCKED`, tentativas com espera crescente e
idempotência. O disparo a cada 5 minutos usa `pg_cron` + `pg_net` do Supabase (sem custo extra),
porque o cron da Vercel no plano Hobby é diário.

## Imagens sem otimizador
`images.unoptimized`: imagens de fornecedores vêm de muitos domínios. Liberar todos no otimizador
criaria um proxy aberto e custo por transformação.

## Relatórios em PDF com pdf-lib
Biblioteca JavaScript pura, gratuita e sem navegador headless (que não cabe bem em funções
serverless). Usa a fonte Helvetica padrão, que cobre os acentos do português.

## Carrinho abandonado só com consentimento
Lembretes são marketing: só para clientes com conta que marcaram o consentimento (LGPD art. 7º, I),
uma vez por carrinho, com descadastro em um clique e o cabeçalho `List-Unsubscribe`.

## Fidelidade por cupom pessoal
Os pontos viram um cupom de valor fixo, de uso único e válido só para o e-mail do cliente. Isso
reaproveita a validação de cupons do checkout, sem mexer no cálculo do pedido nem no pagamento.
Pontos entram na entrega (não no pagamento) e são estornados se houver reembolso.

## Região
Funções na Vercel em `gru1` (São Paulo). O projeto Supabase deve ficar em `sa-east-1` (São Paulo)
para reduzir a latência entre aplicação e banco.
