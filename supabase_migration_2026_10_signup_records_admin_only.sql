-- 2026-10-06 — sign-up records are the admin's, not every subscriber's.
--
-- public.events began as the market-event feed (price changes — "history = paid
-- feature"), so it got a read policy for paying users, events_read_paid. The market
-- feed has long since moved out; the table now holds only sign-up rows, written by
-- handle_new_user and api/admin/create-user, each with the person's e-mail address in
-- new_value. current_user_is_paid() is also true during a 7-day trial, so anyone who
-- signed up with a work e-mail could read, with their own session over the REST API,
-- the address of everyone who had ever signed up. Measured before this change, as an
-- ordinary (non-admin) Premium user in a rolled-back transaction: 55 rows, 37 distinct
-- addresses.
--
-- The only reader is the admin Users page (src/pages/LivePages.jsx, loadAll), which
-- events_read_admin covers; the writers run as SECURITY DEFINER / the service key and
-- need no policy. Guarded nightly by integrity_check personal_data_admin_only
-- (novostavby), which reads as a real non-admin customer and fails on any row of
-- someone else's personal data.

drop policy if exists events_read_paid on public.events;
