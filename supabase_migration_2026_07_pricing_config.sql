-- Pricing config — single source of truth for the subscription price.
--
-- WHY: the monthly price used to be a hardcoded constant (MONTHLY_PRICE_CENTS in
-- api/stripe.js) + repeated display strings in marketingCopy.js/seo.js. Changing
-- it meant a code edit + deploy. This table makes the price DB-driven so the Boss
-- can change it from the admin "Pricing" tool (Texts page) with NO code/deploy:
--   · api/stripe.js?action=checkout  reads monthly_price_cents for the live charge
--     (with the in-code constant as a resilient fallback if the read ever fails).
--   · the frontend pricing card reads this row (via the anon client) and falls
--     back to the in-code marketingCopy defaults if unavailable.
--
-- SECURITY: a money value must never be writable from the browser. RLS grants
-- PUBLIC READ only; there is deliberately NO write policy, so every direct
-- insert/update/delete is denied. The ONLY writer is the service_role, used by
-- api/stripe.js?action=set-price, which verifies the caller is an admin and
-- clamps the value to sane bounds before writing.

CREATE TABLE IF NOT EXISTS public.pricing_config (
  id                  int  PRIMARY KEY DEFAULT 1,
  monthly_price_cents int  NOT NULL,
  anchor_price_cents  int,                 -- struck-through "regular" price (display only)
  discount_note_en    text,
  discount_note_sk    text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  CONSTRAINT pricing_config_singleton     CHECK (id = 1),
  CONSTRAINT pricing_config_price_bounds  CHECK (monthly_price_cents BETWEEN 100 AND 1000000),
  CONSTRAINT pricing_config_anchor_bounds CHECK (anchor_price_cents IS NULL OR anchor_price_cents BETWEEN 100 AND 2000000)
);

-- Seed the current live values (idempotent).
INSERT INTO public.pricing_config (id, monthly_price_cents, anchor_price_cents, discount_note_en, discount_note_sk)
VALUES (
  1, 7999, 34999,
  'Summer offer — early-access rate for the first 50 members (until 31 Aug 2026). Billed monthly, cancel anytime.',
  'Letná ponuka — cena pre prvých 50 členov (do 31. augusta 2026). Fakturované mesačne, zrušenie kedykoľvek.'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;

-- Public read (the price is public marketing info).
DROP POLICY IF EXISTS pricing_config_public_read ON public.pricing_config;
CREATE POLICY pricing_config_public_read ON public.pricing_config
  FOR SELECT TO anon, authenticated USING (true);

-- No write policy on purpose → RLS denies all browser writes. Only service_role
-- (api/stripe.js?action=set-price, admin-checked) can write.

GRANT SELECT ON public.pricing_config TO anon, authenticated;
