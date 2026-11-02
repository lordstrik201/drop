# Custos

Valores consultados nos sites oficiais em novembro de 2026; confirme antes de contratar. Preços
em dólar são cobrados em cartão internacional (IOF e câmbio à parte).

> Nenhum plano pago foi contratado. Contratar exige a autorização do responsável pela loja.

## Recorrentes (mensais)

| Serviço | Plano mínimo para a loja no ar | Preço | Observação |
|---|---|---|---|
| Vercel (hospedagem) | **Pro** | US$ 20/mês | O Hobby (gratuito) é para uso pessoal e não comercial. Homologação pode ficar no Hobby. |
| Supabase (banco, login, arquivos) — produção | **Pro** | a partir de US$ 25/mês | O Free pausa o projeto após 1 semana sem uso e tem 500 MB. O Pro inclui 8 GB, 250 GB de tráfego e US$ 10 de créditos de computação. |
| Supabase — homologação | Free | US$ 0 | Pode pausar por inatividade; reative pelo painel. |
| Resend (e-mail) | Free | US$ 0 | 3.000 e-mails/mês, máximo 100/dia. Acima disso, Pro por US$ 20/mês (50.000/mês). |
| Domínio .com.br (Registro.br) | — | R$ 40,00/ano | |

**Estimativa para começar:** cerca de US$ 45/mês (Vercel Pro + Supabase Pro) mais R$ 40/ano do domínio.
Com o Resend gratuito enquanto o volume couber em 100 e-mails por dia.

## Por venda

| Item | Como é cobrado |
|---|---|
| Mercado Pago | Taxa por transação, que varia com o meio (Pix, crédito, débito) e o prazo de recebimento escolhido na conta. Consulte <https://www.mercadopago.com.br/custo-receber-pagamentos>. A taxa real de cada venda vem da API e aparece no Financeiro. |
| Fornecedor (CJ, Dropi, independentes) | Custo do produto e do frete, pago ao fornecedor por pedido. Na CJ em dólar. |
| Melhor Envio | Plataforma gratuita; paga-se o frete das etiquetas, quando usadas. |
| Parcelamento sem juros | Se a conta do Mercado Pago estiver configurada para absorver os juros, o custo fica com o lojista. O limite de parcelas é definido em Pagamentos. |

## Sem custo no sistema
- Fila de tarefas e agendamento: PostgreSQL + `pg_cron` do Supabase (sem serviço extra).
- Relatórios PDF: biblioteca gratuita (pdf-lib).
- CJdropshipping API: sem mensalidade de API.

## Custos que dependem de decisão futura
- Anúncios (Google, Meta): só com autorização; o sistema não ativa campanhas pagas.
- SMTP próprio para os e-mails do Supabase Auth (o envio padrão tem limite baixo); o Resend pode ser usado como SMTP.
- Contrato com os Correios, se a loja passar a postar.
