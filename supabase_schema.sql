-- ============================================================
-- Residata — Supabase schema
-- Spusti celé v Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- ===== 1. PROJECTS (public, aggregate-level, safe for anon) =====
create table public.projects (
  id text primary key,                  -- slug e.g. "pri-mlynoch"
  name text not null,
  district text,                        -- "Ružinov"
  sub_district text,                    -- "Nivy"
  developer text,
  project_url text,
  total_units int default 0,
  available_units int default 0,        -- V
  sold_units int default 0,             -- P
  reserved_units int default 0,         -- R
  prereserved_units int default 0,      -- PR
  future_units int default 0,           -- Ešte nie v ponuke
  error_units int default 0,
  avg_price_eur_m2 numeric,
  min_price numeric,
  max_price numeric,
  sold_percentage numeric,              -- 0-100
  kolaudacia text,
  is_top20 boolean default false,
  last_updated timestamptz default now(),
  created_at timestamptz default now()
);

create index idx_projects_top20 on public.projects(is_top20) where is_top20;
create index idx_projects_district on public.projects(district);

-- ===== 2. FLATS (gated: 1 project for free logged-in, all for paid) =====
create table public.flats (
  id bigserial primary key,
  project_id text references public.projects(id) on delete cascade,
  unit_id text,
  typ text,                             -- byt / apartman / retail
  etapa text,
  budova text,
  unit_detail text,
  poschodie int,
  izby numeric,
  obytna_plocha numeric,
  balkon_plocha numeric,
  loggia_plocha numeric,
  terasa_plocha numeric,
  zahrada_plocha numeric,
  exterier_plocha numeric,
  kobka_plocha numeric,
  celkova_plocha numeric,
  cena_bez_dph numeric,
  cena_s_dph numeric,
  cena_s_dph_text text,                 -- "Na vyžiadanie" když nie je číslo
  cennikova_cena numeric,
  stav text,                            -- V / P / R / PR / "Ešte nie v ponuke" / ERROR
  kolaudacia text,
  orientacia text,
  last_seen date default current_date,
  created_at timestamptz default now(),
  unique(project_id, unit_id)
);

create index idx_flats_project on public.flats(project_id);
create index idx_flats_stav on public.flats(stav);

-- ===== 3. USER_PROFILES (extends auth.users) =====
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  tier text default 'free',             -- free / paid / admin
  chosen_project_id text references public.projects(id),
  expires_at timestamptz,                -- NULL = no expiry
  created_at timestamptz default now()
);

-- Auto-create profile on auth signup
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.user_profiles (id, email, tier)
  values (new.id, new.email, 'free');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ===== 4. METRICS (precomputed daily, public) =====
create table public.metrics (
  metric_key text primary key,
  value_numeric numeric,
  value_text text,
  value_json jsonb,
  display_order int default 100,
  category text,                         -- 'this_month' / 'total' / 'peak' / 'district' / 'developer' / 'trend'
  last_updated timestamptz default now()
);

create index idx_metrics_order on public.metrics(display_order);
create index idx_metrics_category on public.metrics(category);

-- ===== 5. EVENTS (status changes for "this month" deltas) =====
create table public.events (
  id bigserial primary key,
  project_id text,
  unit_id text,
  event_type text,                       -- 'status_change' / 'new_listing' / 'removed' / 'price_change'
  old_value jsonb,
  new_value jsonb,
  detected_at timestamptz default now()
);

create index idx_events_detected on public.events(detected_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.projects enable row level security;
alter table public.flats enable row level security;
alter table public.user_profiles enable row level security;
alter table public.metrics enable row level security;
alter table public.events enable row level security;

-- Projects: all 60 selectable by anyone (aggregate data, not sensitive)
create policy "projects_read_all" on public.projects
  for select to anon, authenticated using (true);

-- Metrics: public dashboard data, readable by anyone
create policy "metrics_read_all" on public.metrics
  for select to anon, authenticated using (true);

-- Flats: gating logic
--   anon → nothing (0 rows)
--   authenticated + tier=paid/admin → all rows
--   authenticated + tier=free → only their chosen project
create policy "flats_read_gated" on public.flats
  for select to authenticated using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and (
          up.tier in ('paid', 'admin')
          or (up.tier = 'free' and up.chosen_project_id = flats.project_id)
        )
        and (up.expires_at is null or up.expires_at > now())
    )
  );

-- Events: paid/admin only (history = paid feature)
create policy "events_read_paid" on public.events
  for select to authenticated using (
    exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.tier in ('paid', 'admin')
        and (up.expires_at is null or up.expires_at > now())
    )
  );

-- User profiles: user sees their own; admin sees all
create policy "profile_read_own" on public.user_profiles
  for select to authenticated using (auth.uid() = id);

create policy "profile_update_own" on public.user_profiles
  for update to authenticated using (auth.uid() = id)
  with check (auth.uid() = id and tier = (select tier from public.user_profiles where id = auth.uid()));
  -- Users can update their chosen_project_id etc, but NOT their own tier (only admin can via service_role)

create policy "profile_read_admin" on public.user_profiles
  for select to authenticated using (
    exists (select 1 from public.user_profiles where id = auth.uid() and tier = 'admin')
  );

create policy "profile_update_admin" on public.user_profiles
  for update to authenticated using (
    exists (select 1 from public.user_profiles where id = auth.uid() and tier = 'admin')
  );

-- ============================================================
-- HELPER VIEW: current paid count (for "9 zostávajúcich" badge)
-- ============================================================
create or replace view public.early_access_stats as
select
  count(*) filter (where tier = 'paid' and (expires_at is null or expires_at > now()))::int as paid_count,
  greatest(0, 9 - count(*) filter (where tier = 'paid' and (expires_at is null or expires_at > now())))::int as remaining_slots
from public.user_profiles;

-- Safe to expose via anon
grant select on public.early_access_stats to anon, authenticated;
