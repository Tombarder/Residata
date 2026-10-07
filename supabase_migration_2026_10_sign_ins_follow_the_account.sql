-- 2026-10-07 — a person's sign-in record goes when their account goes.
--
-- public.user_sign_ins (supabase_migration_2026_10_user_activity_profile.sql, applied
-- the same day with Boss's yes) holds time, browser and network address per sign-in.
-- It was created without a link to the account, so deleting an account
-- (api/admin/delete-user.js, or self-delete) left those rows behind — found the same
-- day when two test sign-ups were deleted and their two sign-in rows stayed. Personal
-- data of a deleted person must not outlive the account; the other per-person tables
-- either cascade from auth.users or are erased by delete-user.js.
--
-- 1. remove the rows of accounts that no longer exist (the two test sign-ups);
-- 2. link the table to auth.users ON DELETE CASCADE, like user_profiles,
--    user_dashboards, user_map_areas and client_errors.
-- A sign-in still cannot fail because of this table: log_user_sign_in() swallows
-- every error, a foreign-key one included.

begin;

delete from public.user_sign_ins s
 where not exists (select 1 from auth.users u where u.id = s.user_id);

alter table public.user_sign_ins drop constraint if exists user_sign_ins_user_id_fkey;
alter table public.user_sign_ins
  add constraint user_sign_ins_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

commit;
