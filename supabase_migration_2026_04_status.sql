-- ============================================================
-- Residata — migration 2026-04: project status + last_seen
-- Spusti v Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================
--
-- Pridáva status tracking pre projekty. Pred touto migráciou sync
-- hard-deletoval projekty ktoré zmizli zo sheetu → historická strata.
-- Po tejto migrácii:
--   active    = aktuálne scrapujeme (default)
--   sold_out  = vypredaný, last-known data zostávajú
--   paused    = scraping rozbitý / pozastavený, data nemá zmysel
--   archived  = manuálne alebo auto (zmizol zo sheetu úplne)
--
-- Migrácia je idempotentná — re-running ju nepoškodí.

-- ─── projects ───────────────────────────────────────────
alter table public.projects
  add column if not exists status text not null default 'active',
  add column if not exists last_seen_at timestamptz not null default now();

-- Check constraint — enumerovať validné statusy.
-- DROP IF EXISTS pre idempotenciu (ALTER TABLE ADD CONSTRAINT nemá IF NOT EXISTS).
alter table public.projects
  drop constraint if exists projects_status_valid;
alter table public.projects
  add constraint projects_status_valid
    check (status in ('active', 'sold_out', 'paused', 'archived'));

-- Index pre frontend default-filter (status = 'active')
create index if not exists idx_projects_status on public.projects(status);

-- ─── project_snapshots ──────────────────────────────────
-- Status pri snapshotoch je voliteľný — ak nebude, frontend to bude
-- interpretovať ako 'active' pre spätnú kompatibilitu s predošlými
-- snapshotmi ktoré status vôbec nemali.
alter table public.project_snapshots
  add column if not exists status text default 'active';

-- ─── done ──────────────────────────────────────────────
-- Overenie:
--   select id, name, status, last_seen_at from public.projects limit 5;
--   → všetky existujúce riadky by mali mať status='active' a
--     last_seen_at = NOW() (default).
