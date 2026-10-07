-- 2026-10-07 — one page per person in admin: what they do, when, how and how much.
--
-- Boss 2026-10-07: "a measurement of activity for each user … what he's doing, when,
-- how, how much … per user visible on the admin part of website". The admin already had
-- a raw event list (admin_user_timeline) and a per-user row of totals
-- (admin_usage_users); neither answers "is this customer actually using it, and for
-- what?". admin_user_activity answers it in ONE call, so the page (UserActivity.jsx)
-- never pulls raw rows into the browser.
--
-- Three gaps it closes:
--   1. SIGN-INS WERE NOT KEPT. auth.sessions loses its row the moment a person signs
--      out, and auth.audit_log_entries is empty on this project, so "when did they
--      come?" had no lasting answer. public.user_sign_ins keeps one row per sign-in
--      (time, browser, network address). It is a security record (account sharing,
--      a stolen account), covered by the privacy policy's "Technical data: IP address,
--      browser type" under legitimate interest — not by the analytics cookie, so it is
--      complete for everybody. Kept 13 months (pg_cron job prune-user-sign-ins, nightly,
--      like the other prune-* jobs).
--   2. "DECLINED COOKIES" LOOKED LIKE "DOES NOTHING". Page and feature events are
--      recorded only with analytics consent (src/lib/track.js). The choice was kept in
--      the visitor's browser only, so an admin could not tell a person who declined
--      from a person who never opens the app. analytics_consent(_at) records the
--      signed-in person's latest choice, written ONLY through record_analytics_consent
--      (the profile guard keeps every other column of the row the admin's).
--   3. AN UNFINISHED SIGN-UP WAS SILENT. Boss is told when a profile is completed; a
--      person who confirmed the e-mail code and then left the profile form produced
--      nothing. notify_unfinished_signups() (pg_cron, every 15 min) asks admin-notify to
--      tell him once, about an hour after the code was confirmed; unfinished_notified_at
--      is the "told" stamp, and the nightly safety net (novostavby notify_auth_events.py)
--      re-asks for any that slipped through.

begin;

-- ---------------------------------------------------------------------------
-- 1) Columns on the profile
-- ---------------------------------------------------------------------------
alter table public.user_profiles add column if not exists analytics_consent boolean;
alter table public.user_profiles add column if not exists analytics_consent_at timestamptz;
alter table public.user_profiles add column if not exists unfinished_notified_at timestamptz;

comment on column public.user_profiles.analytics_consent is
  'Latest analytics-cookie choice of this signed-in person (true accepted, false declined, null never chosen while signed in). Written only by record_analytics_consent().';
comment on column public.user_profiles.unfinished_notified_at is
  'When Boss was told that this person confirmed the e-mail but never finished the profile (notify_auth_events.py, kind=unfinished).';

-- The person records their own choice. SECURITY DEFINER so the profile guard
-- (user_profiles_guard_entitlements: every column outside its self-editable list is
-- the admin's) stays untouched; the function writes these two columns and nothing else,
-- for auth.uid() and nobody else.
create or replace function public.record_analytics_consent(p_granted boolean)
returns void
language sql volatile security definer
set search_path = public, pg_temp
as $$
  update public.user_profiles
     set analytics_consent = p_granted,
         analytics_consent_at = now()
   where id = auth.uid()
     and p_granted is not null
     and analytics_consent is distinct from p_granted;
$$;

-- ---------------------------------------------------------------------------
-- 2) Sign-in history
-- ---------------------------------------------------------------------------
create table if not exists public.user_sign_ins (
  id          bigserial primary key,
  user_id     uuid not null,
  session_id  uuid,
  signed_in_at timestamptz not null default now(),
  user_agent  text,
  ip          inet,
  aal         text
);
create index if not exists idx_user_sign_ins_user on public.user_sign_ins (user_id, signed_in_at desc);
create unique index if not exists uq_user_sign_ins_session on public.user_sign_ins (session_id) where session_id is not null;
alter table public.user_sign_ins enable row level security;
revoke all on public.user_sign_ins from anon, authenticated;
revoke all on sequence public.user_sign_ins_id_seq from anon, authenticated;
drop policy if exists sign_ins_read_admin on public.user_sign_ins;
create policy sign_ins_read_admin on public.user_sign_ins for select to authenticated using (public.current_user_is_admin());
grant select on public.user_sign_ins to authenticated;

-- A sign-in must NEVER fail because of this record: every error is swallowed.
create or replace function public.log_user_sign_in()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.user_sign_ins (user_id, session_id, signed_in_at, user_agent, ip, aal)
    values (new.user_id, new.id, coalesce(new.created_at, now()), left(new.user_agent, 300), new.ip, new.aal::text)
    on conflict do nothing;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.log_user_sign_in() from public, anon, authenticated;

drop trigger if exists on_auth_session_created on auth.sessions;
create trigger on_auth_session_created
  after insert on auth.sessions
  for each row execute function public.log_user_sign_in();

-- The sessions that exist today are the only sign-ins still knowable; keep them.
insert into public.user_sign_ins (user_id, session_id, signed_in_at, user_agent, ip, aal)
select s.user_id, s.id, s.created_at, left(s.user_agent, 300), s.ip, s.aal::text
  from auth.sessions s
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3) One person's activity, in one call
-- ---------------------------------------------------------------------------
-- p_days: the window (7 / 30 / 90 / 365). The KPIs also carry the window before it,
-- so the page can say "up" or "down". Times are grouped in Bratislava time.
-- Every column is qualified: RETURNS jsonb has no OUT names, but the CTE names below
-- would still shadow a bare column of the same name.
drop function if exists public.admin_user_activity(uuid, int);
create function public.admin_user_activity(p_user_id uuid, p_days int default 30)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
set timezone = 'Europe/Bratislava'
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 730);
  v_now  timestamptz := now();
  v_from timestamptz;
  v_prev timestamptz;
  v_out  jsonb;
begin
  if not public.current_user_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_from := v_now - make_interval(days => v_days);
  v_prev := v_now - make_interval(days => 2 * v_days);

  with
  ev as (               -- this person's events, current + previous window
    select ua.id, ua.created_at, ua.event_type, ua.event_data, ua.session_id, ua.page_path, ua.user_agent,
           (ua.created_at >= v_from) as cur
      from public.user_activity ua
     where ua.user_id = p_user_id and ua.created_at >= v_prev
  ),
  cur as (select * from ev where ev.cur),
  si as (
    select s.signed_in_at, s.user_agent, s.ip
      from public.user_sign_ins s
     where s.user_id = p_user_id
  ),
  q as (                -- AI questions are logged by the server, consent or not
    select c.created_at, c.content, c.lang, c.error_kind, c.session_id
      from public.ai_chat_log c
     where c.user_id = p_user_id and c.role = 'user'
  ),
  k as (
    select w.w,
      -- a day counts if they did anything: an event, a sign-in or an AI question (the
      -- last two are recorded without the analytics cookie, so a person who declined
      -- still has days)
      (select count(distinct t.d) from (
          select (e.created_at)::date as d from ev e where e.cur = (w.w = 'cur')
          union select (x.signed_in_at)::date from si x where x.signed_in_at >= v_prev and (x.signed_in_at >= v_from) = (w.w = 'cur')
          union select (x.created_at)::date from q x where x.created_at >= v_prev and (x.created_at >= v_from) = (w.w = 'cur')
        ) t)                                                                                                                      as active_days,
      (select count(distinct e.session_id) from ev e where e.cur = (w.w = 'cur') and e.event_type <> 'page_leave')                as visits,
      (select round(coalesce(sum((e.event_data->>'active_ms')::numeric), 0) / 60000.0, 1)
         from ev e where e.cur = (w.w = 'cur') and e.event_type = 'page_leave')                                                   as active_min,
      (select count(*) from ev e where e.cur = (w.w = 'cur') and e.event_type = 'page_view')                                      as page_views,
      (select count(*) from ev e where e.cur = (w.w = 'cur') and e.event_type = 'project_view')                                   as project_views,
      (select count(*) from ev e where e.cur = (w.w = 'cur')
          and e.event_type in ('csv_exported', 'xlsx_exported', 'data_export', 'data_copied'))                                    as exports,
      (select count(*) from q where (q.created_at >= v_from) = (w.w = 'cur') and q.created_at >= v_prev)                          as ai_questions,
      (select count(*) from si where (si.signed_in_at >= v_from) = (w.w = 'cur') and si.signed_in_at >= v_prev)                   as sign_ins
    from (values ('cur'), ('prev')) w(w)
  )
  select jsonb_build_object(
    'generated_at', v_now,
    'days', v_days,
    'from', v_from,

    'person', (
      select jsonb_build_object(
        'id', up.id, 'email', up.email, 'full_name', up.full_name, 'company', up.company, 'position', up.position,
        'phone', up.phone, 'linkedin_url', up.linkedin_url, 'tier', up.tier,
        'created_at', up.created_at, 'approved_at', up.approved_at, 'profile_completed', up.profile_completed,
        'trial_started_at', up.trial_started_at, 'trial_until', up.trial_until,
        'paid_started_at', up.paid_started_at, 'paid_until', up.paid_until, 'paid_pause_started', up.paid_pause_started,
        'has_stripe_customer', up.stripe_customer_id is not null,
        'has_stripe_subscription', up.stripe_subscription_id is not null,
        'billing_company_name', up.billing_company_name,
        'subscription_note', up.subscription_note,
        'analytics_consent', up.analytics_consent, 'analytics_consent_at', up.analytics_consent_at,
        'email_confirmed_at', au.email_confirmed_at, 'last_sign_in_at', au.last_sign_in_at,
        'signup_lang', au.raw_user_meta_data->>'lang',
        'trial_intent_at', au.raw_user_meta_data->>'trial_intent_at',
        'created_by_admin', coalesce(au.raw_app_meta_data, '{}'::jsonb) ? 'created_by_admin',
        'last_active_at', greatest(
            (select max(s.refreshed_at) at time zone 'UTC' from auth.sessions s where s.user_id = up.id),  -- timestamp without tz, UTC
            (select max(s.updated_at)   from auth.sessions s where s.user_id = up.id),
            (select max(e.created_at)   from public.user_activity e where e.user_id = up.id),
            (select max(c.created_at)   from public.ai_chat_log c where c.user_id = up.id),
            au.last_sign_in_at),
        'first_activity_at', least(
            (select min(e.created_at) from public.user_activity e where e.user_id = up.id),
            (select min(s.signed_in_at) from si s)),
        'open_sessions', (select count(*) from auth.sessions s where s.user_id = up.id)
      )
      from public.user_profiles up
      left join auth.users au on au.id = up.id
      where up.id = p_user_id
    ),

    'kpis', (select jsonb_object_agg(k.w, to_jsonb(k) - 'w') from k),

    -- one row per calendar day of the window, zeros included (a gap is information)
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'd', to_char(d.d, 'YYYY-MM-DD'),
               'min', coalesce(a.min, 0), 'events', coalesce(a.events, 0),
               'sign_ins', coalesce(s.n, 0), 'questions', coalesce(qq.n, 0)) order by d.d), '[]'::jsonb)
        from generate_series((v_from)::date, (v_now)::date, interval '1 day') d(d)
        left join (
          select (c.created_at)::date as d,
                 round(coalesce(sum((c.event_data->>'active_ms')::numeric) filter (where c.event_type = 'page_leave'), 0) / 60000.0, 1) as min,
                 count(*) filter (where c.event_type <> 'page_leave') as events
            from cur c group by 1
        ) a on a.d = d.d::date
        left join (select (x.signed_in_at)::date as d, count(*) as n from si x where x.signed_in_at >= v_from group by 1) s on s.d = d.d::date
        left join (select (x.created_at)::date as d, count(*) as n from q x where x.created_at >= v_from group by 1) qq on qq.d = d.d::date
    ),

    -- when in the week: ISO weekday (1 = Monday) x hour, Bratislava time
    'heatmap', (
      select coalesce(jsonb_agg(jsonb_build_object('dow', h.dow, 'hour', h.hour, 'n', h.n)), '[]'::jsonb)
        from (
          select extract(isodow from t.at)::int as dow, extract(hour from t.at)::int as hour, count(*) as n
            from (
              select c.created_at as at from cur c where c.event_type <> 'page_leave'
              union all select x.signed_in_at from si x where x.signed_in_at >= v_from
              union all select x.created_at from q x where x.created_at >= v_from
            ) t
           group by 1, 2
        ) h
    ),

    -- which parts of the platform, and for how long
    'sections', (
      select coalesce(jsonb_agg(jsonb_build_object('page', s.page, 'visits', s.visits, 'active_min', s.active_min, 'last_at', s.last_at)
                                order by s.active_min desc, s.visits desc), '[]'::jsonb)
        from (
          select coalesce(c.event_data->>'page', c.event_data->>'from_page') as page,
                 count(*) filter (where c.event_type = 'page_view') as visits,
                 round(coalesce(sum((c.event_data->>'active_ms')::numeric) filter (where c.event_type = 'page_leave'), 0) / 60000.0, 1) as active_min,
                 max(c.created_at) as last_at
            from cur c
           where c.event_type in ('page_view', 'page_leave')
             and coalesce(c.event_data->>'page', c.event_data->>'from_page') is not null
           group by 1
        ) s
    ),

    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object('project_id', p.project_id, 'name', p.name, 'views', p.views, 'last_at', p.last_at)
                                order by p.views desc, p.last_at desc), '[]'::jsonb)
        from (
          select c.event_data->>'project_id' as project_id,
                 (array_agg(c.event_data->>'project_name' order by c.created_at desc))[1] as name,
                 count(*) as views, max(c.created_at) as last_at
            from cur c
           where c.event_type = 'project_view' and c.event_data->>'project_id' is not null
           group by 1
           order by count(*) desc, max(c.created_at) desc
           limit 15
        ) p
    ),

    'features', (
      select coalesce(jsonb_agg(jsonb_build_object('event', f.event_type, 'n', f.n, 'last_at', f.last_at) order by f.n desc), '[]'::jsonb)
        from (
          select c.event_type, count(*) as n, max(c.created_at) as last_at
            from cur c
           where c.event_type not in ('page_view', 'page_leave')
           group by 1
        ) f
    ),

    'exports', (
      select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb)
        from (
          select c.created_at as at,
                 jsonb_build_object('at', c.created_at, 'event', c.event_type,
                   'what', c.event_data->>'type', 'rows', (c.event_data->>'row_count')::numeric,
                   'country', c.event_data->>'country', 'day', c.event_data->>'day',
                   'page', c.event_data->>'page') as j
            from cur c
           where c.event_type in ('csv_exported', 'xlsx_exported', 'data_export', 'data_copied')
           order by c.created_at desc
           limit 25
        ) x
    ),

    'questions', (
      select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb)
        from (
          select q.created_at as at,
                 jsonb_build_object('at', q.created_at, 'text', left(q.content, 280), 'lang', q.lang, 'failed', q.error_kind is not null) as j
            from q
           where q.created_at >= v_from
           order by q.created_at desc
           limit 12
        ) x
    ),

    'sign_ins', jsonb_build_object(
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object('at', x.signed_in_at, 'user_agent', x.user_agent) order by x.signed_in_at desc), '[]'::jsonb)
          from (select * from si order by si.signed_in_at desc limit 12) x
      ),
      -- distinct networks in the window: one office = 1-2; ten = a shared login
      'networks', (select count(distinct network(set_masklen(x.ip, case when family(x.ip) = 4 then 24 else 48 end)))
                     from si x where x.signed_in_at >= v_from and x.ip is not null),
      'total', (select count(*) from si)
    ),

    -- browsers / devices, from sign-ins and events together
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object('user_agent', d.ua, 'n', d.n, 'last_at', d.last_at) order by d.last_at desc), '[]'::jsonb)
        from (
          select t.ua, count(*) as n, max(t.at) as last_at
            from (
              select x.user_agent as ua, x.signed_in_at as at from si x where x.signed_in_at >= v_from
              union all
              select c.user_agent, c.created_at from cur c where c.event_type = 'page_view'
            ) t
           where t.ua is not null
           group by 1
           order by max(t.at) desc
           limit 6
        ) d
    ),

    -- how they found Residata: the first page of the first visit, including the
    -- anonymous visits before sign-up that share a browser tab with a signed-in one
    'first_touch', (
      select jsonb_build_object('at', f.created_at, 'referrer', f.referrer, 'page_path', f.page_path)
        from public.user_activity f
       where f.session_id in (select distinct e.session_id from public.user_activity e where e.user_id = p_user_id and e.session_id is not null)
       order by f.created_at
       limit 1
    ),

    -- the visits themselves, newest first: what they opened, in order
    'visits', (
      select coalesce(jsonb_agg(v.j order by v.started desc), '[]'::jsonb)
        from (
          select min(c.created_at) as started,
                 jsonb_build_object(
                   'session_id', c.session_id,
                   'start', min(c.created_at), 'end', max(c.created_at),
                   'active_min', round(coalesce(sum((c.event_data->>'active_ms')::numeric) filter (where c.event_type = 'page_leave'), 0) / 60000.0, 1),
                   'pages', (select coalesce(jsonb_agg(pp.page order by pp.first_at), '[]'::jsonb)
                               from (select coalesce(c2.event_data->>'page', c2.event_data->>'from_page') as page, min(c2.created_at) as first_at
                                       from cur c2
                                      where c2.session_id = c.session_id and c2.event_type in ('page_view', 'page_leave')
                                        and coalesce(c2.event_data->>'page', c2.event_data->>'from_page') is not null
                                      group by 1) pp),
                   'projects', (select coalesce(jsonb_agg(distinct c3.event_data->>'project_name'), '[]'::jsonb)
                                  from cur c3 where c3.session_id = c.session_id and c3.event_type = 'project_view'
                                   and c3.event_data->>'project_name' is not null),
                   'exports', count(*) filter (where c.event_type in ('csv_exported', 'xlsx_exported', 'data_export', 'data_copied')),
                   'actions', count(*) filter (where c.event_type not in ('page_view', 'page_leave')),
                   'questions', (select count(*) from q where q.created_at between min(c.created_at) - interval '1 minute' and max(c.created_at) + interval '1 minute'),
                   'user_agent', max(c.user_agent)
                 ) as j
            from cur c
           where c.session_id is not null
           group by c.session_id
           order by min(c.created_at) desc
           limit 25
        ) v
    ),

    'saved', jsonb_build_object(
      'dashboard', (select jsonb_build_object('updated_at', d.updated_at,
                                              'widgets', case when jsonb_typeof(d.config->'widgets') = 'array' then jsonb_array_length(d.config->'widgets') end)
                      from public.user_dashboards d where d.user_id = p_user_id),
      'map_areas', (select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'country', a.country, 'created_at', a.created_at) order by a.created_at desc), '[]'::jsonb)
                      from public.user_map_areas a where a.user_id = p_user_id),
      'report_subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('scope', r.scope_label, 'enabled', r.enabled, 'last_sent_at', r.last_sent_at, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
                      from public.report_subscriptions r where r.user_id = p_user_id)
    ),

    'feedback', (
      select coalesce(jsonb_agg(jsonb_build_object('at', f.created_at, 'category', f.category, 'text', left(f.message, 240),
                                                   'status', f.status, 'page_path', f.page_path) order by f.created_at desc), '[]'::jsonb)
        from (select * from public.feedback fb where fb.user_id = p_user_id order by fb.created_at desc limit 10) f
    ),

    'errors', jsonb_build_object(
      'count', (select count(*) from public.client_errors e where e.user_id = p_user_id and e.occurred_at >= v_from),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('at', e.occurred_at, 'kind', e.kind, 'text', left(e.message, 200), 'path', e.path) order by e.occurred_at desc), '[]'::jsonb)
                   from (select * from public.client_errors ce where ce.user_id = p_user_id and ce.occurred_at >= v_from order by ce.occurred_at desc limit 5) e)
    ),

    -- what an admin changed on this account
    'admin_changes', (
      select coalesce(jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'by', a.actor_email,
                                                   'success', a.success, 'payload', a.payload) order by a.created_at desc), '[]'::jsonb)
        from (select * from public.admin_audit_log al where al.target_id = p_user_id order by al.created_at desc limit 15) a
    )
  ) into v_out;

  return v_out;
end;
$$;

-- The Users table's "Activity" column: for every account, when they were last here and
-- on how many of the last 30 days. Same day rule as admin_user_activity (an event, a
-- sign-in or an AI question), so the column and the person's page never disagree.
drop function if exists public.admin_users_activity_glance();
create function public.admin_users_activity_glance()
returns table (user_id uuid, last_active_at timestamptz, active_days_30 int)
language plpgsql stable security definer
set search_path = public, pg_temp
set timezone = 'Europe/Bratislava'
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  with days as (
    select ua.user_id as uid, (ua.created_at)::date as d from public.user_activity ua
     where ua.user_id is not null and ua.created_at >= now() - interval '30 days'
    union
    select s.user_id, (s.signed_in_at)::date from public.user_sign_ins s where s.signed_in_at >= now() - interval '30 days'
    union
    select c.user_id, (c.created_at)::date from public.ai_chat_log c
     where c.user_id is not null and c.role = 'user' and c.created_at >= now() - interval '30 days'
  ),
  last_seen as (
    select x.uid, max(x.at) as at from (
      select ua.user_id as uid, max(ua.created_at) as at from public.user_activity ua where ua.user_id is not null group by 1
      union all select s.user_id, max(s.signed_in_at) from public.user_sign_ins s group by 1
      union all select c.user_id, max(c.created_at) from public.ai_chat_log c where c.user_id is not null group by 1
      union all select se.user_id, max(greatest(se.refreshed_at at time zone 'UTC', se.updated_at)) from auth.sessions se group by 1
      union all select au.id, au.last_sign_in_at from auth.users au
    ) x
    group by x.uid
  )
  select up.id,
         ls.at,
         coalesce((select count(distinct d.d) from days d where d.uid = up.id), 0)::int
    from public.user_profiles up
    left join last_seen ls on ls.uid = up.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Tell Boss about a sign-up that stopped half-way
-- ---------------------------------------------------------------------------
-- Every 15 minutes: accounts whose e-mail code was confirmed more than an hour ago
-- (and less than three days ago — an old one is history, not news), whose profile
-- form is still empty, and who were not created by an admin. admin-notify
-- (kind "unfinished") re-checks all of it, sends once and stamps
-- unfinished_notified_at; until the stamp lands the next run asks again.
create or replace function public.notify_unfinished_signups()
returns int
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_web_url text;
  r record;
  n int := 0;
begin
  select value into v_secret  from public._webhook_config where key = 'webhook_secret';
  select value into v_web_url from public._webhook_config where key = 'web_url';
  if v_secret is null or v_web_url is null then
    raise warning 'notify_unfinished_signups: webhook config missing';
    return 0;
  end if;
  for r in
    select up.id
      from public.user_profiles up
      join auth.users au on au.id = up.id
     where coalesce(up.profile_completed, false) = false
       and up.unfinished_notified_at is null
       and au.email_confirmed_at is not null
       and au.email_confirmed_at <  now() - interval '1 hour'
       and au.email_confirmed_at >= now() - interval '3 days'
       and not (coalesce(au.raw_app_meta_data, '{}'::jsonb) ? 'created_by_admin')
     order by au.email_confirmed_at
     limit 20
  loop
    perform net.http_post(
      url     := v_web_url || '/api/webhooks/admin-notify',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', v_secret),
      body    := jsonb_build_object('user_id', r.id, 'kind', 'unfinished'),
      timeout_milliseconds := 8000
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.notify_unfinished_signups() from public, anon, authenticated;
select cron.schedule('notify-unfinished-signups', '*/15 * * * *', 'select public.notify_unfinished_signups()');

-- Sign-in records older than 13 months are no longer needed for security.
create or replace function public.trim_user_sign_ins()
returns bigint
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare n bigint;
begin
  delete from public.user_sign_ins where signed_in_at < now() - interval '13 months';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- CREATE OR REPLACE resets EXECUTE to PUBLIC: lock every function again, every time.
revoke execute on function public.record_analytics_consent(boolean) from public, anon;
grant  execute on function public.record_analytics_consent(boolean) to authenticated;
revoke execute on function public.admin_user_activity(uuid, int) from public, anon;
grant  execute on function public.admin_user_activity(uuid, int) to authenticated;
revoke execute on function public.admin_users_activity_glance() from public, anon;
grant  execute on function public.admin_users_activity_glance() to authenticated;
revoke execute on function public.trim_user_sign_ins() from public, anon, authenticated;

select cron.schedule('prune-user-sign-ins', '45 3 * * *', 'select public.trim_user_sign_ins()');

commit;
