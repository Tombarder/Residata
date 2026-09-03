-- One invoice, one email — even when Stripe retries the webhook.
--
-- Stripe redelivers a webhook whenever the endpoint does not return 2xx, and it
-- does so for real reasons: a cold start that exceeds the timeout, a transient
-- database error, a deploy landing mid-request. Our handler does several things
-- and any of them can fail AFTER the invoice email has gone out — at which point
-- Stripe retries the whole event and the customer receives a second copy of
-- their invoice. Two invoices for one payment is exactly the kind of thing a
-- finance department escalates.
--
-- So the send is recorded first and the record is what makes it idempotent: the
-- primary key is Stripe's own invoice id, and the insert is what decides whether
-- this delivery is the one that sends. A retry hits the key and skips.
--
-- It doubles as the answer to "did they get their invoice?", which is otherwise
-- only knowable from mail logs nobody keeps.

create table if not exists public.invoice_emails_sent (
  invoice_id   text primary key,          -- Stripe invoice id (in_...)
  customer_id  text,                      -- Stripe customer id, for support lookups
  sent_to      text not null,
  lang         text not null default 'sk',
  amount_cents integer,
  currency     text,
  sent_at      timestamptz not null default now()
);

comment on table public.invoice_emails_sent is
  'One row per invoice email actually sent. The primary key is Stripe''s invoice id, so a redelivered webhook cannot send the customer a second copy. Written by the service role only.';

-- Nobody but the service role touches this. RLS on with no policies at all is
-- how app_secrets is protected too: it is not a table any client key should see,
-- and an absent policy is a stronger statement than a restrictive one.
alter table public.invoice_emails_sent enable row level security;

-- The webhook looks up by invoice id (the primary key) and support looks up by
-- customer; the second one needs its own index.
create index if not exists invoice_emails_sent_customer_idx
  on public.invoice_emails_sent (customer_id, sent_at desc);
