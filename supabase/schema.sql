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
