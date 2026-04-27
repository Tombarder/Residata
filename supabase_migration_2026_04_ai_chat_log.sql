-- ai_chat_log — full transcript + timing log for the in-app chatbot.
--
-- WHY a new table (vs. extending ai_usage_log):
--   ai_usage_log = rate-limit + billing counter (one row per API call,
--                  doesn't carry message content).
--   ai_chat_log  = research / QA / replay log: every turn (user AND
--                  assistant), full text, exact timing data so we can
--                  measure how long users wait for replies and how
--                  much they type before they ask. Different access
--                  pattern, different retention, different RLS — keep
--                  them separate.
--
-- Lifecycle:
--   · Every /api/ai/chat call writes TWO rows:
--       1. role='user'      — the question (typing_ms from client)
--       2. role='assistant' — the reply (response_time_ms + tokens)
--     A 429 / 403 / 501 error becomes one row with role='error' and
--     no assistant row.
--   · Session ends when the user clicks "Clear" or starts a brand-new
--     conversation — client sends one extra row with role='system'
--     and content='session_ended' so we can compute total session
--     duration without inferring it from gaps.
--
-- Indexes:
--   · (session_id, turn_index)  — replay a conversation in order
--   · (user_id, sent_at desc)   — "show this user's recent chats"
--   · (sent_at desc)            — "what happened in the last hour"
--
-- RLS:
--   · SELECT: own rows OR admin (read-your-own-history works in app)
--   · INSERT: blocked from the client. Server-side endpoint uses the
--     service role key which bypasses RLS — so only our own backend
--     can write. Stops the public anon key from injecting fake logs.
--   · UPDATE / DELETE: nobody (immutable audit log; admin can purge
--     with service role if/when needed).

create table if not exists public.ai_chat_log (
  id uuid primary key default gen_random_uuid(),

  -- Session grouping (UUID generated client-side, persists across
  -- the same conversation). Cleared when user explicitly clears chat.
  session_id uuid not null,

  -- Identity (user_id null for anonymous calls; caller_ip captured
  -- in both cases so we can attribute anon usage in aggregate).
  user_id uuid references auth.users(id) on delete set null,
  caller_ip text,
  tier text,

  -- Position within session — 0-based monotonic. user/assistant pair
  -- for one Q→A round shares NO turn_index — each row gets its own
  -- so transcript order = order by turn_index asc.
  turn_index int not null,

  -- Content
  role text not null check (role in ('user','assistant','system','error')),
  content text,
  content_length int generated always as (coalesce(char_length(content), 0)) stored,

  -- Timing
  sent_at timestamptz not null default now(),
  -- For role='assistant': how long the API call to Anthropic took
  -- (server-measured, ms). For role='user': null.
  response_time_ms int,
  -- For role='user': time the user spent typing this message
  -- (client-measured: textarea focus → send click). For role='assistant': null.
  user_typing_ms int,

  -- Model info (assistant rows only)
  model text,
  input_tokens int,
  output_tokens int,

  -- Context / config
  lang text,
  page_url text,                -- which page the chat was opened on
  user_agent text,              -- browser UA (privacy: no full fingerprint)

  -- Error rows
  error_kind text,              -- 'limit'|'auth'|'config'|'err'|'timeout'
  error_message text,
  http_status int,

  created_at timestamptz not null default now()
);

create index if not exists ai_chat_log_session    on public.ai_chat_log (session_id, turn_index);
create index if not exists ai_chat_log_user_sent  on public.ai_chat_log (user_id, sent_at desc);
create index if not exists ai_chat_log_sent       on public.ai_chat_log (sent_at desc);

alter table public.ai_chat_log enable row level security;

-- Read-your-own + admin-read-all. Anonymous (no auth.uid()) gets
-- nothing — they don't need to query their own history (UI uses
-- localStorage), only logged-in users do.
create policy ai_chat_log_select_self_or_admin
  on public.ai_chat_log for select
  using (
    user_id = auth.uid()
    or public.current_user_is_admin()
  );

-- Inserts denied from any client-side context. Server uses
-- service_role which bypasses RLS, so only our backend writes.
create policy ai_chat_log_no_client_insert
  on public.ai_chat_log for insert
  with check (false);
