-- Single source of truth for unit-level data: flats_archive.
--
-- Before this migration, two near-duplicate tables existed:
--   · flats          — current snapshot, overwritten every sync
--   · flats_archive  — append-only, every flat from every month
-- That's two places to keep in sync, two places where bugs can drift,
-- two places where RLS has to match. Long-term, having `flats` as a
-- table that semantically means "the latest month from flats_archive"
-- is brittle.
--
-- This migration:
--   1) Creates a VIEW `flats_current` that ALWAYS shows the rows from
--      the most recent snapshot_month in flats_archive. Nothing to
--      maintain — Postgres re-evaluates on every read.
--   2) Drops the old `flats` table. Sync stops writing to it (separate
--      change in sync_to_supabase.py).
--
-- RLS:
--   The view uses `security_invoker = true` (Postgres 15+) so the
--   underlying flats_archive RLS applies — paid/admin/active-trial
--   sees everything, free users see only their chosen_project_id.
--   Identical gate to the old flats table; no security regression.
--
-- Why a view (not a materialised view):
--   · Reads are cheap — index on (snapshot_month desc) + (project_id,
--     snapshot_month desc) makes the MAX(snapshot_month) lookup O(log n)
--     and the equality filter O(log n) too.
--   · No refresh step → no chance of stale "current" view diverging
--     from archive after a sync that crashed mid-write.
--   · Equivalent to "live computed" and that's what we want.

create or replace view public.flats_current
with (security_invoker = true)
as
select * from public.flats_archive
where snapshot_month = (select max(snapshot_month) from public.flats_archive);

comment on view public.flats_current is
  'Latest month from flats_archive. Read-only live view, security_invoker so RLS on the underlying table applies.';

-- Drop the old flats table. Anything still pointing at it (from a
-- previously-deployed bundle in someone''s browser cache) will see
-- a 404; that''s acceptable — bundles refresh within a few minutes
-- and the writer side (sync_to_supabase.py) is updated in the same
-- commit so no new rows would land here anyway.
drop table if exists public.flats cascade;
