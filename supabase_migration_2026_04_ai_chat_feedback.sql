-- ai_chat_log feedback columns — captures user thumbs-up / thumbs-down
-- on each assistant turn so we can grade prompt quality from real
-- usage instead of guessing from internal QA alone.
--
-- WHY new columns vs. a separate ai_chat_feedback table:
--   Feedback is a 1:1 attribute of an assistant turn (one rating per
--   row, never multiple). Splitting it into its own table would cost
--   a join on every "show me chats with thumbs-down" query — and the
--   only access pattern is "sort latest assistant rows by feedback".
--   Inline columns keep the read path one-table.
--
-- Columns:
--   · feedback        text, 'good' | 'bad' | null (default null)
--   · feedback_note   text, optional free-form qualifier the user can
--                     type after picking thumbs-down ("hallucinated",
--                     "wrong number", "off-topic"). Optional and short
--                     (~280 chars enforced client-side).
--   · feedback_at     timestamptz, when the rating was applied. null
--                     while no rating exists yet.
--
-- Only role='assistant' rows ever get feedback set — the API endpoint
-- enforces this. We don't add a CHECK constraint because the role
-- column is on the same row and a trigger or check there would force
-- every insert to look up role anyway.

alter table public.ai_chat_log
  add column if not exists feedback text
    check (feedback is null or feedback in ('good', 'bad')),
  add column if not exists feedback_note text,
  add column if not exists feedback_at timestamptz;

-- Index for "show me recent thumbs-down" admin queries — only indexes
-- rows where feedback is NOT null, so the index stays tiny (most rows
-- never get rated). Partial index = no cost on hot insert path.
create index if not exists ai_chat_log_feedback_recent
  on public.ai_chat_log (feedback_at desc)
  where feedback is not null;
