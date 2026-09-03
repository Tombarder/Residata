-- Runtime errors from signed-in users' browsers.
--
-- Why this exists, concretely: on 2026-09-03 a billing panel shipped with a
-- reference to a variable that did not exist in that component. The build
-- passed, every test passed, the three legal pages were checked in a browser —
-- and the page would have thrown for any PAYING customer who opened it. Nobody
-- would have found out except the customer, because that page cannot be reached
-- without an active subscription. Eslint happened to catch it. Next time it
-- might not.
--
-- That is the shape of the blind spot: the parts of the product that only a
-- paying user can reach are exactly the parts our own testing never executes.
--
-- DELIBERATELY AUTHENTICATED-ONLY. An anonymous insert endpoint on a public
-- marketing site is a table anyone can fill, and it would buy coverage of the
-- pages we already exercise constantly. The signed-in half is both the blind
-- spot and the half we can attribute, rate-limit per user and clean up.

create table if not exists public.client_errors (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  occurred_at  timestamptz not null default now(),
  kind         text not null,                 -- 'error' | 'unhandledrejection' | 'boundary'
  message      text not null,
  stack        text,
  path         text,                          -- route only; never the query string
  user_agent   text,
  build        text,                          -- which deploy, so a fixed bug stops counting
  constraint client_errors_message_len check (char_length(message) <= 2000),
  constraint client_errors_stack_len   check (stack is null or char_length(stack) <= 8000),
  constraint client_errors_kind        check (kind in ('error', 'unhandledrejection', 'boundary'))
);

comment on table public.client_errors is
  'Runtime errors reported by the browsers of signed-in users. Authenticated inserts only, own row only; readable by admins. Retained 90 days.';
comment on column public.client_errors.path is
  'Route path only. The query string is stripped client-side because it can carry filter values a user typed.';

create index if not exists client_errors_recent_idx on public.client_errors (occurred_at desc);
create index if not exists client_errors_message_idx on public.client_errors (message, occurred_at desc);

alter table public.client_errors enable row level security;

-- A signed-in user may report their OWN error and nothing else. They cannot
-- read the table at all, including their own rows — there is no product reason
-- to and it keeps one user's stack traces away from another's.
drop policy if exists client_errors_insert_own on public.client_errors;
create policy client_errors_insert_own on public.client_errors
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists client_errors_read_admin on public.client_errors;
create policy client_errors_read_admin on public.client_errors
  for select to authenticated
  using (public.current_user_is_admin());

-- Retention. Stack traces are diagnostic, not history: an error nobody looked
-- at in three months is not going to be looked at. Called by the existing daily
-- housekeeping cron; safe to run by hand.
create or replace function public.prune_client_errors()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare removed integer;
begin
  delete from public.client_errors where occurred_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Scheduled alongside the two prunes already running in this database
-- (prune-ai-usage-log 03:00, prune-admin-audit-log 03:15), so the whole
-- retention window sits in one place rather than in three different systems.
select cron.schedule('prune-client-errors', '30 3 * * *',
                     $$select public.prune_client_errors()$$)
where not exists (select 1 from cron.job where jobname = 'prune-client-errors');
