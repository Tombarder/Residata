-- Filter all public aggregate views to status='active' projects only.
--
-- Why: aggregate views (market_totals, district_totals, metrics) were
-- counting EVERY flat in the latest snapshot of flats_archive, including
-- flats whose project is now status='paused'. Those are stale — paused
-- means the user has stopped tracking the project (e.g. scraper broken,
-- developer site dead), so the last-known flats sit in the archive but
-- don't reflect current reality.
--
-- Concrete impact before this fix:
--   · Homepage "5 540 bytov sledovaných" included 146 stale flats from
--     8 paused projects (Apollo, Ganz, Metropolis, Okanikova, Palais
--     Esterhazy, Rezidencia k Železnej Studienke, Tomachic, Danubius).
--   · /live page sum of project rows = 5 394 (active only).
--   · Numbers didn't match across pages → "two sources of truth".
--   · Next month, paused-project flats wouldn't be re-upserted, so
--     5 540 would silently drop to ~5 400 — looks like market decline,
--     actually just our tracking shrinking.
--
-- After this fix:
--   · Every "current market" surface uses status='active' (which now
--     includes manual projects — see is_manual flag commit).
--   · Homepage / Ticker / Dashboard / Reports all show the same
--     count (5 394 today, will rise as more projects come online).
--   · Sold-out and paused projects don't pollute "live market" totals.
--
-- The Pivot (useFlatsArchive) is unaffected — it reads flats_archive
-- directly without status filtering, because users may want to pivot
-- across paused/sold-out historical data too. That's the right call
-- there: archive = full knowledge base, market_totals = current state.

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
  latest.m                                                   as snapshot_month
from latest;


-- district_totals already joins projects, just add the active filter
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
  round(
    avg(fa.cena_s_dph / fa.obytna_plocha)
      filter (where fa.cena_s_dph > 0 and fa.obytna_plocha > 0)::numeric,
    0
  )                                                          as avg_eur_m2,
  latest.m                                                   as snapshot_month
from public.flats_archive fa
join public.projects p on p.id = fa.project_id
cross join latest
where fa.snapshot_month = latest.m
  and p.status = 'active'   -- exclude paused / sold_out / archived
  and p.district is not null
  and p.district != ''
group by p.district, latest.m;


-- metrics view: re-define with active-only filtering across all rows.
-- Same shape as before; same row keys; same display order. Only the
-- filter changes — every flat-level aggregate is now scoped to flats
-- in active projects only.
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
