-- =============================================================================
-- Agendador da fila de tarefas (a cada 5 minutos) usando pg_cron + pg_net do
-- Supabase, sem custo extra. Necessário no plano Hobby da Vercel, que só permite
-- cron diário (o vercel.json mantém uma execução diária de segurança).
--
-- Documentação oficial:
--   https://supabase.com/docs/guides/cron/quickstart
--   https://supabase.com/docs/guides/functions/schedule-functions (Vault)
--
-- Como usar (SQL Editor do Supabase, uma vez por ambiente):
--   1. Database → Extensions: ative "pg_cron" e "pg_net".
--   2. Troque os dois valores abaixo e execute o arquivo inteiro.
--      - URL pública do site (produção ou homologação)
--      - o mesmo valor de CRON_SECRET cadastrado na Vercel
--   Atenção (aviso da documentação): enquanto a requisição está pendente, o
--   segredo fica em net.http_request_queue, legível por quem acessa o banco.
-- =============================================================================

select vault.create_secret('https://SEU-DOMINIO.com.br', 'drop_site_url');
select vault.create_secret('COLE_AQUI_O_CRON_SECRET', 'drop_cron_secret');

select cron.schedule(
  'drop-fila-de-tarefas',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'drop_site_url') || '/api/cron/jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'drop_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);

-- Para conferir:   select * from cron.job;  select * from cron.job_run_details order by start_time desc limit 20;
-- Para remover:    select cron.unschedule('drop-fila-de-tarefas');
