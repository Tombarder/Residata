-- Defense-in-depth: DB-level CHECK constraints on flats so 0 /
-- negative values can never enter the table — regardless of which
-- code path tries.
--
-- Today the scraper's parse_num already converts these to NULL on
-- the way in (sync_to_supabase.py::parse_num returns None for any
-- value <= 0). DB has zero existing rows that would violate, so
-- adding these constraints is risk-free.
--
-- Why these constraints + scraper rule both:
--   · Scraper rule (parse_num) — fast, friendly first wall, logs
--     where bad data came from.
--   · DB constraints — final wall, defends against any future
--     code path (manual SQL edits, alternative ETL, new admin
--     tooling) that bypasses parse_num.
--
-- Convention:
--   · Prices, total areas, room count: NULL allowed, value > 0.
--   · Optional outdoor extras (balkon, loggia, terasa, zahrada):
--     NULL allowed, value >= 0  — a 0 here legitimately means
--     "the unit doesn't have a balcony", different from total
--     area which can never be 0.

alter table public.flats
  drop constraint if exists flats_cena_s_dph_sane,
  drop constraint if exists flats_cena_bez_dph_sane,
  drop constraint if exists flats_obytna_plocha_sane,
  drop constraint if exists flats_balkon_plocha_sane,
  drop constraint if exists flats_loggia_plocha_sane,
  drop constraint if exists flats_terasa_plocha_sane,
  drop constraint if exists flats_zahrada_plocha_sane,
  drop constraint if exists flats_celkova_plocha_sane,
  drop constraint if exists flats_izby_sane,
  drop constraint if exists flats_cennikova_cena_sane;

alter table public.flats
  add constraint flats_cena_s_dph_sane     check (cena_s_dph     is null or cena_s_dph     > 0),
  add constraint flats_cena_bez_dph_sane   check (cena_bez_dph   is null or cena_bez_dph   > 0),
  add constraint flats_obytna_plocha_sane  check (obytna_plocha  is null or obytna_plocha  > 0),
  add constraint flats_balkon_plocha_sane  check (balkon_plocha  is null or balkon_plocha  >= 0),
  add constraint flats_loggia_plocha_sane  check (loggia_plocha  is null or loggia_plocha  >= 0),
  add constraint flats_terasa_plocha_sane  check (terasa_plocha  is null or terasa_plocha  >= 0),
  add constraint flats_zahrada_plocha_sane check (zahrada_plocha is null or zahrada_plocha >= 0),
  add constraint flats_celkova_plocha_sane check (celkova_plocha is null or celkova_plocha > 0),
  add constraint flats_izby_sane           check (izby           is null or izby           > 0),
  add constraint flats_cennikova_cena_sane check (cennikova_cena is null or cennikova_cena > 0);

-- Verification:
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.flats'::regclass
--     and conname like '%sane%';
