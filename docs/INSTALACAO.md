# Instalação e publicação

Há três ambientes. Cada um tem **seu próprio projeto Supabase** e suas próprias credenciais:

| Ambiente | `APP_ENV` | Onde roda | Banco | Mercado Pago | Melhor Envio |
|---|---|---|---|---|---|
| Desenvolvimento | `development` | seu computador | Supabase de dev ou Postgres local | credenciais de **teste** | `sandbox` |
| Homologação | `staging` | Vercel, ambiente *Preview* (branch `desenvolvimento`) | projeto Supabase `drop-homolog` | credenciais de **teste** | `sandbox` |
| Produção | `production` | Vercel, ambiente *Production* (branch `main`) | projeto Supabase `drop-producao` | credenciais de **produção** | `production` |

Se chegar um pagamento no modo errado (teste em produção ou real em homologação), o pedido vai
para **em análise** e não é encaminhado. Em produção o painel também avisa se a credencial for de teste. Fora de produção, o `robots.txt` bloqueia buscadores.

> Publicar a loja oficialmente, contratar planos pagos e usar credenciais de produção exigem a
> autorização do responsável pela loja.

## 1. Supabase (repita para homologação e produção)

1. Crie o projeto em <https://supabase.com/dashboard> na região **South America (São Paulo)**.
2. **Project Settings → Database → Connection string**: copie a URL do *pooler* em modo
   **Transaction** (porta 6543). Ela é o `DATABASE_URL`.
3. **Project Settings → API**: copie *Project URL* (`NEXT_PUBLIC_SUPABASE_URL`), a chave
   *anon/publishable* (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) e a *service_role/secret* (`SUPABASE_SERVICE_ROLE_KEY`,
   somente servidor).
4. **Authentication → URL Configuration**: *Site URL* = endereço da loja; em *Redirect URLs*,
   adicione `https://SEU-DOMINIO/auth/confirm` (e o endereço de homologação).
5. **Authentication → Emails**: personalize os textos em português. Para volume real, configure um
   SMTP próprio (o envio padrão do Supabase tem limite baixo).
6. Aplique o banco, a partir do seu computador:
   ```bash
   DATABASE_URL="postgres://…:6543/postgres" npm run db:migrate
   ```
   As migrations criam tabelas, RLS, permissões, configurações iniciais e o bucket `public-media`.
7. Crie o primeiro administrador:
   ```bash
   DATABASE_URL=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
     npm run db:create-admin -- --email voce@empresa.com.br
   ```
   Se a conta não existir, ela é criada com uma senha temporária exibida uma vez.
8. **Database → Extensions**: ative `pg_cron` e `pg_net`. Depois rode no *SQL Editor* o arquivo
   `scripts/sql/agendamento-supabase.sql`, trocando a URL do site e o `CRON_SECRET`.

## 2. Vercel

1. Importe o repositório `lordstrik201/drop` em <https://vercel.com/new>. Framework: Next.js.
2. **Settings → Git**: *Production Branch* = `main`. Pushes em `desenvolvimento` geram *Preview* (homologação).
3. **Settings → Environment Variables**: cadastre as variáveis do `.env.example` separadamente para
   *Production* e *Preview*. Gere os segredos assim:
   ```bash
   openssl rand -base64 32   # APP_ENCRYPTION_KEY
   openssl rand -hex 32      # CRON_SECRET
   ```
   `APP_ENCRYPTION_KEY` cifra tokens guardados no banco: **não troque depois de em uso** sem
   reconfigurar as integrações.
4. O `vercel.json` define a região `gru1` e um cron diário de segurança em `/api/cron/jobs`
   (a Vercel envia `Authorization: Bearer $CRON_SECRET` automaticamente).
5. **Domínio**: *Settings → Domains*, adicione o domínio (ex.: registrado no Registro.br) e siga as
   instruções de DNS. Depois atualize `NEXT_PUBLIC_SITE_URL` e as URLs do Supabase Auth.

> O plano Hobby da Vercel é para uso pessoal e não comercial. Uma loja em produção precisa do
> plano Pro (ver `docs/CUSTOS.md`). Homologação pode rodar no Hobby.

## 3. Integrações (pelo painel, em Integrações)

Credenciais podem vir das variáveis de ambiente (recomendado) ou ser cadastradas no painel, onde
ficam cifradas. O botão **Testar conexão** faz uma chamada real e somente leitura.

- **Mercado Pago**: credenciais em *Suas integrações → aplicação → Credenciais*. Em *Webhooks*,
  cadastre `https://SEU-DOMINIO/api/webhooks/mercadopago`, evento **Pagamentos**, e copie a
  *assinatura secreta* para `MERCADOPAGO_WEBHOOK_SECRET`.
- **Melhor Envio**: gere o token no painel (homologação: `sandbox.melhorenvio.com.br`). Informe o
  `MELHORENVIO_USER_AGENT` no formato `NomeDaLoja (email-tecnico@dominio)`. O token expira (ver Integrações).
- **CJdropshipping**: `CJ_API_KEY` gerada no painel de desenvolvedor da CJ. No cadastro do
  fornecedor, informe a cotação do dólar e o método logístico.
- **Resend**: verifique o domínio de envio e preencha `RESEND_API_KEY` e `EMAIL_FROM`.

## 4. Checklist antes de publicar

- [ ] Migrations aplicadas e administrador criado no projeto de produção.
- [ ] Dados da empresa (razão social, CNPJ, endereço, contato) em Configurações → Dados da empresa.
- [ ] Políticas revisadas (Termos, Privacidade, Trocas e devoluções, Entrega) em Páginas e banners.
- [ ] Mercado Pago com credenciais de produção e webhook com assinatura; compra de teste em homologação concluída.
- [ ] `pg_cron` agendado e `/admin/monitoramento` mostrando tarefas rodando.
- [ ] E-mail transacional testado (Integrações → Resend → Testar).
- [ ] Fornecedores cadastrados, produtos revisados (preço, margem, fotos, prazos) e ativados.
- [ ] Encaminhamento automático **desligado** até a operação estar validada.
- [ ] Autorização do responsável para publicar.

## 5. Desenvolvimento local

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Para usar um PostgreSQL local sem Supabase (só para testes), veja `docs/MANUTENCAO.md`.
