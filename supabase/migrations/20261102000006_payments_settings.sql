-- Fase 6: configuração dos meios de pagamento do Checkout Pro.
insert into public.settings (key, value, is_public) values
  ('payments', jsonb_build_object(
      -- tipos de pagamento a ocultar no Checkout Pro (ids de payment_type_id da API /v1/payment_methods)
      'excluded_payment_types', '[]'::jsonb,
      -- número máximo de parcelas oferecidas (1 a 36, conforme a API de preferências)
      'max_installments', 12
  ), true)
on conflict (key) do nothing;
