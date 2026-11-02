-- =============================================================================
-- Drop — esquema principal
-- Valores monetários: integer em centavos (BRL). Datas: timestamptz (UTC);
-- a interface converte para America/Sao_Paulo.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Wrapper imutável para usar unaccent em índices/gatilhos.
create or replace function public.f_unaccent(text) returns text
language sql immutable parallel safe strict
set search_path = public, pg_temp
as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('customer', 'operator', 'support', 'manager', 'admin');

create type public.product_status as enum ('draft', 'active', 'inactive', 'archived');

create type public.integration_type as enum ('manual', 'csv', 'cj', 'dropi', 'api');
create type public.integration_status as enum ('not_configured', 'configured', 'connected', 'error', 'disabled');

create type public.order_status as enum (
  'pending_payment',    -- Aguardando pagamento
  'paid',               -- Pagamento aprovado
  'awaiting_supplier',  -- Aguardando fornecedor
  'sent_to_supplier',   -- Pedido enviado ao fornecedor
  'preparing',          -- Em preparação
  'shipped',            -- Enviado
  'in_transit',         -- Em trânsito
  'delivered',          -- Entregue
  'canceled',           -- Cancelado
  'refunded',           -- Reembolsado
  'under_review'        -- Em análise
);

create type public.payment_status as enum (
  'pending', 'in_process', 'authorized', 'approved', 'rejected',
  'cancelled', 'refunded', 'partially_refunded', 'charged_back'
);

create type public.supplier_order_status as enum (
  'pending', 'awaiting_approval', 'submitting', 'submitted', 'confirmed',
  'processing', 'shipped', 'delivered', 'failed', 'canceled'
);

create type public.shipment_status as enum (
  'pending', 'posted', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'
);

create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'dead', 'canceled');

create type public.refund_status as enum ('requested', 'processing', 'completed', 'failed');

create type public.ledger_kind as enum (
  'sale_revenue',      -- valor bruto dos produtos vendidos
  'shipping_revenue',  -- frete cobrado do cliente
  'discount',          -- descontos concedidos (negativo)
  'product_cost',      -- custo pago ao fornecedor (negativo)
  'shipping_cost',     -- frete pago ao fornecedor/transportadora (negativo)
  'gateway_fee',       -- taxa do meio de pagamento (negativo)
  'refund',            -- reembolso ao cliente (negativo)
  'chargeback',        -- contestação (negativo)
  'commission',        -- comissões (negativo)
  'other_income',
  'other_expense'
);

-- -----------------------------------------------------------------------------
-- Usuários, perfis e permissões
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  cpf text check (cpf is null or cpf ~ '^\d{11}$'),
  birth_date date,
  role public.app_role not null default 'customer',
  is_blocked boolean not null default false,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  admin_notes text,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_idx on public.profiles (role) where role <> 'customer';
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.permissions (
  code text primary key,
  description text not null
);

create table public.role_permissions (
  role public.app_role not null,
  permission text not null references public.permissions (code) on delete cascade,
  primary key (role, permission)
);

-- Cria o perfil automaticamente quando o Supabase Auth registra um usuário.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.current_role_name() returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and not is_blocked
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_role_name() in ('operator', 'support', 'manager', 'admin'), false)
$$;

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  label text,
  recipient_name text not null,
  phone text,
  cep text not null check (cep ~ '^\d{8}$'),
  street text not null,
  number text not null,
  complement text,
  district text not null,
  city text not null,
  state char(2) not null check (state ~ '^[A-Z]{2}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_profile_idx on public.addresses (profile_id);
create unique index addresses_one_default on public.addresses (profile_id) where is_default;
create trigger addresses_updated_at before update on public.addresses
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Fornecedores e integrações
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_name text,
  cnpj text check (cnpj is null or cnpj ~ '^\d{14}$'),
  contact_name text,
  email text,
  phone text,
  address text,
  website text,
  avg_processing_days smallint check (avg_processing_days between 0 and 120),
  avg_delivery_days smallint check (avg_delivery_days between 0 and 180),
  return_policy text,
  integration_type public.integration_type not null default 'manual',
  integration_status public.integration_status not null default 'not_configured',
  integration_config jsonb not null default '{}'::jsonb,
  /** Exige aprovação manual antes de encaminhar pedidos a este fornecedor. */
  requires_manual_approval boolean not null default true,
  internal_rating smallint check (internal_rating between 1 and 5),
  notes text,
  is_active boolean not null default true,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_cnpj_key on public.suppliers (cnpj) where cnpj is not null;
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

create table public.integrations (
  provider text primary key,            -- 'mercadopago', 'melhorenvio', 'cj', 'resend', ...
  kind text not null check (kind in ('payment', 'shipping', 'supplier', 'email', 'analytics', 'other')),
  status public.integration_status not null default 'not_configured',
  config jsonb not null default '{}'::jsonb,   -- somente dados não sensíveis
  secrets_encrypted text,                      -- AES-256-GCM (APP_ENCRYPTION_KEY)
  last_check_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create trigger integrations_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Catálogo
-- -----------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete set null,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  image_url text,
  seo_title text,
  seo_description text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sku text not null,
  short_description text,
  description text,
  brand text,
  category_id uuid references public.categories (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete restrict,
  supplier_product_ref text,                 -- id do produto no fornecedor
  status public.product_status not null default 'draft',
  is_featured boolean not null default false,
  -- Preço de referência (variações podem sobrescrever)
  cost_cents integer not null default 0 check (cost_cents >= 0),
  shipping_cost_cents integer not null default 0 check (shipping_cost_cents >= 0),
  price_cents integer not null default 0 check (price_cents >= 0),
  compare_at_cents integer check (compare_at_cents is null or compare_at_cents >= 0),
  promo_price_cents integer check (promo_price_cents is null or promo_price_cents >= 0),
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,
  target_margin_bps integer check (target_margin_bps between -10000 and 100000),
  weight_grams integer check (weight_grams is null or weight_grams > 0),
  length_cm numeric(6,1),
  width_cm numeric(6,1),
  height_cm numeric(6,1),
  lead_time_min_days smallint,
  lead_time_max_days smallint,
  seo_title text,
  seo_description text,
  rating_avg numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  sold_count integer not null default 0,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_lead_time_ck check (lead_time_max_days is null or lead_time_min_days is null or lead_time_max_days >= lead_time_min_days)
);
create unique index products_sku_key on public.products (upper(sku));
create unique index products_supplier_ref_key on public.products (supplier_id, supplier_product_ref) where supplier_product_ref is not null;
create index products_category_idx on public.products (category_id) where status = 'active';
create index products_status_idx on public.products (status);
create index products_search_idx on public.products using gin (search_vector);
create index products_name_trgm_idx on public.products using gin (public.f_unaccent(lower(name)) gin_trgm_ops);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create or replace function public.products_search_vector() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.search_vector :=
    setweight(to_tsvector('portuguese', public.f_unaccent(coalesce(new.name, ''))), 'A') ||
    setweight(to_tsvector('portuguese', public.f_unaccent(coalesce(new.brand, '') || ' ' || coalesce(new.sku, ''))), 'B') ||
    setweight(to_tsvector('portuguese', public.f_unaccent(coalesce(new.short_description, ''))), 'C') ||
    setweight(to_tsvector('portuguese', public.f_unaccent(coalesce(new.description, ''))), 'D');
  return new;
end $$;
create trigger products_search before insert or update of name, brand, sku, short_description, description
  on public.products for each row execute function public.products_search_vector();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  url text not null,
  storage_path text,
  alt text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, position);

-- Variações (cor/tamanho/modelo). Todo produto tem ao menos uma variação.
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null,
  title text not null default 'Padrão',
  options jsonb not null default '{}'::jsonb,   -- {"Cor": "Azul", "Tamanho": "M"}
  supplier_variant_ref text,
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  shipping_cost_cents integer check (shipping_cost_cents is null or shipping_cost_cents >= 0),
  price_cents integer check (price_cents is null or price_cents >= 0),
  promo_price_cents integer check (promo_price_cents is null or promo_price_cents >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),  -- disponível no fornecedor
  stock_updated_at timestamptz,
  image_url text,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index product_variants_sku_key on public.product_variants (upper(sku));
create index product_variants_product_idx on public.product_variants (product_id);
create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();

-- Histórico de estoque informado pelo fornecedor
create table public.stock_history (
  id bigint generated always as identity primary key,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  previous_quantity integer,
  new_quantity integer not null,
  source text not null,            -- 'manual', 'csv', 'cj', 'sync', 'order'
  created_at timestamptz not null default now()
);
create index stock_history_variant_idx on public.stock_history (variant_id, created_at desc);

-- Histórico de custos e preços (para relatórios e alertas de alteração)
create table public.price_history (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  cost_cents integer,
  shipping_cost_cents integer,
  price_cents integer,
  promo_price_cents integer,
  source text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create index price_history_product_idx on public.price_history (product_id, created_at desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  order_id uuid,
  author_name text not null,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text check (body is null or length(body) <= 4000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  verified_purchase boolean not null default false,
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references public.profiles (id) on delete set null
);
create unique index reviews_one_per_purchase on public.reviews (product_id, profile_id) where profile_id is not null;
create index reviews_product_idx on public.reviews (product_id) where status = 'approved';

create or replace function public.refresh_product_rating() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare pid uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p set
    rating_avg = coalesce((select round(avg(rating)::numeric, 2) from public.reviews where product_id = pid and status = 'approved'), 0),
    rating_count = (select count(*) from public.reviews where product_id = pid and status = 'approved')
  where p.id = pid;
  return null;
end $$;
create trigger reviews_rating after insert or update or delete on public.reviews
  for each row execute function public.refresh_product_rating();

-- -----------------------------------------------------------------------------
-- Marketing
-- -----------------------------------------------------------------------------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9_-]{3,40}$'),
  description text,
  kind text not null check (kind in ('percent', 'fixed', 'free_shipping')),
  value integer not null default 0 check (value >= 0),   -- bps para percent; centavos para fixed
  max_discount_cents integer check (max_discount_cents is null or max_discount_cents > 0),
  min_subtotal_cents integer not null default 0 check (min_subtotal_cents >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  max_uses_per_customer integer check (max_uses_per_customer is null or max_uses_per_customer > 0),
  used_count integer not null default 0,
  first_order_only boolean not null default false,
  returning_customers_only boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_percent_ck check (kind <> 'percent' or value between 1 and 10000)
);
create unique index coupons_code_key on public.coupons (code);
create trigger coupons_updated_at before update on public.coupons
  for each row execute function public.set_updated_at();

-- Descontos automáticos / campanhas promocionais
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  discount_bps integer not null default 0 check (discount_bps between 0 and 9000),
  category_id uuid references public.categories (id) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  utm_campaign text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  cta_label text,
  link_url text,
  image_url text,
  mobile_image_url text,
  background_color text check (background_color is null or background_color ~ '^#[0-9a-fA-F]{6}$'),
  placement text not null default 'home_hero' check (placement in ('home_hero', 'home_strip', 'category')),
  position integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger banners_updated_at before update on public.banners
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Carrinho
-- -----------------------------------------------------------------------------
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete set null,
  email text,
  coupon_code text,
  status text not null default 'open' check (status in ('open', 'converted', 'abandoned', 'merged')),
  converted_order_id uuid,
  recovery_email_sent_at timestamptz,
  utm jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index carts_profile_idx on public.carts (profile_id) where status = 'open';
create index carts_abandoned_idx on public.carts (updated_at) where status = 'open' and email is not null;
create trigger carts_updated_at before update on public.carts
  for each row execute function public.set_updated_at();

create table public.cart_items (
  cart_id uuid not null references public.carts (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  added_at timestamptz not null default now(),
  primary key (cart_id, variant_id)
);

-- -----------------------------------------------------------------------------
-- Pedidos
-- -----------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 100001) unique,
  profile_id uuid references public.profiles (id) on delete set null,
  cart_id uuid references public.carts (id) on delete set null,
  -- chave de idempotência do envio do checkout: impede pedido duplicado
  idempotency_key text not null unique,
  status public.order_status not null default 'pending_payment',
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  customer_cpf text check (customer_cpf is null or customer_cpf ~ '^\d{11}$'),
  shipping_address jsonb not null,
  shipping_method text,
  shipping_quote jsonb,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  coupon_id uuid references public.coupons (id) on delete set null,
  coupon_code text,
  payment_method text,
  requires_manual_approval boolean not null default true,
  approved_for_fulfillment_at timestamptz,
  approved_for_fulfillment_by uuid references public.profiles (id) on delete set null,
  paid_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  delivered_at timestamptz,
  customer_notes text,
  internal_notes text,
  utm jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_ck check (total_cents = subtotal_cents - discount_cents + shipping_cents)
);
create index orders_profile_idx on public.orders (profile_id, created_at desc);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_created_idx on public.orders (created_at desc);
create index orders_email_idx on public.orders (lower(customer_email));
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- Snapshot dos preços/custos no momento da venda (relatórios não mudam depois).
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  product_name text not null,
  variant_title text,
  sku text not null,
  supplier_product_ref text,
  supplier_variant_ref text,
  image_url text,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  unit_shipping_cost_cents integer not null default 0 check (unit_shipping_cost_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);
create index order_items_supplier_idx on public.order_items (supplier_id);

alter table public.reviews add constraint reviews_order_fk foreign key (order_id) references public.orders (id) on delete set null;
alter table public.carts add constraint carts_order_fk foreign key (converted_order_id) references public.orders (id) on delete set null;

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  source text not null,           -- 'checkout', 'webhook', 'admin', 'job', 'supplier', 'tracking'
  actor_id uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  customer_email text not null,
  discount_cents integer not null,
  created_at timestamptz not null default now()
);
create index coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id);

-- -----------------------------------------------------------------------------
-- Pagamentos
-- -----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  provider text not null,                 -- 'mercadopago'
  provider_payment_id text,               -- id do pagamento no gateway
  provider_preference_id text,            -- id da preferência/checkout
  method text,                            -- 'pix', 'credit_card', 'debit_card', 'boleto'...
  status public.payment_status not null default 'pending',
  status_detail text,
  amount_cents integer not null check (amount_cents >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  net_cents integer,
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  installments smallint,
  money_release_date timestamptz,
  approved_at timestamptz,
  live_mode boolean,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payments_provider_id_key on public.payments (provider, provider_payment_id) where provider_payment_id is not null;
create index payments_order_idx on public.payments (order_id);
create index payments_status_idx on public.payments (status, created_at desc);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Movimentos individuais (cobrança, taxa, estorno, contestação)
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  kind text not null check (kind in ('charge', 'fee', 'refund', 'chargeback', 'release')),
  amount_cents integer not null,
  provider_ref text not null,
  occurred_at timestamptz not null default now(),
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (payment_id, kind, provider_ref)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  status public.refund_status not null default 'requested',
  idempotency_key text not null unique,
  provider_refund_id text,
  error text,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index refunds_order_idx on public.refunds (order_id);

-- -----------------------------------------------------------------------------
-- Encaminhamento a fornecedores e logística
-- -----------------------------------------------------------------------------
create table public.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  status public.supplier_order_status not null default 'pending',
  -- chave enviada ao fornecedor (quando a API aceita) para impedir duplicidade
  idempotency_key text not null unique,
  external_order_id text,
  total_cost_cents integer not null default 0,
  request_payload jsonb,
  response_payload jsonb,
  attempts integer not null default 0,
  last_error text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, supplier_id)
);
create unique index supplier_orders_external_key on public.supplier_orders (supplier_id, external_order_id) where external_order_id is not null;
create index supplier_orders_status_idx on public.supplier_orders (status);
create trigger supplier_orders_updated_at before update on public.supplier_orders
  for each row execute function public.set_updated_at();

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  supplier_order_id uuid references public.supplier_orders (id) on delete set null,
  carrier text,
  service text,
  tracking_code text,
  tracking_url text,
  status public.shipment_status not null default 'pending',
  -- só preenchido quando o fornecedor/transportadora confirma
  confirmed_eta date,
  shipped_at timestamptz,
  delivered_at timestamptz,
  last_event_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index shipments_tracking_key on public.shipments (carrier, tracking_code) where tracking_code is not null;
create index shipments_order_idx on public.shipments (order_id);
create index shipments_open_idx on public.shipments (status) where status not in ('delivered', 'returned');
create trigger shipments_updated_at before update on public.shipments
  for each row execute function public.set_updated_at();

create table public.tracking_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  occurred_at timestamptz not null,
  status public.shipment_status,
  description text not null,
  location text,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (shipment_id, occurred_at, description)
);

-- -----------------------------------------------------------------------------
-- Financeiro
-- -----------------------------------------------------------------------------
-- Razão (ledger): cada linha é um valor com sinal. Faturamento ≠ lucro:
-- receitas, custos e taxas ficam em linhas separadas.
create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  kind public.ledger_kind not null,
  amount_cents integer not null,             -- positivo = entrada; negativo = saída
  order_id uuid references public.orders (id) on delete restrict,
  supplier_id uuid references public.suppliers (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  description text,
  occurred_at timestamptz not null default now(),
  -- data em que o dinheiro fica efetivamente disponível (ex.: liberação do gateway)
  available_at timestamptz,
  status text not null default 'realized' check (status in ('expected', 'realized', 'canceled')),
  -- chave natural para não lançar o mesmo valor duas vezes
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);
create index financial_entries_occurred_idx on public.financial_entries (occurred_at);
create index financial_entries_order_idx on public.financial_entries (order_id);
create index financial_entries_kind_idx on public.financial_entries (kind, occurred_at);

-- Contas a pagar / despesas operacionais
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,                -- 'fornecedor', 'marketing', 'software', 'impostos', ...
  description text not null,
  amount_cents integer not null check (amount_cents > 0),
  supplier_id uuid references public.suppliers (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  due_date date not null,
  paid_at timestamptz,
  status text not null default 'open' check (status in ('open', 'paid', 'canceled')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_due_idx on public.expenses (status, due_date);
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- Receitas avulsas / contas a receber fora do gateway
create table public.revenues (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text not null,
  amount_cents integer not null check (amount_cents > 0),
  order_id uuid references public.orders (id) on delete set null,
  expected_date date not null,
  received_at timestamptz,
  status text not null default 'open' check (status in ('open', 'received', 'canceled')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger revenues_updated_at before update on public.revenues
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- CRM e atendimento
-- -----------------------------------------------------------------------------
create table public.support_notes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  author_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'note' check (kind in ('note', 'contact', 'complaint', 'return')),
  body text not null,
  created_at timestamptz not null default now()
);
create index support_notes_profile_idx on public.support_notes (profile_id, created_at desc);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  order_number bigint,
  subject text not null,
  message text not null check (length(message) <= 5000),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);

create table public.supplier_issues (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  kind text not null check (kind in ('delay', 'wrong_item', 'damaged', 'out_of_stock', 'price_change', 'communication', 'other')),
  description text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index supplier_issues_supplier_idx on public.supplier_issues (supplier_id, created_at desc);

-- LGPD: solicitações de titulares
create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete set null,
  email text not null,
  kind text not null check (kind in ('export', 'delete', 'correct', 'revoke_consent')),
  status text not null default 'open' check (status in ('open', 'done', 'rejected')),
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);

-- Fidelidade (preparado para ativação via configuração loyalty.enabled)
create table public.loyalty_ledger (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  points integer not null,
  reason text not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);
create index loyalty_ledger_profile_idx on public.loyalty_ledger (profile_id);

-- -----------------------------------------------------------------------------
-- Notificações, logs, auditoria, webhooks e tarefas
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  channel text not null default 'email' check (channel in ('email')),
  recipient text not null,
  template text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  is_marketing boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notifications_status_idx on public.notifications (status, created_at);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text,
  action text not null,           -- 'product.update', 'order.cancel', ...
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.app_logs (
  id bigint generated always as identity primary key,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  source text not null,           -- 'mercadopago', 'cj', 'jobs', 'checkout', ...
  message text not null,
  context jsonb,
  created_at timestamptz not null default now()
);
create index app_logs_created_idx on public.app_logs (created_at desc);
create index app_logs_level_idx on public.app_logs (level, created_at desc) where level in ('warn', 'error');

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_type text,
  resource_id text,
  dedupe_key text not null unique,
  signature_valid boolean not null,
  headers jsonb,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored', 'rejected')),
  attempts integer not null default 0,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index webhook_events_received_idx on public.webhook_events (received_at desc);
create index webhook_events_status_idx on public.webhook_events (status) where status in ('received', 'failed');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  -- mesma chave = mesma tarefa: reenfileirar não duplica cobranças nem pedidos
  idempotency_key text not null unique,
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_ready_idx on public.jobs (run_at) where status in ('queued', 'failed');
create index jobs_status_idx on public.jobs (status, created_at desc);
create trigger jobs_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers (id) on delete cascade,
  kind text not null check (kind in ('import', 'products', 'prices', 'stock', 'tracking', 'csv')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  triggered_by uuid references public.profiles (id) on delete set null
);
create index sync_runs_supplier_idx on public.sync_runs (supplier_id, started_at desc);

-- Rate limiting em janela fixa (sem dependência de Redis)
create unlogged table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- -----------------------------------------------------------------------------
-- Configurações e conteúdo
-- -----------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

create table public.pages (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  content text not null default '',
  seo_description text,
  is_published boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create trigger pages_updated_at before update on public.pages
  for each row execute function public.set_updated_at();
