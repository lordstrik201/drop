-- Modelos iniciais das páginas legais. Ficam NÃO PUBLICADOS até o lojista
-- revisar (de preferência com apoio jurídico) e publicar em /admin/conteudo.
update public.pages set content = $md$
## Quem somos
A loja {{loja}} é operada por {{razao_social}}, CNPJ {{cnpj}}, com endereço em {{endereco}}. Contato do encarregado de dados: {{email}}.

## Quais dados coletamos
- Dados de cadastro: nome, e-mail, telefone, CPF e data de nascimento (opcional).
- Dados de entrega: endereços informados no pedido.
- Dados de pedidos: produtos, valores e histórico de compras.
- Dados de navegação: cookies necessários ao funcionamento (sessão e carrinho) e, se ativadas, ferramentas de análise.

**Não armazenamos dados de cartão.** O pagamento é processado pelo Mercado Pago, em ambiente próprio e certificado.

## Para que usamos
- Processar e entregar pedidos, inclusive repassando nome, endereço e telefone ao fornecedor e à transportadora responsáveis pelo envio.
- Emitir documentos fiscais e cumprir obrigações legais.
- Prestar atendimento e prevenir fraudes.
- Enviar ofertas por e-mail, somente com o seu consentimento, que pode ser revogado a qualquer momento.

## Compartilhamento
Compartilhamos dados apenas com: meio de pagamento (Mercado Pago), fornecedores e transportadoras (para a entrega), provedores de infraestrutura e e-mail, e autoridades quando exigido por lei.

## Seus direitos (LGPD, art. 18)
Você pode confirmar a existência de tratamento, acessar, corrigir, solicitar portabilidade, anonimização ou exclusão de dados e revogar consentimentos pela área "Minha conta → Dados e privacidade" ou pelo e-mail {{email}}.

## Retenção
Mantemos dados de pedidos pelo prazo exigido pela legislação fiscal e consumerista. Dados de cadastro são excluídos ou anonimizados a pedido, ressalvadas essas obrigações.

## Segurança
Adotamos criptografia em trânsito (HTTPS), controle de acesso por função e registro de atividades administrativas.
$md$ where slug = 'politica-de-privacidade';

update public.pages set content = $md$
## Aceitação
Ao utilizar a loja {{loja}} você concorda com estes termos. A loja é operada por {{razao_social}}, CNPJ {{cnpj}}.

## Modelo de venda
Os produtos são enviados diretamente por fornecedores parceiros. Prazos de entrega exibidos são estimativas e começam a contar após a confirmação do pagamento.

## Preços e pagamento
Preços em reais (R$). O pedido só é confirmado após a aprovação do pagamento pelo Mercado Pago. Pedidos não pagos dentro do prazo são cancelados automaticamente.

## Disponibilidade
O estoque é informado pelos fornecedores. Se um item ficar indisponível após a compra, você será informado e poderá optar pelo reembolso integral.

## Conta
Você é responsável pela guarda da sua senha. Podemos suspender contas usadas de forma fraudulenta.

## Contato
{{email}} · {{telefone}}
$md$ where slug = 'termos-de-uso';

update public.pages set content = $md$
## Direito de arrependimento
Compras online podem ser canceladas em até 7 (sete) dias corridos a partir do recebimento, conforme o art. 49 do Código de Defesa do Consumidor, com reembolso integral, inclusive do frete.

## Produto com defeito
Você tem 30 dias (produtos não duráveis) ou 90 dias (duráveis) para reclamar de defeitos, conforme o art. 26 do CDC.

## Como solicitar
1. Entre em contato pelo e-mail {{email}} ou pela página "Fale conosco", informando o número do pedido.
2. Enviaremos as instruções de devolução. Como os produtos vêm de fornecedores parceiros, o endereço de devolução pode variar.
3. Após o recebimento e a conferência, o reembolso é feito no mesmo meio de pagamento.

## Prazos de reembolso
Pix: em até 2 dias úteis após a aprovação. Cartão: o estorno aparece em até duas faturas, conforme a operadora.
$md$ where slug = 'trocas-e-devolucoes';

update public.pages set content = $md$
## {{loja}}
Conte aqui a história da sua loja, sua proposta e como você seleciona seus fornecedores.
$md$ where slug = 'sobre';
