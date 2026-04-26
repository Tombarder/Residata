-- Convert `metrics` from a sync-refreshed table into a live view.
--
-- Why: the metrics table was a snapshot computed during the monthly
-- sync, so any data added between syncs (manual entries, backfills,
-- mid-month corrections) made the homepage Ticker show old numbers
-- while the platform Pivot showed fresh ones — two sources of truth.
--
-- This migration:
--   1) Drops the metrics table.
--   2) Creates `metrics` as a VIEW that derives all 18 metric rows
--      live from flats_archive (latest month) + projects on every read.
--   3) The view returns the SAME shape (metric_key, value_numeric,
--      value_text, value_json, category, display_order, last_updated)
--      so callers (Ticker, useMetrics, useMarketTotals) keep working
--      without any change to their queries.
--
-- Security model — same as market_totals:
--   The view is SECURITY DEFINER (default — no security_invoker).
--   It runs as the view owner (postgres) which bypasses RLS on the
--   underlying flats_archive. This is safe because the view exposes
--   only aggregate / leader rows, not individual flat data — same
--   level of detail the old metrics table already exposed publicly.
--
-- Performance:
--   Each metric is a single subquery against flats_archive filtered to
--   one month (~5,500 rows today, scales linearly per-month-only).
--   With idx_flats_archive_month + idx_flats_archive_project_month +
--   idx_flats_archive_stav covering the access patterns, each metric
--   resolves in <5ms; the full set is ~50ms total. Acceptable for the
--   homepage Ticker which loads once per session anyway.
--
-- Sync-side:
--   sync_to_supabase.py no longer needs to call upsert_metrics or
--   compute_metrics — those are dropped in the companion commit. The
--   table being a view means PostgREST POST/PATCH would fail anyway,
--   so any leftover writer is loudly disabled.

drop policy if exists metrics_read_all on public.metrics;
drop table if exists public.metrics cascade;

create view public.metrics as
with
  fc as (
    select * from public.flats_archive
    where snapshot_month = (select max(snapshot_month) from public.flats_archive)
  ),
  proj as (
    select * from public.projects
  ),
  -- Per-flat €/m² where both price and area are valid
  fc_em as (
    select fc.*, fc.cena_s_dph / nullif(fc.obytna_plocha, 0) as eur_m2
    from fc
    where fc.cena_s_dph > 0 and fc.obytna_plocha > 0
  ),
  -- Aggregate counts (single pass)
  counts as (
    select
      count(*)                                                 as n_total,
      count(*) filter (where stav = 'V')                       as n_avail,
      count(*) filter (where stav = 'P')                       as n_sold,
      count(*) filter (where stav in ('R','PR'))               as n_reserved
    from fc
  ),
  -- Count of active projects (status = 'active')
  active_proj_count as (
    select count(*) as n from proj where status = 'active'
  ),
  -- Peak sold price + project (where stav = P, max price)
  peak_sold as (
    select fc.cena_s_dph, p.name
    from fc join proj p on p.id = fc.project_id
    where fc.stav = 'P' and fc.cena_s_dph is not null
    order by fc.cena_s_dph desc
    limit 1
  ),
  -- Cheapest available
  peak_cheap as (
    select fc.cena_s_dph, p.name
    from fc join proj p on p.id = fc.project_id
    where fc.stav = 'V' and fc.cena_s_dph is not null
    order by fc.cena_s_dph asc
    limit 1
  ),
  -- Most expensive available
  peak_expensive as (
    select fc.cena_s_dph, p.name
    from fc join proj p on p.id = fc.project_id
    where fc.stav = 'V' and fc.cena_s_dph is not null
    order by fc.cena_s_dph desc
    limit 1
  ),
  -- Largest unit (max obytna_plocha)
  peak_largest as (
    select fc.obytna_plocha, p.name
    from fc join proj p on p.id = fc.project_id
    where fc.obytna_plocha is not null
    order by fc.obytna_plocha desc
    limit 1
  ),
  -- Highest €/m²
  peak_em as (
    select fc_em.eur_m2, p.name
    from fc_em join proj p on p.id = fc_em.project_id
    order by fc_em.eur_m2 desc
    limit 1
  ),
  -- District averages (€/m²)
  district_avg as (
    select p.district, avg(fc_em.eur_m2) as avg_em
    from fc_em join proj p on p.id = fc_em.project_id
    where p.district is not null and p.district != ''
    group by p.district
  ),
  district_most_expensive as (
    select district, avg_em from district_avg order by avg_em desc nulls last limit 1
  ),
  district_cheapest as (
    select district, avg_em from district_avg order by avg_em asc nulls last limit 1
  ),
  -- District with most P (sold) units
  district_sales as (
    select p.district, count(*) as n
    from fc join proj p on p.id = fc.project_id
    where fc.stav = 'P' and p.district is not null and p.district != ''
    group by p.district
  ),
  district_top_sales as (
    select district, n from district_sales order by n desc limit 1
  ),
  -- Top developer by sold_last_month (from projects table — pre-computed
  -- per-flat stav-transition delta from sync; not derivable from current
  -- snapshot alone, this is genuinely a project-level field).
  dev_top as (
    select developer, sum(coalesce(sold_last_month, 0)) as n
    from proj
    where developer is not null and developer != '' and coalesce(sold_last_month, 0) > 0
    group by developer
    order by n desc
    limit 1
  ),
  -- Avg price by room count (only V status — what's currently for sale)
  avg_2room as (
    select avg(cena_s_dph) as avg_price from fc
    where stav = 'V' and izby = 2 and cena_s_dph is not null and cena_s_dph > 0
  ),
  avg_3room as (
    select avg(cena_s_dph) as avg_price from fc
    where stav = 'V' and izby = 3 and cena_s_dph is not null and cena_s_dph > 0
  ),
  avg_4room as (
    select avg(cena_s_dph) as avg_price from fc
    where stav = 'V' and izby = 4 and cena_s_dph is not null and cena_s_dph > 0
  ),
  -- Overall avg €/m² (V status)
  avg_eur as (
    select avg(eur_m2) as v from fc_em where stav = 'V'
  ),
  -- Helper for SK number formatting (space as thousand separator)
  -- Use translate to convert FM-formatted "5,540" → "5 540"
  fmt as (
    select 1 as dummy  -- placeholder for SQL syntax; macros below use translate() inline
  )

-- Now build each metric row. Each SELECT produces exactly one row.
-- Column order: metric_key, value_numeric, value_text, value_json,
-- category, display_order, last_updated.

select 'total_units_tracked'::text                                                as metric_key,
       counts.n_total::numeric                                                    as value_numeric,
       translate(to_char(counts.n_total, 'FM999G999G999'), ',', ' ') || ' bytov sledovaných' as value_text,
       jsonb_build_object('text_en', counts.n_total || ' units tracked')          as value_json,
       'total'::text                                                              as category,
       9                                                                          as display_order,
       now()                                                                      as last_updated
from counts

union all

select 'total_available', counts.n_avail::numeric,
       translate(to_char(counts.n_avail, 'FM999G999G999'), ',', ' ') || ' bytov v aktívnej ponuke',
       jsonb_build_object('text_en', counts.n_avail || ' units available'),
       'total', 10, now()
from counts

union all

select 'total_reserved', counts.n_reserved::numeric,
       translate(to_char(counts.n_reserved, 'FM999G999G999'), ',', ' ') || ' rezervovaných',
       jsonb_build_object('text_en', counts.n_reserved || ' reserved'),
       'total', 11, now()
from counts

union all

select 'total_sold_to_date', counts.n_sold::numeric,
       translate(to_char(counts.n_sold, 'FM999G999G999'), ',', ' ') || ' predaných celkom',
       jsonb_build_object('text_en', counts.n_sold || ' sold to date'),
       'total', 12, now()
from counts

union all

select 'total_projects_active', active_proj_count.n::numeric,
       active_proj_count.n || ' aktívnych projektov',
       jsonb_build_object('text_en', active_proj_count.n || ' active projects'),
       'total', 13, now()
from active_proj_count

union all

select 'peak_sold_price', peak_sold.cena_s_dph::numeric,
       'Najdrahší predaný: ' || peak_sold.name || ' ' ||
         translate(to_char(peak_sold.cena_s_dph, 'FM999G999G999'), ',', ' ') || ' €',
       jsonb_build_object('text_en',
         'Top sold: ' || peak_sold.name || ' €' || to_char(peak_sold.cena_s_dph, 'FM999,999,999')),
       'peak', 20, now()
from peak_sold

union all

select 'peak_cheapest_available', peak_cheap.cena_s_dph::numeric,
       'Najlacnejší voľný: ' || peak_cheap.name || ' ' ||
         translate(to_char(peak_cheap.cena_s_dph, 'FM999G999G999'), ',', ' ') || ' €',
       jsonb_build_object('text_en',
         'Cheapest available: ' || peak_cheap.name || ' €' || to_char(peak_cheap.cena_s_dph, 'FM999,999,999')),
       'peak', 21, now()
from peak_cheap

union all

select 'peak_most_expensive_available', peak_expensive.cena_s_dph::numeric,
       'Najdrahší voľný: ' || peak_expensive.name || ' ' ||
         translate(to_char(peak_expensive.cena_s_dph, 'FM999G999G999'), ',', ' ') || ' €',
       jsonb_build_object('text_en',
         'Priciest available: ' || peak_expensive.name || ' €' || to_char(peak_expensive.cena_s_dph, 'FM999,999,999')),
       'peak', 22, now()
from peak_expensive

union all

select 'peak_largest_unit', peak_largest.obytna_plocha::numeric,
       'Najväčší byt: ' || peak_largest.name || ' ' ||
         to_char(peak_largest.obytna_plocha, 'FM9999') || ' m²',
       jsonb_build_object('text_en',
         'Largest unit: ' || peak_largest.name || ' ' || to_char(peak_largest.obytna_plocha, 'FM9999') || ' m²'),
       'peak', 23, now()
from peak_largest

union all

select 'peak_highest_eur_m2', peak_em.eur_m2::numeric,
       'Najvyššia €/m²: ' || peak_em.name || ' ' ||
         translate(to_char(peak_em.eur_m2, 'FM999G999'), ',', ' ') || ' €',
       jsonb_build_object('text_en',
         'Peak €/m²: ' || peak_em.name || ' €' || to_char(peak_em.eur_m2, 'FM999,999')),
       'peak', 24, now()
from peak_em

union all

select 'district_most_expensive', district_most_expensive.avg_em::numeric,
       'Najdrahší okres: ' || district_most_expensive.district || ' (' ||
         translate(to_char(district_most_expensive.avg_em, 'FM999G999'), ',', ' ') || ' €/m²)',
       jsonb_build_object('text_en',
         'Most expensive district: ' || district_most_expensive.district || ' (€' ||
           to_char(district_most_expensive.avg_em, 'FM999,999') || '/m²)'),
       'district', 30, now()
from district_most_expensive

union all

select 'district_cheapest', district_cheapest.avg_em::numeric,
       'Najvýhodnejší okres: ' || district_cheapest.district || ' (' ||
         translate(to_char(district_cheapest.avg_em, 'FM999G999'), ',', ' ') || ' €/m²)',
       jsonb_build_object('text_en',
         'Most affordable district: ' || district_cheapest.district || ' (€' ||
           to_char(district_cheapest.avg_em, 'FM999,999') || '/m²)'),
       'district', 31, now()
from district_cheapest

union all

select 'district_most_sales', district_top_sales.n::numeric,
       'Najviac predaných celkom: ' || district_top_sales.district ||
         ' (' || district_top_sales.n || ' bytov)',
       jsonb_build_object('text_en',
         'Most sales total: ' || district_top_sales.district ||
           ' (' || district_top_sales.n || ' units)'),
       'district', 32, now()
from district_top_sales

union all

select 'dev_top_seller', dev_top.n::numeric,
       'Najaktívnejší developer za posledný mesiac: ' || dev_top.developer ||
         ' (' || dev_top.n || ' predaných)',
       jsonb_build_object('text_en',
         'Most active developer last month: ' || dev_top.developer ||
           ' (' || dev_top.n || ' sold)'),
       'developer', 40, now()
from dev_top

union all

select 'avg_price_2room', avg_2room.avg_price::numeric,
       'Priemer 2-izbových: ' ||
         translate(to_char(avg_2room.avg_price, 'FM999G999G999'), ',', ' ') || ' €',
       jsonb_build_object('text_en',
         'Avg 2-room: €' || to_char(avg_2room.avg_price, 'FM999,999,999')),
       'pricing', 50, now()
from avg_2room
where avg_2room.avg_price is not null

union all

select 'avg_price_3room', avg_3room.avg_price::numeric,
       'Priemer 3-izbových: ' ||
         translate(to_char(avg_3room.avg_price, 'FM999G999G999'), ',', ' ') || ' €',
       jsonb_build_object('text_en',
         'Avg 3-room: €' || to_char(avg_3room.avg_price, 'FM999,999,999')),
       'pricing', 51, now()
from avg_3room
where avg_3room.avg_price is not null

union all

select 'avg_price_4room', avg_4room.avg_price::numeric,
       'Priemer 4-izbových: ' ||
         translate(to_char(avg_4room.avg_price, 'FM999G999G999'), ',', ' ') || ' €',
       jsonb_build_object('text_en',
         'Avg 4-room: €' || to_char(avg_4room.avg_price, 'FM999,999,999')),
       'pricing', 52, now()
from avg_4room
where avg_4room.avg_price is not null

union all

select 'avg_eur_m2', avg_eur.v::numeric,
       'Priemerná cena: ' ||
         translate(to_char(avg_eur.v, 'FM999G999'), ',', ' ') || ' €/m² naprieč BA',
       jsonb_build_object('text_en',
         'Avg €/m²: €' || to_char(avg_eur.v, 'FM999,999') || ' across BA'),
       'pricing', 53, now()
from avg_eur
where avg_eur.v is not null;

comment on view public.metrics is
  'Live ticker metrics derived from flats_archive (latest snapshot_month) + projects. Same shape as the dropped table; callers unchanged. Refreshed on every read — no maintenance.';
