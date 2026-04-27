-- projects_live — every project row with real, live aggregate counts
-- derived from flats_archive (latest month). Shape mirrors `projects`
-- so existing consumers keep working — they just see fresh, honest
-- numbers instead of the registry-inflated total_units / sold_units
-- that the projects table carries for manual_total projects.
--
-- What the view changes vs. the projects table:
--
--   total_units       — was: stored value (manual_total override sets
--                       Slnečnice = 4000 even though we track ~50)
--                       now: real count of flats we have in the
--                       archive for this project this month
--   available_units   — same as table (always real per-stav count)
--   sold_units        — was: estimated from manual_total when override
--                       active; was the same as real count otherwise
--                       now: real count of stav='P' flats this month
--   reserved_units / prereserved / future / error — same as table,
--                       always counted from stav, never inflated
--   sold_percentage   — was: sold / total (where total may be inflated)
--                       now: (sold + reserved + prereserved) /
--                       (total - future - error), all from real counts
--   avg_price_eur_m2  — was: stored value (computed at sync time)
--                       now: live arithmetic mean of cena/area across
--                       this project's V+R+PR flats
--   min_price/max_price — same as table for now (small impact)
--
-- Pass-through columns from projects:
--   id, name, status, district, sub_district, developer, project_url,
--   kolaudacia, cast_mesta_kod, interna_klas_zona, ulica_detail,
--   budova_stav, standard, is_top20, last_updated, last_seen_at,
--   sold_last_month
--
-- Projects without any flats in flats_archive (paused/sold_out projects
-- whose flats were never scraped, or new entries pending first scrape)
-- get all aggregate columns as 0 / null. They still appear in the list
-- with their metadata — so the /live page shows every project, just
-- honest about which ones have data and which don't.

drop view if exists public.projects_live cascade;

create view public.projects_live
with (security_invoker = false)
as
with latest as (
  select max(snapshot_month) as m from public.flats_archive
),
per_project as (
  select
    project_id,
    count(*)                                                 as total_units,
    count(*) filter (where stav = 'V')                       as available_units,
    count(*) filter (where stav = 'P')                       as sold_units,
    count(*) filter (where stav = 'R')                       as reserved_units,
    count(*) filter (where stav = 'PR')                      as prereserved_units,
    count(*) filter (where stav = 'Ešte nie v ponuke')       as future_units,
    count(*) filter (where stav = 'ERROR')                   as error_units,
    round(
      avg(cena_s_dph / nullif(obytna_plocha, 0))
        filter (where cena_s_dph > 0 and obytna_plocha > 0 and stav in ('V', 'R', 'PR'))::numeric,
      2
    )                                                        as avg_price_eur_m2,
    min(cena_s_dph)
      filter (where cena_s_dph > 0 and stav in ('V', 'R', 'PR')) as min_price,
    max(cena_s_dph)
      filter (where cena_s_dph > 0 and stav in ('V', 'R', 'PR')) as max_price
  from public.flats_archive fa
  cross join latest
  where fa.snapshot_month = latest.m
  group by project_id
)
select
  -- Identity / metadata — straight from projects
  p.id,
  p.name,
  p.status,
  p.district,
  p.sub_district,
  p.developer,
  p.project_url,
  p.kolaudacia,
  p.cast_mesta_kod,
  p.interna_klas_zona,
  p.ulica_detail,
  p.budova_stav,
  p.standard,
  p.is_top20,
  p.last_updated,
  p.last_seen_at,
  p.sold_last_month,
  -- Manual data-source flag (true = user-maintained Raw, not scraper).
  -- Surfaces that want a "Manual" badge can read this without filtering
  -- by it; status='active' covers both auto and manual.
  coalesce(p.is_manual, false)                              as is_manual,
  -- Live aggregates (from flats_archive, not from projects table)
  coalesce(pp.total_units, 0)                                as total_units,
  coalesce(pp.available_units, 0)                            as available_units,
  coalesce(pp.sold_units, 0)                                 as sold_units,
  coalesce(pp.reserved_units, 0)                             as reserved_units,
  coalesce(pp.prereserved_units, 0)                          as prereserved_units,
  coalesce(pp.future_units, 0)                               as future_units,
  coalesce(pp.error_units, 0)                                as error_units,
  pp.avg_price_eur_m2,
  pp.min_price,
  pp.max_price,
  -- sold_percentage = (sold + reserved + prereserved) / (total - future - error)
  -- when there's any sales signal; null when developer doesn't publish.
  case
    when coalesce(pp.total_units, 0) - coalesce(pp.future_units, 0) - coalesce(pp.error_units, 0) > 0
     and (coalesce(pp.sold_units, 0) + coalesce(pp.reserved_units, 0) + coalesce(pp.prereserved_units, 0)) > 0
    then round(
      100.0 *
        (coalesce(pp.sold_units, 0) + coalesce(pp.reserved_units, 0) + coalesce(pp.prereserved_units, 0))::numeric
        /
        (coalesce(pp.total_units, 0) - coalesce(pp.future_units, 0) - coalesce(pp.error_units, 0))::numeric,
      1
    )
    else null
  end                                                        as sold_percentage,
  -- Provenance — which month these aggregates are from
  latest.m                                                    as snapshot_month
from public.projects p
left join per_project pp on pp.project_id = p.id
cross join latest;

comment on view public.projects_live is
  'Projects with live aggregate counts from flats_archive (latest month). Same shape as projects, but total_units/sold_units/sold_percentage/avg_price are always derived from real flat counts — no manual_total inflation.';
