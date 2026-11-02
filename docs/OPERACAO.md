# Operação da loja

Rotina sugerida e onde cada coisa fica no painel (`/admin`). Toda ação relevante fica na
**Auditoria** com usuário, data e IP.

## Todos os dias

1. **Dashboard**: vendas, pedidos aguardando ação e alertas.
2. **Encaminhamento**: pedidos pagos aguardando aprovação.
   - Confira o pedido (endereço, itens, margem) e clique em **Aprovar**.
   - **CJ**: o pedido é criado na CJ **sem pagamento automático**. Entre no painel da CJ, confira e pague.
   - **Dropi e independentes**: copie os dados ou baixe o CSV da fila, faça o pedido no fornecedor e
     clique em **Registrar envio manual**, com o número do pedido dele.
   - Falhas aparecem em vermelho com o motivo, e dá para reenviar.
3. **Envios e rastreio**: alertas de pedido pago sem rastreio, rastreio parado, prazo vencido ou
   problema na entrega. Lance o código no pedido (Pedido → Envios) assim que o fornecedor informar.
   O cliente recebe um e-mail com o rastreio. Para a CJ o rastreio é consultado sozinho; confirme a
   entrega no pedido quando a transportadora indicar.
4. **Atendimento**: mensagens do formulário de contato e pedidos de titulares (LGPD).
5. **Pagamentos**: pendências de conciliação (aprovado com pedido cancelado, em análise, estorno
   com falha, contestação). Use **Reconciliar** se suspeitar que algum aviso do Mercado Pago se perdeu.

## Toda semana

- **Produtos**: filtros de margem baixa, sem estoque e custo alterado pelo fornecedor. A
  sincronização da CJ atualiza custo e estoque, mas **nunca** muda o preço de venda.
- **Financeiro**: resultado do período, contas a pagar vencendo e custos previstos.
- **Monitoramento**: tarefas com falha, webhooks rejeitados, logs de erro.

## Situações comuns

| Situação | O que fazer |
|---|---|
| Cliente pagou e o pedido segue “aguardando pagamento” | Pedido → **Consultar no Mercado Pago**. Em Monitoramento → Webhooks, veja se o aviso chegou. |
| Pedido em análise | Leia o motivo no histórico (valor divergente, modo teste/produção, contestação). Decida e mude o status. |
| Fornecedor sem estoque depois do pagamento | Cancele o pedido com o motivo e faça o **reembolso** (total) pelo pedido. O cliente é avisado. |
| Reembolso parcial | Pedido → Reembolsar, informe o valor. Só é possível sobre pagamento aprovado. |
| Produto importado da CJ | Fica como **rascunho**. Revise nome, fotos e descrição, defina o preço e ative. |
| Atualizar estoque de fornecedor sem API | Produtos → Importar → modelo de estoque (CSV). Faça a simulação antes de aplicar. |
| Pedido de exclusão de dados (LGPD) | Clientes → cliente → Exportar dados / Anonimizar. Pedidos são mantidos pelo prazo legal (dados pessoais removidos). Prazo de resposta: 15 dias. |

## Regras que o sistema não deixa quebrar

- Nada vai ao fornecedor sem pagamento aprovado.
- Um pedido não é criado nem cobrado duas vezes (idempotência).
- Integração sem credencial aparece como “aguardando configuração”.
- Lembrete de carrinho e ofertas só para quem consentiu.
- O prazo exibido ao cliente é sempre uma estimativa.

## Papéis

| Papel | Pode |
|---|---|
| Administrador | Tudo, inclusive usuários e credenciais |
| Gerente | Tudo, menos usuários e credenciais |
| Atendimento | Pedidos (sem reembolso), clientes, avaliações, consulta de produtos e fornecedores |
| Operador | Produtos, fornecedores, pedidos (sem reembolso) e monitoramento |

Mude o papel em **Usuários** (a pessoa precisa ter conta criada na loja).
