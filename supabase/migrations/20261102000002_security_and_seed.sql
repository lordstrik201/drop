-- =============================================================================
-- Permissões por função, RLS e dados de configuração iniciais
-- =============================================================================

insert into public.permissions (code, description) values
  ('dashboard.view',      'Ver o dashboard'),
  ('products.read',       'Ver produtos'),
  ('products.write',      'Criar e editar produtos, categorias e imagens'),
  ('products.delete',     'Excluir produtos'),
  ('suppliers.read',      'Ver fornecedores'),
  ('suppliers.write',     'Gerenciar fornecedores e importações'),
  ('orders.read',         'Ver pedidos'),
  ('orders.write',        'Atualizar pedidos e rastreamento'),
  ('orders.approve',      'Aprovar encaminhamento ao fornecedor'),
  ('orders.cancel',       'Cancelar pedidos'),
  ('payments.refund',     'Emitir reembolsos'),
  ('customers.read',      'Ver clientes'),
  ('customers.write',     'Editar clientes e registrar atendimento'),
  ('customers.export',    'Exportar dados de clientes'),
  ('finance.read',        'Ver financeiro'),
  ('finance.write',       'Lançar despesas e receitas'),
  ('marketing.write',     'Gerenciar cupons, campanhas e banners'),
  ('reviews.moderate',    'Moderar avaliações'),
  ('reports.read',        'Ver e exportar relatórios'),
  ('settings.write',      'Alterar configurações da loja'),
  ('integrations.write',  'Configurar integrações e credenciais'),
  ('users.manage',        'Gerenciar usuários e funções'),
  ('monitoring.read',     'Ver monitoramento e logs'),
  ('monitoring.retry',    'Reexecutar tarefas com falha'),
  ('audit.read',          'Ver auditoria');

-- Administrador: tudo
insert into public.role_permissions (role, permission)
select 'admin', code from public.permissions;

-- Gerente: tudo, menos gestão de usuários e credenciais
insert into public.role_permissions (role, permission)
select 'manager', code from public.permissions where code not in ('users.manage', 'integrations.write');

-- Atendimento
insert into public.role_permissions (role, permission) values
  ('support', 'dashboard.view'), ('support', 'products.read'), ('support', 'orders.read'),
  ('support', 'orders.write'), ('support', 'customers.read'), ('support', 'customers.write'),
  ('support', 'reviews.moderate'), ('support', 'suppliers.read');

-- Operador (operação de catálogo e pedidos)
insert into public.role_permissions (role, permission) values
  ('operator', 'dashboard.view'), ('operator', 'products.read'), ('operator', 'products.write'),
  ('operator', 'suppliers.read'), ('operator', 'suppliers.write'), ('operator', 'orders.read'),
  ('operator', 'orders.write'), ('operator', 'monitoring.read');

-- -----------------------------------------------------------------------------
-- Row Level Security
-- O servidor da aplicação acessa o banco com papel privilegiado e aplica as
-- regras de autorização no código (src/lib/auth/rbac.ts). As políticas abaixo
-- protegem o acesso direto pela API pública do Supabase (chave anon): tudo é
-- negado, exceto leitura do catálogo publicado e dos dados do próprio cliente.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','permissions','role_permissions','addresses','suppliers','integrations','categories',
    'products','product_images','product_variants','stock_history','price_history','reviews','coupons',
    'campaigns','banners','carts','cart_items','orders','order_items','order_status_history',
    'coupon_redemptions','payments','transactions','refunds','supplier_orders','shipments',
    'tracking_events','financial_entries','expenses','revenues','support_notes','contact_messages',
    'supplier_issues','privacy_requests','loyalty_ledger','notifications','audit_logs','app_logs',
    'webhook_events','jobs','sync_runs','rate_limits','settings','pages'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Catálogo público
create policy categories_public_read on public.categories for select to anon, authenticated using (is_active);
create policy products_public_read on public.products for select to anon, authenticated using (status = 'active');
create policy product_images_public_read on public.product_images for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_id and p.status = 'active'));
create policy product_variants_public_read on public.product_variants for select to anon, authenticated
  using (is_active and exists (select 1 from public.products p where p.id = product_id and p.status = 'active'));
create policy reviews_public_read on public.reviews for select to anon, authenticated using (status = 'approved');
create policy banners_public_read on public.banners for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy settings_public_read on public.settings for select to anon, authenticated using (is_public);
create policy pages_public_read on public.pages for select to anon, authenticated using (is_published);

-- Dados do próprio cliente
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy addresses_self_all on public.addresses for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy orders_self_read on public.orders for select to authenticated using (profile_id = auth.uid());
create policy order_items_self_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.profile_id = auth.uid()));
create policy shipments_self_read on public.shipments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.profile_id = auth.uid()));
create policy tracking_events_self_read on public.tracking_events for select to authenticated
  using (exists (select 1 from public.shipments s join public.orders o on o.id = s.order_id
                 where s.id = shipment_id and o.profile_id = auth.uid()));

-- Equipe interna: leitura via API somente para quem é staff (o painel usa o servidor).
create policy staff_read_orders on public.orders for select to authenticated using (public.is_staff());
create policy staff_read_profiles on public.profiles for select to authenticated using (public.is_staff());

-- Nenhuma política de escrita para anon/authenticated: escritas passam pelo servidor.
revoke all on public.integrations from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;
revoke all on public.app_logs from anon, authenticated;
revoke all on public.jobs from anon, authenticated;
revoke all on public.webhook_events from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Configurações iniciais (sem dados empresariais fictícios: campos vazios
-- até o lojista preencher em /admin/configuracoes)
-- -----------------------------------------------------------------------------
insert into public.settings (key, value, is_public) values
  ('store.identity', jsonb_build_object(
      'name', 'Minha Loja',
      'tagline', '',
      'logo_url', null,
      'favicon_url', null,
      'primary_color', '#0F766E',
      'accent_color', '#F59E0B'
  ), true),
  ('store.company', jsonb_build_object(
      'legal_name', '', 'cnpj', '', 'state_registration', '',
      'address', '', 'email', '', 'phone', '', 'whatsapp', ''
  ), true),
  ('store.social', jsonb_build_object('instagram', '', 'facebook', '', 'tiktok', '', 'youtube', ''), true),
  ('store.seo', jsonb_build_object('title', '', 'description', '', 'keywords', ''), true),
  ('analytics', jsonb_build_object('ga4_id', '', 'gtm_id', '', 'meta_pixel_id', ''), true),
  ('checkout', jsonb_build_object(
      'require_cpf', true,
      'min_order_cents', 0,
      'pending_payment_expiration_hours', 48
  ), true),
  ('fulfillment', jsonb_build_object(
      -- padrão seguro: toda venda paga aguarda aprovação manual antes de ir ao fornecedor
      'auto_forward_paid_orders', false,
      'delay_alert_days', 3
  ), false),
  ('shipping', jsonb_build_object(
      'mode', 'product',              -- 'product' (frete por produto/fornecedor), 'flat', 'melhorenvio'
      'flat_rate_cents', 0,
      'free_shipping_over_cents', null,
      'origin_cep', ''
  ), true),
  ('notifications', jsonb_build_object(
      'order_created', true, 'payment_approved', true, 'order_shipped', true,
      'order_delivered', true, 'order_canceled', true, 'refund_completed', true,
      'staff_email', ''
  ), false),
  ('marketing', jsonb_build_object(
      'abandoned_cart_enabled', false,
      'abandoned_cart_delay_hours', 4
  ), false),
  ('loyalty', jsonb_build_object('enabled', false, 'points_per_real', 1, 'cents_per_point', 1), false);

insert into public.pages (slug, title, content, is_published) values
  ('politica-de-privacidade', 'Política de Privacidade', '', false),
  ('termos-de-uso', 'Termos de Uso', '', false),
  ('trocas-e-devolucoes', 'Política de Trocas e Devoluções', '', false),
  ('sobre', 'Sobre nós', '', false);

insert into public.integrations (provider, kind) values
  ('mercadopago', 'payment'),
  ('melhorenvio', 'shipping'),
  ('cj', 'supplier'),
  ('dropi', 'supplier'),
  ('resend', 'email'),
  ('viacep', 'shipping');
