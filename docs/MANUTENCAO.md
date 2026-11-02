# Manutenção

## Atualizar o sistema
1. Trabalhe no branch `desenvolvimento`; cada push gera a homologação na Vercel.
2. Antes de subir: `npm run typecheck && npm run lint && npm test && npm run build`.
3. Mudanças de banco: crie um novo arquivo em `supabase/migrations` (nunca edite um já aplicado).
   Aplique em homologação, valide e depois em produção: `DATABASE_URL=… npm run db:migrate`.
4. Para publicar: pull request de `desenvolvimento` para `main`. O merge publica em produção.

## Testes automatizados
- Unitários e de integração com Vitest (`tests/`), usando um PostgreSQL de verdade. Cada execução
  cria um banco temporário, aplica as migrations e simula o `auth` do Supabase.
- Variável `TEST_DATABASE_ADMIN_URL` (padrão `postgres://postgres@127.0.0.1:54329/postgres`).
  Com Docker: `docker run -d -p 54329:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`.
- Chamadas a Mercado Pago, CJ, Melhor Envio e Resend são simuladas nos testes. Nenhum teste
  faz compra, pagamento ou envio real.
- As páginas do painel são renderizadas nos testes para pegar erros de consulta e de tela.

## Monitoramento
- **Painel → Monitoramento**: fila de tarefas (com reprocessar e cancelar), webhooks recebidos e
  logs técnicos com nível. Erros nunca são escondidos: falhas de pagamento, encaminhamento e
  e-mail aparecem ali e no pedido.
- **Integrações**: estado de cada conexão e último erro.
- Vercel: logs de funções. Supabase: logs do banco e do Auth, `cron.job_run_details` para o agendador.

## Backups
- O Supabase faz backup diário nos planos pagos (o plano Free não tem backup automático
  acessível). Para produção use o plano Pro e, se possível, ative o PITR.
- Exporte relatórios financeiros mensalmente (CSV/PDF) como cópia de controle.

## Rotinas periódicas
| Quando | O quê |
|---|---|
| Mensal | Renovar o token do Melhor Envio (expira em 30 dias). Conferir a cotação do dólar no fornecedor CJ. |
| Mensal | `npm outdated` e `npm audit`; atualizar dependências em homologação primeiro. |
| Trimestral | Revisar usuários do painel e papéis; trocar `CRON_SECRET`. |
| Anual | Revisar políticas (privacidade, trocas, entrega) e dados da empresa. |

## Trocar segredos
- `CRON_SECRET`: troque na Vercel e no Vault do Supabase (`vault.update_secret`).
- `APP_ENCRYPTION_KEY`: só troque com as integrações reconfiguradas depois (tokens cifrados no
  banco ficam ilegíveis com outra chave).
- Credenciais de integrações: troque na origem e atualize a variável; use **Testar conexão**.
