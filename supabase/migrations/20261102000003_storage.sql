-- Bucket público para imagens de produtos, banners e logotipo.
-- Executa apenas onde o schema "storage" do Supabase existe.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('public-media', 'public-media', true, 5242880,
            array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    on conflict (id) do nothing;
  end if;
end $$;
