-- Fase 5: parâmetros de precificação e índice para importação/sincronização.

insert into public.settings (key, value, is_public) values
  ('pricing', jsonb_build_object(
      -- taxa média do gateway para estimar margem (consulte sua taxa real no Mercado Pago)
      'estimated_fee_bps', 0,
      'estimated_fee_fixed_cents', 0,
      'default_target_margin_bps', 3000,
      -- alerta quando a margem estimada de um produto ativo fica abaixo deste valor
      'min_margin_alert_bps', 1500
  ), false)
on conflict (key) do nothing;

-- Um produto de fornecedor só pode ser importado uma vez por fornecedor.
create unique index if not exists products_supplier_ref_key
  on public.products (supplier_id, supplier_product_ref) where supplier_product_ref is not null;

create index if not exists product_variants_supplier_ref_idx on public.product_variants (supplier_variant_ref) where supplier_variant_ref is not null;
create index if not exists price_history_unack_idx on public.price_history (created_at desc) where acknowledged_at is null;
