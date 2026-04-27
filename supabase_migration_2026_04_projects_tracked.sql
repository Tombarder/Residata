-- Add total_projects_tracked to market_totals.
--
-- WHAT IT IS:
--   Count of distinct projects that have at least one snapshot in
--   flats_archive. This is "depth of historical coverage" — every project
--   we've ever scraped stays counted forever, even after it sells out.
--
-- WHY (vs. total_projects_active):
--   - total_projects_active stays roughly flat over time: as projects sell
--     out and new ones launch, the in-market count oscillates around ~65.
--   - total_projects_tracked grows monotonically: every project that ever
--     enters our tracking adds +1 forever. After 2 years we'll have ~120.
--     After 5 years ~200+. This is the right number to surface as
--     "depth of dataset" — banks, valuers, investors care about
--     comparable-transaction depth, which is exactly the sold-out projects
--     we still hold archive data for.
--
-- WHY join on flats_archive (not just projects.status='sold_out'):
--   The projects table has 17 legacy sold-out projects with NO archive
--   data — they were added to the registry but never scraped (project
--   already sold out before we started tracking it). We don't want to
--   count those as "tracked" because we have zero historical data for
--   them. By joining on flats_archive, only projects with real snapshots
--   count. Legacy sold-out → ignored. New projects that sell out while
--   we track them → counted forever (because their snapshots stay in
--   flats_archive).
--
-- TODAY:
--   total_projects_active     = 65 (or 66 once Danubius is unpaused)
--   total_projects_tracked    = 65 (same — nothing has sold out under our
--                                   tracking yet)
--   They diverge starting with the first sold-out under tracking.

create or replace view public.market_totals as
with latest as (
  select max(snapshot_month) as m from public.flats_archive
)
select
  (select count(*)
     from public.flats_archive fa
     join public.projects p on p.id = fa.project_id
     where fa.snapshot_month = latest.m
       and p.status = 'active')                              as total_units_tracked,
  (select count(*)
     from public.flats_archive fa
     join public.projects p on p.id = fa.project_id
     where fa.snapshot_month = latest.m
       and p.status = 'active'
       and fa.stav = 'V')                                    as total_available,
  (select count(*)
     from public.flats_archive fa
     join public.projects p on p.id = fa.project_id
     where fa.snapshot_month = latest.m
       and p.status = 'active'
       and fa.stav = 'P')                                    as total_sold,
  (select count(*)
     from public.flats_archive fa
     join public.projects p on p.id = fa.project_id
     where fa.snapshot_month = latest.m
       and p.status = 'active'
       and fa.stav in ('R', 'PR'))                           as total_reserved,
  (select round(avg(fa.cena_s_dph / fa.obytna_plocha)::numeric, 0)
     from public.flats_archive fa
     join public.projects p on p.id = fa.project_id
     where fa.snapshot_month = latest.m
       and p.status = 'active'
       and fa.stav = 'V'
       and fa.cena_s_dph > 0
       and fa.obytna_plocha > 0)                             as avg_eur_m2,
  latest.m                                                   as snapshot_month,
  (select coalesce(sum(coalesce(p.sold_last_month, 0)), 0)::int
     from public.projects p
     where p.status = 'active')                              as total_sold_last_month,
  (select count(*)::int
     from public.projects p
     where p.status = 'active')                              as total_projects_active,
  (select count(distinct p.developer)::int
     from public.projects p
     where p.status = 'active'
       and p.developer is not null
       and p.developer != '')                                as total_developers_active,
  -- NEW: projects with at least one snapshot in flats_archive.
  -- Includes sold-out / paused projects that were tracked (have archive
  -- data) — but excludes legacy sold-out projects with no archive data.
  (select count(distinct fa.project_id)::int
     from public.flats_archive fa
     where fa.project_id is not null)                        as total_projects_tracked
from latest;


-- Add total_projects_tracked to the metrics view (the rotating ticker
-- display on the homepage). Same definition as in market_totals: distinct
-- project_ids that ever appeared in flats_archive — not legacy registry-
-- only sold-outs.
--
-- We keep total_projects_active as a separate metric row alongside it; the
-- Ticker rotates through both, so visitors see "65 aktívnych projektov"
-- followed a few seconds later by "65 projektov v databáze" (today they
-- match; over time the second number grows past the first).

create or replace view public.metrics as
with
  latest as (
    select max(snapshot_month) as m from public.flats_archive
  ),
  fc as (
    select fa.*, p.status as project_status, p.name as project_name, p.district as project_district, p.developer as project_developer
    from public.flats_archive fa
    join public.projects p on p.id = fa.project_id
    cross join latest
    where fa.snapshot_month = latest.m
      and p.status = 'active'
  ),
  proj as (
    select * from public.projects
  ),
  fc_em as (
    select fc.*, fc.cena_s_dph / nullif(fc.obytna_plocha, 0) as eur_m2
    from fc
    where fc.cena_s_dph > 0 and fc.obytna_plocha > 0
  ),
  counts as (
    select
      count(*)                                                 as n_total,
      count(*) filter (where stav = 'V')                       as n_avail,
      count(*) filter (where stav = 'P')                       as n_sold,
      count(*) filter (where stav in ('R','PR'))               as n_reserved
    from fc
  ),
  active_proj_count as (
    select count(*) as n from proj where status = 'active'
  ),
  tracked_proj_count as (
    select count(distinct project_id) as n
    from public.flats_archive
    where project_id is not null
  ),
  peak_sold as (
    select fc.cena_s_dph, fc.project_name as name
    from fc
    where fc.stav = 'P' and fc.cena_s_dph is not null
    order by fc.cena_s_dph desc
    limit 1
  ),
  peak_cheap as (
    select fc.cena_s_dph, fc.project_name as name
    from fc
    where fc.stav = 'V' and fc.cena_s_dph is not null
    order by fc.cena_s_dph asc
    limit 1
  ),
  peak_expensive as (
    select fc.cena_s_dph, fc.project_name as name
    from fc
    where fc.stav = 'V' and fc.cena_s_dph is not null
    order by fc.cena_s_dph desc
    limit 1
  ),
  peak_largest as (
    select fc.obytna_plocha, fc.project_name as name
    from fc
    where fc.obytna_plocha is not null
    order by fc.obytna_plocha desc
    limit 1
  ),
  peak_em as (
    select fc_em.eur_m2, fc_em.project_name as name
    from fc_em
    order by fc_em.eur_m2 desc
    limit 1
  ),
  district_avg as (
    select fc_em.project_district as district, avg(fc_em.eur_m2) as avg_em
    from fc_em
    where fc_em.project_district is not null and fc_em.project_district != ''
    group by fc_em.project_district
  ),
  district_most_expensive as (
    select district, avg_em from district_avg order by avg_em desc nulls last limit 1
  ),
  district_cheapest as (
    select district, avg_em from district_avg order by avg_em asc nulls last limit 1
  ),
  district_sales as (
    select fc.project_district as district, count(*) as n
    from fc
    where fc.stav = 'P' and fc.project_district is not null and fc.project_district != ''
    group by fc.project_district
  ),
  district_top_sales as (
    select district, n from district_sales order by n desc limit 1
  ),
  dev_top as (
    select developer, sum(coalesce(sold_last_month, 0)) as n
    from proj
    where developer is not null and developer != '' and coalesce(sold_last_month, 0) > 0
    group by developer
    order by n desc
    limit 1
  ),
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
  avg_eur as (
    select avg(eur_m2) as v from fc_em where stav = 'V'
  )

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
-- New rotating ticker entry: depth-of-dataset (active + sold-out under
-- tracking). Today this matches active; will diverge over time.
select 'total_projects_tracked', tracked_proj_count.n::numeric,
       tracked_proj_count.n || ' projektov v databáze',
       jsonb_build_object('text_en', tracked_proj_count.n || ' projects in dataset'),
       'total', 14, now()
from tracked_proj_count

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
