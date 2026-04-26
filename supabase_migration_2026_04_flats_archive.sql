-- Unit-level historical archive — every flat from every monthly run.
--
-- Why:
--   The platform Pivot was reading from `flats` (current state only,
--   overwritten each sync). Users could pivot by district / developer /
--   room count — but only "for now". They couldn't compare months or
--   slice across time the way they can in the Sheets pivot over Clean
--   Master. This table fixes that by mirroring Clean Master's row-level
--   history into Postgres so the platform pivot finally matches the
--   capability of Sheets.
--
-- Shape:
--   Same columns as `flats` plus:
--     · snapshot_month — 'YYYY-MM' tag of the sync run that captured it
--     · batch_id       — original scraper batch_id from the Raw sheet
--     · created_at     — when the row landed in the archive
--   The unique key (snapshot_month, project_id, unit_id) means each
--   unit appears at most once per month — re-running the same month
--   updates rather than duplicates, mirroring project_snapshots.
--
-- RLS:
--   Same gating as `flats` — a user with paid/admin/active-trial sees
--   everything; free users see only their chosen_project_id.
--
-- Sanity:
--   Same CHECK constraints as flats_sanity migration. NULL allowed,
--   negative/zero rejected (with the exception of optional outdoor
--   areas which permit 0 = "no balcony / no garden / etc.").

create table if not exists public.flats_archive (
  id              bigserial primary key,
  snapshot_month  text not null,
  batch_id        text not null,
  project_id      text not null,
  unit_id         text not null,
  typ             text,
  etapa           text,
  budova          text,
  unit_detail     text,
  poschodie       int,
  izby            numeric,
  obytna_plocha   numeric,
  balkon_plocha   numeric,
  loggia_plocha   numeric,
  terasa_plocha   numeric,
  zahrada_plocha  numeric,
  exterier_plocha numeric,
  kobka_plocha    numeric,
  celkova_plocha  numeric,
  cena_bez_dph    numeric,
  cena_s_dph      numeric,
  cena_s_dph_text text,
  cennikova_cena  numeric,
  stav            text,
  kolaudacia      text,
  orientacia      text,
  created_at      timestamptz default now(),
  unique (snapshot_month, project_id, unit_id)
);

-- Indexes — designed for the platform Pivot's query patterns:
--   · "show me the latest month"      → idx_flats_archive_month
--   · "this project's full timeline"  → idx_flats_archive_project_month
--   · "single batch lookup / debug"   → idx_flats_archive_batch
--   · "stav distribution per month"   → idx_flats_archive_stav
create index if not exists idx_flats_archive_month
  on public.flats_archive (snapshot_month desc);
create index if not exists idx_flats_archive_project_month
  on public.flats_archive (project_id, snapshot_month desc);
create index if not exists idx_flats_archive_batch
  on public.flats_archive (batch_id);
create index if not exists idx_flats_archive_stav
  on public.flats_archive (stav);

-- RLS — mirror the existing flats policy exactly.
alter table public.flats_archive enable row level security;

drop policy if exists flats_archive_read_gated on public.flats_archive;
create policy flats_archive_read_gated on public.flats_archive
  for select using (
    current_user_is_paid() or current_user_chosen_project() = project_id
  );

-- Sanity constraints — mirror flats_sanity. parse_num in sync rejects
-- 0 / negatives at insertion, so these constraints are zero-cost
-- defense in depth (unless something bypasses the sync path).
alter table public.flats_archive
  drop constraint if exists flats_archive_cena_s_dph_sane,
  drop constraint if exists flats_archive_cena_bez_dph_sane,
  drop constraint if exists flats_archive_obytna_plocha_sane,
  drop constraint if exists flats_archive_balkon_plocha_sane,
  drop constraint if exists flats_archive_loggia_plocha_sane,
  drop constraint if exists flats_archive_terasa_plocha_sane,
  drop constraint if exists flats_archive_zahrada_plocha_sane,
  drop constraint if exists flats_archive_celkova_plocha_sane,
  drop constraint if exists flats_archive_izby_sane,
  drop constraint if exists flats_archive_cennikova_cena_sane;

alter table public.flats_archive
  add constraint flats_archive_cena_s_dph_sane     check (cena_s_dph     is null or cena_s_dph     > 0),
  add constraint flats_archive_cena_bez_dph_sane   check (cena_bez_dph   is null or cena_bez_dph   > 0),
  add constraint flats_archive_obytna_plocha_sane  check (obytna_plocha  is null or obytna_plocha  > 0),
  add constraint flats_archive_balkon_plocha_sane  check (balkon_plocha  is null or balkon_plocha  >= 0),
  add constraint flats_archive_loggia_plocha_sane  check (loggia_plocha  is null or loggia_plocha  >= 0),
  add constraint flats_archive_terasa_plocha_sane  check (terasa_plocha  is null or terasa_plocha  >= 0),
  add constraint flats_archive_zahrada_plocha_sane check (zahrada_plocha is null or zahrada_plocha >= 0),
  add constraint flats_archive_celkova_plocha_sane check (celkova_plocha is null or celkova_plocha > 0),
  add constraint flats_archive_izby_sane           check (izby           is null or izby           > 0),
  add constraint flats_archive_cennikova_cena_sane check (cennikova_cena is null or cennikova_cena > 0);
