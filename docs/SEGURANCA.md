# Segurança e LGPD

## Autenticação e permissões
- Login pelo Supabase Auth (senha com hash no Supabase, recuperação por e-mail).
- Papéis: administrador, gerente, atendimento e operador (`role_permissions` no banco). Toda página
  e ação do painel checa a permissão no servidor; botões sem permissão não aparecem.
- Ninguém altera o próprio papel e sempre resta pelo menos um administrador.
- Auditoria (`audit_logs`) de alterações de pedidos, produtos, preços, configurações, papéis,
  reembolsos, exportações e anonimizações, com usuário, IP e antes/depois.

## Banco
- RLS ativo em **todas** as tabelas (um teste automatizado falha se alguma nova ficar sem RLS).
  Pela chave pública só se lê o catálogo publicado e os dados do próprio cliente.
- A aplicação usa conexão de servidor; a chave `service_role` nunca vai ao navegador.

## Pagamentos e cartões
- Nenhum dado de cartão é recebido, trafegado ou armazenado: o cliente paga no Checkout Pro.
- Webhooks só são aceitos com assinatura válida e o status é sempre confirmado na API.
- Reembolsos usam chave de idempotência e exigem a permissão `orders.refund`.

## Segredos
- Credenciais em variáveis de ambiente (Vercel) ou cifradas no banco com AES-256-GCM (`APP_ENCRYPTION_KEY`).
- `.env*` fora do Git; um teste procura padrões de chaves reais no código.
- Endpoints de tarefas exigem `Authorization: Bearer CRON_SECRET` (comparação em tempo constante).

## Proteções da aplicação
- Cabeçalhos: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Limite de tentativas em login, cadastro, cupom, contato e CEP.
- Uploads validados pelo conteúdo do arquivo (não pela extensão), até 4 MB.
- CSV exportado com proteção contra fórmulas (injeção em planilhas).
- Redirecionamentos internos do painel aceitam só caminhos `/admin/…`.

## LGPD
- **Base legal**: execução de contrato para pedidos e e-mails transacionais; consentimento para
  marketing (registrado com data; revogável em Minha conta ou pelo link do e-mail).
- **Direitos do titular**: o cliente baixa os próprios dados (JSON) em Minha conta e pode pedir
  exclusão. No painel: exportação e anonimização por cliente, com alerta do prazo de 15 dias.
- **Anonimização**: remove conta e dados pessoais; pedidos ficam com dados mínimos pelo prazo
  legal (art. 16, I), sem identificar a pessoa.
- **Minimização**: exportação de clientes para marketing só traz quem consentiu.
- Revise a Política de Privacidade (modelo em Páginas e banners) com o seu jurídico e indique o encarregado (DPO).
