create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  local_id text not null,
  store_slug text not null,
  folio text not null unique,
  started_at timestamptz not null,
  finalized_at timestamptz not null,
  total_pieces integer not null default 0,
  movements jsonb not null default '[]'::jsonb,
  code_totals jsonb not null default '[]'::jsonb,
  comparison_totals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_counts_store_finalized
  on public.inventory_counts (store_slug, finalized_at desc);

alter table public.inventory_counts enable row level security;

drop policy if exists "inventory_counts_public_select" on public.inventory_counts;
drop policy if exists "inventory_counts_public_insert" on public.inventory_counts;

create policy "inventory_counts_public_select"
  on public.inventory_counts
  for select
  using (true);

create policy "inventory_counts_public_insert"
  on public.inventory_counts
  for insert
  with check (
    store_slug in (
      'elite',
      'lineas-originales',
      'club-jeans',
      'miguel-aleman',
      'almacen-general',
      'zapotlanejo',
      'denim-click'
    )
  );

grant usage on schema public to anon;
grant select, insert on public.inventory_counts to anon;

create table if not exists public.inventory_active_counts (
  store_slug text primary key,
  local_id text not null,
  started_at timestamptz not null,
  updated_at timestamptz not null default now(),
  total_pieces integer not null default 0,
  movement_count integer not null default 0,
  active_count jsonb not null default '{}'::jsonb,
  code_totals jsonb not null default '[]'::jsonb,
  comparison_totals jsonb not null default '[]'::jsonb,
  dashboard jsonb not null default '{}'::jsonb
);

create index if not exists idx_inventory_active_counts_updated
  on public.inventory_active_counts (updated_at desc);

alter table public.inventory_active_counts enable row level security;

drop policy if exists "inventory_active_counts_public_select" on public.inventory_active_counts;
drop policy if exists "inventory_active_counts_public_insert" on public.inventory_active_counts;
drop policy if exists "inventory_active_counts_public_update" on public.inventory_active_counts;

create policy "inventory_active_counts_public_select"
  on public.inventory_active_counts
  for select
  using (true);

create policy "inventory_active_counts_public_insert"
  on public.inventory_active_counts
  for insert
  with check (
    store_slug in (
      'elite',
      'lineas-originales',
      'club-jeans',
      'miguel-aleman',
      'almacen-general',
      'zapotlanejo',
      'denim-click'
    )
  );

create policy "inventory_active_counts_public_update"
  on public.inventory_active_counts
  for update
  using (
    store_slug in (
      'elite',
      'lineas-originales',
      'club-jeans',
      'miguel-aleman',
      'almacen-general',
      'zapotlanejo',
      'denim-click'
    )
  )
  with check (
    store_slug in (
      'elite',
      'lineas-originales',
      'club-jeans',
      'miguel-aleman',
      'almacen-general',
      'zapotlanejo',
      'denim-click'
    )
  );

grant select, insert, update on public.inventory_active_counts to anon;

create table if not exists public.inventory_store_stocks (
  store_slug text primary key,
  source_name text,
  source_type text,
  uploaded_at timestamptz not null default now(),
  total_stock integer not null default 0,
  expected_by_quality jsonb not null default '{}'::jsonb
);

alter table public.inventory_store_stocks enable row level security;

drop policy if exists "inventory_store_stocks_public_select" on public.inventory_store_stocks;
drop policy if exists "inventory_store_stocks_public_insert" on public.inventory_store_stocks;
drop policy if exists "inventory_store_stocks_public_update" on public.inventory_store_stocks;

create policy "inventory_store_stocks_public_select"
  on public.inventory_store_stocks
  for select
  using (true);

create policy "inventory_store_stocks_public_insert"
  on public.inventory_store_stocks
  for insert
  with check (
    store_slug in (
      'elite',
      'lineas-originales',
      'club-jeans',
      'miguel-aleman',
      'almacen-general',
      'zapotlanejo',
      'denim-click'
    )
  );

create policy "inventory_store_stocks_public_update"
  on public.inventory_store_stocks
  for update
  using (
    store_slug in (
      'elite',
      'lineas-originales',
      'club-jeans',
      'miguel-aleman',
      'almacen-general',
      'zapotlanejo',
      'denim-click'
    )
  )
  with check (
    store_slug in (
      'elite',
      'lineas-originales',
      'club-jeans',
      'miguel-aleman',
      'almacen-general',
      'zapotlanejo',
      'denim-click'
    )
  );

grant select, insert, update on public.inventory_store_stocks to anon;

drop function if exists public.save_inventory_store_stock(text, text, text, integer, jsonb);
create or replace function public.save_inventory_store_stock(
  p_store_slug text,
  p_source_name text,
  p_source_type text,
  p_total_stock integer,
  p_expected_by_quality jsonb
)
returns table (
  store_slug text,
  source_name text,
  source_type text,
  uploaded_at timestamptz,
  total_stock integer,
  expected_by_quality jsonb
)
language plpgsql
as $$
begin
  if p_store_slug not in (
    'elite',
    'lineas-originales',
    'club-jeans',
    'miguel-aleman',
    'almacen-general',
    'zapotlanejo',
    'denim-click'
  ) then
    raise exception 'Sucursal invalida: %', p_store_slug;
  end if;

  return query
    insert into public.inventory_store_stocks as saved_stock (
      store_slug,
      source_name,
      source_type,
      uploaded_at,
      total_stock,
      expected_by_quality
    )
    values (
      p_store_slug,
      p_source_name,
      p_source_type,
      now(),
      coalesce(p_total_stock, 0),
      coalesce(p_expected_by_quality, '{}'::jsonb)
    )
    on conflict (store_slug) do update set
      source_name = excluded.source_name,
      source_type = excluded.source_type,
      uploaded_at = now(),
      total_stock = excluded.total_stock,
      expected_by_quality = excluded.expected_by_quality
    returning
      saved_stock.store_slug,
      saved_stock.source_name,
      saved_stock.source_type,
      saved_stock.uploaded_at,
      saved_stock.total_stock,
      saved_stock.expected_by_quality;
end;
$$;

grant execute on function public.save_inventory_store_stock(text, text, text, integer, jsonb) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.inventory_store_stocks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create table if not exists public.inventory_custom_codes (
  code text primary key,
  quality_name text not null,
  system_quality text not null,
  product_name text not null,
  created_at timestamptz not null default now(),
  created_by_store text,
  source text not null default 'manual'
);

create index if not exists idx_inventory_custom_codes_created
  on public.inventory_custom_codes (created_at desc);

create unique index if not exists idx_inventory_custom_codes_code_lower
  on public.inventory_custom_codes (lower(code));

alter table public.inventory_custom_codes enable row level security;

drop policy if exists "inventory_custom_codes_public_select" on public.inventory_custom_codes;
drop policy if exists "inventory_custom_codes_public_insert" on public.inventory_custom_codes;
drop policy if exists "inventory_custom_codes_public_update" on public.inventory_custom_codes;

create policy "inventory_custom_codes_public_select"
  on public.inventory_custom_codes
  for select
  using (true);

create policy "inventory_custom_codes_public_insert"
  on public.inventory_custom_codes
  for insert
  with check (
    length(code) > 0
    and length(product_name) > 0
    and code = upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'))
  );

revoke update on public.inventory_custom_codes from anon;
grant select, insert on public.inventory_custom_codes to anon;

drop function if exists public.save_inventory_custom_codes(jsonb);
create or replace function public.save_inventory_custom_codes(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.inventory_custom_codes (
    code,
    quality_name,
    system_quality,
    product_name,
    created_at,
    created_by_store,
    source
  )
  select
    upper(regexp_replace(coalesce(item.code, ''), '[^A-Za-z0-9]', '', 'g')) as code,
    upper(trim(coalesce(item.quality_name, item.product_name, ''))) as quality_name,
    upper(trim(coalesce(item.system_quality, item.product_name, item.quality_name, ''))) as system_quality,
    upper(trim(coalesce(item.product_name, item.quality_name, ''))) as product_name,
    coalesce(item.created_at, now()) as created_at,
    item.created_by_store,
    coalesce(item.source, 'manual') as source
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    code text,
    quality_name text,
    system_quality text,
    product_name text,
    created_at timestamptz,
    created_by_store text,
    source text
  )
  where upper(regexp_replace(coalesce(item.code, ''), '[^A-Za-z0-9]', '', 'g')) <> ''
    and upper(trim(coalesce(item.product_name, item.quality_name, ''))) <> ''
  on conflict (code) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

grant execute on function public.save_inventory_custom_codes(jsonb) to anon, authenticated;
