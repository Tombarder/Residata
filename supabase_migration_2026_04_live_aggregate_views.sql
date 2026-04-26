-- Live aggregate views — derived from flats_archive on every read.
--
-- Why: the marketing homepage and other public pages need real,
-- always-fresh totals (units tracked, available, sold, etc.). The
-- previous approach used a `metrics` table that was only refreshed
-- during the monthly sync, so any data added between syncs (manual
-- entries, backfill runs) made the homepage and the platform Pivot
-- show different numbers — exactly the "two sources of truth" problem.
--
-- These views compute aggregates on-demand from flats_archive
-- (filtered to the latest month). One source, always fresh.
--
-- RLS / security model:
--   The views are intentionally SECURITY DEFINER (default — no
--   `security_invoker` clause). They run as the view owner (postgres)
--   which bypasses RLS on flats_archive. This is safe because:
--     · Views expose only AGGREGATE rows (counts / averages),
--       not individual flat data
--     · Equivalent aggregates are already publicly readable from
--       the metrics table; this just makes them always fresh
--     · No PII or commercially sensitive per-flat data leaks
--   The base flats_archive table still gates row-level reads for
--   non-paid users; the platform Pivot still uses the gated path.

-- ============================================================
-- market_totals — 5 main homepage / dashboard numbers
-- ============================================================
create or replace view public.market_totals as
with latest as (
  select max(snapshot_month) as m from public.flats_archive
)
select
  (select count(*)
     from public.flats_archive fa
     where fa.snapshot_month = latest.m)                    as total_units_tracked,
  (select count(*)
     from public.flats_archive fa
     where fa.snapshot_month = latest.m
       and fa.stav = 'V')                                    as total_available,
  -- 'sold' = explicitly sold flats (stav = 'P'). Excludes 'future'
  -- (Ešte nie v ponuke) and 'error', unlike the old metric which
  -- treated everything-not-V-or-R as sold. Cleaner definition.
  (select count(*)
     from public.flats_archive fa
     where fa.snapshot_month = latest.m
       and fa.stav = 'P')                                    as total_sold,
  (select count(*)
     from public.flats_archive fa
     where fa.snapshot_month = latest.m
       and fa.stav in ('R', 'PR'))                           as total_reserved,
  -- Avg €/m² across all flats with both valid price and valid area.
  -- Simple arithmetic mean — no weighting by inflated total_units.
  (select round(avg(cena_s_dph / obytna_plocha)::numeric, 0)
     from public.flats_archive fa
     where fa.snapshot_month = latest.m
       and fa.cena_s_dph > 0
       and fa.obytna_plocha > 0)                             as avg_eur_m2,
  latest.m                                                   as snapshot_month
from latest;

comment on view public.market_totals is
  'Always-fresh homepage / dashboard totals derived from flats_archive (latest month). Single row.';


-- ============================================================
-- district_totals — per-district aggregates for DistrictPulse
-- ============================================================
create or replace view public.district_totals as
with latest as (
  select max(snapshot_month) as m from public.flats_archive
)
select
  p.district,
  count(*)                                                   as total_units,
  count(*) filter (where fa.stav = 'V')                      as available_units,
  count(*) filter (where fa.stav = 'P')                      as sold_units,
  count(*) filter (where fa.stav in ('R', 'PR'))             as reserved_units,
  count(distinct fa.project_id)                              as project_count,
  -- Avg €/m² across the district's flats — same simple-mean recipe
  -- as market_totals, scoped to this district. FILTER goes on the
  -- aggregate (avg) — round() wraps the result.
  round(
    avg(fa.cena_s_dph / fa.obytna_plocha)
      filter (where fa.cena_s_dph > 0 and fa.obytna_plocha > 0)::numeric,
    0
  )                                                            as avg_eur_m2,
  latest.m                                                   as snapshot_month
from public.flats_archive fa
join public.projects p on p.id = fa.project_id
cross join latest
where fa.snapshot_month = latest.m
  and p.district is not null
  and p.district != ''
group by p.district, latest.m;

comment on view public.district_totals is
  'Always-fresh per-district aggregates. One row per district. Same source as market_totals.';
