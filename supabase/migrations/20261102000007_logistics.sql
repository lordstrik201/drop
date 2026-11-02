-- Fase 7: parâmetros de rastreio e alertas de atraso (mescla com o que já existe).
update public.settings
set value = jsonb_build_object('stale_tracking_days', 7, 'tracking_refresh_hours', 12) || value
where key = 'fulfillment';

create index if not exists shipments_check_idx on public.shipments (last_checked_at nulls first)
  where status not in ('delivered', 'returned') and tracking_code is not null;
