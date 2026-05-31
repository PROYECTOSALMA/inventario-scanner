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
