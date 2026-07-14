/**
 * pricing — the DB-driven subscription price, read from public.pricing_config.
 *
 * MODEL (mirrors copyOverrides.js): the in-code marketingCopy values are the
 * permanent DEFAULT/fallback and always render. public.pricing_config holds the
 * Boss's live value, edited from the admin "Pricing" tool. When the DB row is
 * available it WINS; otherwise the code default renders — so the pricing page can
 * never go blank, even if the table is empty or the network is down.
 *
 * The same row also drives the ACTUAL Stripe charge server-side
 * (api/stripe.js resolvePriceCents), so display and charge can never diverge.
 *
 * Resilience: hydrate synchronously from a localStorage cache at import (instant
 * correct first paint for returning visitors), refresh from the DB in the
 * background, cache it, and notify subscribers to re-render once.
 */
import { useEffect, useState } from "react";
import { supabasePublic, isSupabaseReady } from "./supabase";

const CACHE_KEY = "residata_pricing_v1";

let CONFIG = readCache();          // { monthly_price_cents, anchor_price_cents, discount_note_en, discount_note_sk } | null
let netLoaded = false;             // a SUCCESSFUL network refresh happened this session
let inFlight = false;              // dedupe concurrent refreshes
const subscribers = new Set();

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === "object" ? p : null;
  } catch { return null; }
}
function writeCache(obj) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

/** "€79.99" from 7999; drops the decimals for round euros (8000 → "€80"). */
export function formatEurCents(cents) {
  if (cents == null || cents === "") return null;   // Number(null) is 0 (finite) — guard it
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  const eur = n / 100;
  return "€" + (Number.isInteger(eur) ? String(eur) : eur.toFixed(2));
}

async function refresh() {
  if (inFlight || !isSupabaseReady()) return;
  inFlight = true;
  try {
    const { data, error } = await supabasePublic
      .from("pricing_config")
      .select("monthly_price_cents, anchor_price_cents, discount_note_en, discount_note_sk")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return;   // netLoaded stays false → a later mount retries
    CONFIG = data;
    netLoaded = true;
    writeCache(data);
    subscribers.forEach((fn) => fn());
  } catch { /* keep cache / defaults; retry on next mount */ } finally {
    inFlight = false;
  }
}

/**
 * Returns the live pricing overlay for the current language, or nulls when the
 * DB value isn't available yet (caller falls back to in-code marketingCopy).
 *   { priceDisplay, anchorDisplay, note, ready }
 */
export function usePricing(lang = "en") {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((v) => v + 1);
    subscribers.add(fn);
    if (!netLoaded) refresh();   // refresh once per session; retries until first success
    return () => subscribers.delete(fn);
  }, []);

  if (!CONFIG) return { priceDisplay: null, anchorDisplay: null, note: null, ready: false };
  return {
    priceDisplay: formatEurCents(CONFIG.monthly_price_cents),
    anchorDisplay: CONFIG.anchor_price_cents != null ? formatEurCents(CONFIG.anchor_price_cents) : null,
    note: (lang === "sk" ? CONFIG.discount_note_sk : CONFIG.discount_note_en) || null,
    ready: true,
  };
}

/** For the admin tool: the raw current config (may be null before first load). */
export function usePricingConfig() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((v) => v + 1);
    subscribers.add(fn);
    if (!netLoaded) refresh();
    return () => subscribers.delete(fn);
  }, []);
  return CONFIG;
}

/** Force a re-read (call after the admin saves a new price). */
export function refreshPricing() { return refresh(); }
