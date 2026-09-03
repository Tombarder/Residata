-- Billing identity of the CUSTOMER, so an invoice can name them.
--
-- Why this exists: Stripe already issues an invoice for every subscription
-- cycle, but until now checkout collected nothing a Slovak or Czech invoice
-- needs — no company name, no company ID, no VAT number, and the billing
-- address was optional. So the invoice could not identify the buyer, and a
-- business customer's accountant could not book it. The data was never asked
-- for; that is the whole bug.
--
-- These columns hold what Checkout now collects, written by the Stripe webhook.
-- They are deliberately SEPARATE from user_profiles.company:
--   company          — what the person typed about themselves when signing up,
--                      a marketing/profile field, free text, often a brand name
--   billing_company_name — the legal entity that is buying, as entered at
--                      checkout, and what will be printed on the invoice
-- Conflating the two would put a brand name on a tax document.
--
-- All additive and nullable: existing rows and existing subscriptions are
-- untouched, and nothing reads these until the webhook fills them.

alter table public.user_profiles
  add column if not exists billing_company_name text,
  add column if not exists billing_company_id   text,   -- IČO / IČ / company number
  add column if not exists billing_vat_id       text,   -- IČ DPH / VAT ID, from Stripe tax_id_collection
  add column if not exists billing_address      jsonb,  -- as Stripe returns it (line1/line2/city/postal_code/state/country)
  add column if not exists billing_country      text,   -- ISO-2, lifted out of the address for cheap filtering
  add column if not exists billing_updated_at   timestamptz;

comment on column public.user_profiles.billing_company_name is
  'Legal name of the buying entity, collected at Stripe Checkout. Printed on the invoice. NOT the same as user_profiles.company (a self-declared profile field).';
comment on column public.user_profiles.billing_company_id is
  'Company registration number (IČO in SK/CZ) collected as a Checkout custom field. Required for a Slovak/Czech business invoice.';
comment on column public.user_profiles.billing_vat_id is
  'VAT identification number from Stripe tax_id_collection. Presence of an EU VAT ID outside SK is what makes a supply reverse-charged.';
comment on column public.user_profiles.billing_country is
  'ISO-2 country of the billing address. Drives the reverse-charge decision and the EU sales list.';

-- The existing RLS policies on user_profiles cover these columns (they are
-- policies on the table, not per-column), so a user continues to see only
-- their own row and the anon key sees none. No policy change is needed, and
-- adding one here would silently widen access.
