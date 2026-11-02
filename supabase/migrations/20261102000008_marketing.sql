-- Fase 9: marketing e fidelidade.

-- Cupom pessoal (ex.: resgate de pontos): só vale para o e-mail indicado.
alter table public.coupons add column if not exists customer_email text;
alter table public.coupons add column if not exists origin text not null default 'admin' check (origin in ('admin', 'loyalty'));

-- Recuperação de carrinho: busca de carrinhos abertos elegíveis.
create index if not exists carts_abandoned_idx on public.carts (updated_at)
  where status = 'open' and recovery_email_sent_at is null;

-- Fidelidade: saldo por cliente.
create index if not exists loyalty_ledger_profile_idx on public.loyalty_ledger (profile_id);

-- Validade dos pontos e do cupom de resgate (padrões conservadores; desligado por padrão).
update public.settings
set value = jsonb_build_object('min_redeem_points', 500, 'coupon_valid_days', 60) || value
where key = 'loyalty';
