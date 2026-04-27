-- Add is_manual flag to projects + immediate fix-up for the 8 known
-- manual projects whose status was 'paused' from the last pre-fix sync.
--
-- Why this column:
--   `status` answers "should we show this project?" (active/paused/sold_out/archived).
--   `is_manual` answers "where does this project's data come from?"
--   (true = user fills the Raw sheet by hand; false = scraper).
--   Two separate questions → two separate fields. The Status column
--   used to be overloaded (paused = either "really paused" OR
--   "manual project where col M says paused but data is being filled
--   by hand") which made every filter site have to know about the
--   col-B trick. With is_manual it's clean.
--
-- Sync semantics (sync_to_supabase.py companion change):
--   For projects whose registry col B contains "manual" (any case,
--   any variant — Manual / Manualne / Manual, price on request):
--     · status = 'active'   (so they show on /live and everywhere
--                            else that filters by active — same as
--                            auto-scraped active projects)
--     · is_manual = true   (so we can distinguish them in the UI
--                            with a small "Manual" badge later if
--                            desired, and so admin tooling can see
--                            "data source: manual")
--   For auto-scraped projects: is_manual = false (default).
--
-- Scraper safety:
--   The scraper does NOT use the is_manual column. Its skip rule is
--   based on registry col M ('paused') OR empty scrape_mode. Manual
--   projects always have empty scrape_mode → scraper never tries them.
--   So promoting their status to 'active' has zero risk of triggering
--   automated scraping.

alter table public.projects
  add column if not exists is_manual boolean not null default false;

comment on column public.projects.is_manual is
  'True when project''s flat data is filled manually (col B in registry contains "manual"). Status remains active for these — separate flag, separate concern.';

-- Immediate fix-up: the 8 known manual projects currently sitting in
-- DB with status='paused' from the pre-fix sync. After this they show
-- up everywhere active projects do, with the is_manual flag set so
-- the UI can render them with a "Manual" badge later.
--
-- This list is the result of `select id from projects where id in
-- (manual project slugs)`. Source: the registry sheet col B contains
-- "manual" for these. Scraper has no Raw / no scrape_mode for them,
-- so they're not scraped — only manual_append.py writes their Raw.
update public.projects
   set status = 'active',
       is_manual = true
 where id in (
   'altum',
   'bory',
   'ceresne-living-dubravka',
   'eurovea-tower',
   'hausberg',
   'ister-tower',
   'matadorka',
   'rezidencia-medici'
 );

-- The next sync run will overwrite this with the same values via the
-- sync_to_supabase.py change (load_registry detects col B 'manual',
-- aggregate_project sets is_manual + promotes status). So the manual
-- update + sync change agree — no drift possible.
