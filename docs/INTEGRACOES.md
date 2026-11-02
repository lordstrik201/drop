# Integrações

Regra: nenhuma integração foi implementada sem documentação oficial. Sem credencial, o painel
mostra “aguardando configuração”. Credenciais ficam em variáveis de ambiente ou cifradas no banco.

| Integração | Situação no código | O que falta para funcionar |
|---|---|---|
| Mercado Pago (Checkout Pro) | Implementada e testada com respostas simuladas | Credenciais (teste para homologação, produção para a loja) e webhook com assinatura |
| Melhor Envio (cotação) | Implementada | Token, User-Agent, CEP de origem e validação em sandbox |
| CJdropshipping (API 2.0) | Implementada: produto, pedido, rastreio | `CJ_API_KEY`, cotação do dólar e método logístico no fornecedor |
| Resend (e-mail) | Implementada | API key e domínio verificado |
| Dropi | Operação manual/CSV | Nada (não há API pública documentada) |
| Fornecedores independentes | Operação manual/CSV | Nada |
| Correios (contrato próprio) | Não implementada | Contrato e credenciais do SIGEP/API dos Correios, se a loja for postar |

## Mercado Pago
- Documentação: <https://www.mercadopago.com.br/developers/pt/docs/checkout-pro>
- Endpoints usados: `POST /checkout/preferences`, `GET /v1/payments/{id}`,
  `POST /v1/payments/{id}/refunds` (com `X-Idempotency-Key`), `GET /v1/payment_methods`.
- Webhook: `POST /api/webhooks/mercadopago`, com validação do cabeçalho `x-signature` (HMAC-SHA256
  com a assinatura secreta). Avisos sem assinatura válida são rejeitados e registrados.
- Meios e parcelas: em **Pagamentos → Configuração**.
- Taxas reais de cada pagamento vêm da API e entram no financeiro.
- Pendente: validar ponta a ponta em homologação com usuários de teste do Mercado Pago (o ambiente de
  desenvolvimento usado não tinha acesso de rede à API).

## Melhor Envio
- Documentação: <https://docs.melhorenvio.com.br>
- Usado: `POST /api/v2/me/shipment/calculate` (cotação no checkout, modo de frete “Melhor Envio”).
- Não implementado: compra de etiquetas. Seria uma compra real e o envio, em dropshipping, costuma
  sair do fornecedor. Fica para quando houver estoque próprio e autorização.
- O token OAuth expira (30 dias, renovável por 45). Renove no painel do Melhor Envio.

## CJdropshipping
- Documentação: <https://developers.cjdropshipping.com>
- Autenticação: `getAccessToken` / `refreshAccessToken` (tokens cifrados no banco, renovados sozinhos).
- Produtos: `GET /product/query` (por `pid` ou `productSku`). Importação sempre como rascunho.
- Pedidos: `POST /shopping/order/createOrderV2` com `payType: 3` (sem pagamento automático).
  Número duplicado é tratado (reenvio após falha de rede não cria pedido em dobro).
- Rastreio: `GET /logistic/trackInfo` em lote. Só “In transit” é documentado e mapeado.
- Limite: cerca de 1 requisição por segundo, respeitado com intervalo entre chamadas.
- Não implementado: consulta do pedido (*Query Order*), porque a página da documentação não pôde
  ser lida por completo. O número de rastreio é lançado pelo operador ou chega pela consulta de rastreio.

## Resend
- Documentação: <https://resend.com/docs/api-reference/emails/send-email>
- E-mails transacionais do pedido (ligam e desligam em Configurações → E-mails ao cliente) e
  lembrete de carrinho (marketing, só com consentimento, com `List-Unsubscribe`).
- Sem Resend configurado, as notificações ficam como “ignoradas” com o motivo, nunca como enviadas.

## Dropi e fornecedores sem API
- Pedidos: fila **Encaminhamento**, com cópia dos dados ou exportação CSV (separador “;”, compatível com Excel).
- Produtos e estoque: **Produtos → Importar**, com modelos CSV, simulação antes de aplicar e relatório de erros por linha.
