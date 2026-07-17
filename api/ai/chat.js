// Vercel serverless endpoint: /api/ai/chat
//
// Residata AI assistant — grounded chatbot for the Slovak + Czech (SK + CZ)
// new-build apartment market.
//
// === ARCHITECTURE (rebuilt 2026-06-22) — TOOLS, not a data dump ===
//
// The model is given THREE tools and queries the live database itself, instead
// of us stuffing a truncated copy of the data into the prompt. This is the
// permanent fix for "the AI is missing data": every question is answered from
// the FULL fact table (~all units, every project, both markets) — current OR
// historical — with no row cap and no alphabetical truncation. The old approach
// fed ~5,000 of ~13,000 current units into the prompt, so late-alphabet projects
// (Sky Park Tower, Zwirn…) were invisible and it wrongly answered "no data".
//
//   Tools (each runs server-side against analytics.unit_facts via the SECURITY
//   DEFINER query engines public.analytics_pivot / public.analytics_units, plus
//   public.projects for velocity):
//     • market_overview   — per-country totals + best-sellers + top developers
//     • market_stats      — counts / averages / €m² grouped by any dimension,
//                           any filters, CURRENT or HISTORICAL (month-by-month)
//     • search_apartments — specific units by city/district/rooms/floor/price/…,
//                           CURRENT or HISTORICAL
//
//   The tool layer hides the data quirks from the model (district's field is
//   `cast`; rooms are stored as `3.0`, so room filters use the numeric path) and
//   translates the engines' compact measure codes into clean labelled JSON.
//
// === MODEL (Boss 2026-06-22) ===
//   claude-sonnet-4-6 for EVERY tier — Sonnet is the base model, anon/free included.
//   See MODEL_BY_TIER. Prompt caching is on (cache_control on the stable system
//   prefix), and the system prompt is small now (data comes from tools, not the
//   prompt) so per-question cost is already low.
//
// === ACCESS by tier (mirrors src/lib/capabilities.js) ===
//   HISTORICAL data (mode:'historical') is a PAID feature (paid/admin/trial).
//   anon/free get CURRENT data only; a historical request returns a gate notice.
//   An active trial (user_profiles.trial_until > now) counts as paid here — same
//   promotion the capability layer does (trial keeps tier='free').
//
// === DAILY CAPS (questions/day; see DAILY_LIMITS) ===
//   anon 1 · free 3 · paid 15 · admin 100. Active trial uses the paid cap.
//   Enforced: logged-in = today's rows in ai_usage_log by user_id (persists
//   across cold starts); anon = in-memory per-IP counter (+ a 10/min per-IP
//   burst limit on every caller). At the cap → 429 with an upgrade CTA, resets
//   at 00:00 UTC. Hard stop (never billed past it). A monthly spend cap in the
//   Anthropic dashboard is the backstop ALARM, not the enforcement.
//
// === Request / response ===
//   Request : { messages:[{role,content}], lang:'sk'|'en', sessionId?, typingMs?, pageUrl? }
//   Response: { text, tier, model, log_id, remaining:{today}, usage:{input_tokens,output_tokens,
//               cache_read_input_tokens,cache_creation_input_tokens}, response_time_ms }
//   Non-200 : 401 auth · 403 origin/pending · 429 rate · 413 too large · 501 no key · 500

import { createClient } from "@supabase/supabase-js";
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";

export const maxDuration = 60; // tool loop = a few model round-trips

// Sonnet 4.6 as the base model for EVERY tier (Boss 2026-06-22 — Sonnet everywhere).
const MODEL_BY_TIER = {
  anon:  "claude-sonnet-4-6",
  free:  "claude-sonnet-4-6",
  paid:  "claude-sonnet-4-6",
  admin: "claude-sonnet-4-6",
};
const FALLBACK_MODEL = "claude-sonnet-4-6";

const MAX_TOKENS      = 1500;  // room for a listy answer or a tool call
const MAX_TOOL_ITERS  = 6;     // model<->tool round-trips before we force a stop
const MAX_INPUT_BYTES = 24 * 1024;
const MAX_HISTORY     = 10;
const MAX_MSG_LEN     = 2000;

// Per-day caps by tier. pending is refused earlier. Active trial uses the paid cap.
const DAILY_LIMITS = { anon: 1, free: 3, paid: 15, admin: 100 };


const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "0.0.0.0";
}

/* Effective tier — MUST mirror src/lib/useCapabilities.js (the single source of truth):
   the `tier` column is NEVER mutated (audit/billing label); the date columns drive access.
   Precedence: admin > pending > paused(→free) > paid_until-in-future > trial > expired-paid
   (→free) > legacy-paid > base. Previously this read only tier+trial_until, so a canceled/
   expired subscriber (tier stays 'paid' by design, paid_until moved to the past) — or an
   admin-paused one — kept paid AI entitlements (15/day + historical data) server-side while
   the frontend correctly locked them out. */
function effectiveTier(prof) {
  const base = prof?.tier || "anon";
  const now = Date.now();
  const trialUntil = prof?.trial_until ? new Date(prof.trial_until).getTime() : null;
  const paidUntil = prof?.paid_until ? new Date(prof.paid_until).getTime() : null;
  const pausedAt = prof?.paid_pause_started ? new Date(prof.paid_pause_started).getTime() : null;
  const trialActive = Boolean(trialUntil && trialUntil > now);
  const paidPaused = Boolean(pausedAt);
  const paidWindowActive = Boolean(paidUntil && paidUntil > now);

  if (base === "admin") return "admin";
  if (base === "pending") return "pending";
  if (paidPaused) return base === "paid" ? "free" : base;   // paused paid → no access
  if (paidWindowActive) return "paid";                       // paid window in future
  if (trialActive) return "paid";                            // active trial (free/pending base)
  if (base === "paid" && paidUntil && paidUntil <= now) return "free"; // expired paid → free
  if (base === "paid") return "paid";                        // legacy paid (no paid_until)
  return base;
}
const isPaidTier = (t) => t === "paid" || t === "admin";

/* Read one secret from app_secrets via service-role. */
async function readSecret(admin, key) {
  if (!admin) return null;
  try {
    const { data, error } = await admin.from("app_secrets").select("value").eq("key", key).maybeSingle();
    if (error) return null;
    return data?.value || null;
  } catch (_) { return null; }
}

// In-memory per-IP burst limit (10/min) — absorbs bursty abuse before DB/credit.
const ipBucket = new Map();
const IP_WINDOW_MS = 60 * 1000;
const IP_MAX = 10;
function ipRateCheck(ip) {
  const now = Date.now();
  const b = ipBucket.get(ip);
  if (!b || now - b.start > IP_WINDOW_MS) { ipBucket.set(ip, { start: now, count: 1 }); return { ok: true }; }
  b.count += 1;
  if (b.count > IP_MAX) return { ok: false, retryAfterSec: Math.ceil((b.start + IP_WINDOW_MS - now) / 1000) };
  return { ok: true };
}

// (The anon daily cap is now durable — counted from ai_usage_log by caller_ip — so
// the old in-memory per-instance counter that this replaced has been removed.)

// ────────────────────────────────────────────────────────────────
// TOOLS — the model's window onto the full database.
// ────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "market_overview",
    description:
      "Big-picture market numbers for the CURRENT month. Returns, for each country (Slovakia/SK and Czechia/CZ): units tracked, available, sold, reserved, average €/m², units sold in the last 30 days, active projects; PLUS the top sellers (most units sold in the last 30 days) and the largest developers by inventory, each tagged with its country and city. Use this for market-wide questions, 'best-selling / fastest-selling project', and SK-vs-CZ comparisons.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "market_stats",
    description:
      "Counts, sums and averages over apartments, grouped by a dimension and filtered however you like. Use for 'average €/m² in Prague', 'how many available 2-rooms in Ružinov', '€/m² by district', or month-by-month HISTORY. Returns one row per group with: units (n), available, sold, reserved, avg_price_eur, avg_eur_per_m2, min_price, max_price. You do any ranking/sorting of the returned groups yourself.",
    input_schema: {
      type: "object",
      properties: {
        group_by: { type: "string", enum: ["none","country","city","district","developer","project","rooms","type","status","month","kolaudacia","orientation"], description: "Dimension to group by. 'none' = one overall total for the filtered set. 'month' = history over time." },
        country:  { type: "string", enum: ["SK","CZ"] },
        city:     { type: "string", description: "e.g. Bratislava, Praha, Brno" },
        district: { type: "string", description: "e.g. Ružinov, Žižkov" },
        developer:{ type: "string" },
        project:  { type: "string", description: "Project name." },
        rooms:    { type: "integer", description: "Exact room count, e.g. 3." },
        status:   { type: "string", enum: ["available","sold","reserved","any"], description: "Default any." },
        price_min:{ type: "number" }, price_max: { type: "number" },
        mode:     { type: "string", enum: ["current","historical"], description: "current = latest month (default). historical = all months over time (PAID)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_apartments",
    description:
      "Find SPECIFIC apartments matching exact criteria. Use for 'cheapest available 3-room in Bratislava', 'flats on the 16th floor or higher under €1M', etc. Returns up to `limit` matching units, each with: project, unit, city, district, rooms, floor, area_m2, price_eur, eur_per_m2, status. Searches the WHOLE database — every project, no cap.",
    input_schema: {
      type: "object",
      properties: {
        city:      { type: "string" }, district: { type: "string" },
        developer: { type: "string" }, project:  { type: "string" },
        rooms:     { type: "integer", description: "Exact room count." },
        status:    { type: "string", enum: ["available","sold","reserved","any"], description: "Default available." },
        price_min: { type: "number" }, price_max: { type: "number" },
        floor_min: { type: "integer" }, floor_max: { type: "integer" },
        area_min:  { type: "number" }, area_max: { type: "number" },
        sort:      { type: "string", enum: ["price","eur_per_m2","floor","area","rooms"], description: "Sort field (default price)." },
        order:     { type: "string", enum: ["asc","desc"], description: "Default asc." },
        mode:      { type: "string", enum: ["current","historical"], description: "current = on the market now (default). historical = past months (PAID)." },
        limit:     { type: "integer", description: "Max rows (default 25, max 100)." },
      },
      additionalProperties: false,
    },
  },
];

// friendly group/dim name -> analytics dim_registry key (district's key is `cast`)
const GROUP_KEY = {
  none: null, country: "country", city: "city", district: "cast", developer: "developer",
  project: "project_name", rooms: "izby", type: "typ", status: "stav", month: "snapshot_month",
  kolaudacia: "kolaudacia", orientation: "orientacia",
};
const STATUS_CODE = { available: "V", sold: "P", reserved: "R" };

function pageMode(mode, allowHistorical) {
  // returns ['latest'|'archive', gatedBool]
  if (mode === "historical") return allowHistorical ? ["archive", false] : ["latest", true];
  return ["latest", false];
}

function buildFilters(a) {
  // categorical dim filters for both engines
  const f = {};
  if (a.country)   f.country = [a.country];
  if (a.city)      f.city = [a.city];
  if (a.district)  f.cast = [a.district];
  if (a.developer) f.developer = [a.developer];
  if (a.project)   f.project_name = [a.project];
  if (a.status && a.status !== "any" && STATUS_CODE[a.status]) f.stav = [STATUS_CODE[a.status]];
  return f;
}
function buildRanges(a, { withFloor = false, withArea = false } = {}) {
  const r = {};
  if (a.price_min != null || a.price_max != null) {
    r.cena_s_dph = {}; if (a.price_min != null) r.cena_s_dph.min = String(a.price_min); if (a.price_max != null) r.cena_s_dph.max = String(a.price_max);
  }
  if (a.rooms != null) r.izby = { min: String(a.rooms), max: String(a.rooms) }; // numeric path dodges '3.0'
  if (withFloor && (a.floor_min != null || a.floor_max != null)) {
    r.poschodie = {}; if (a.floor_min != null) r.poschodie.min = String(a.floor_min); if (a.floor_max != null) r.poschodie.max = String(a.floor_max);
  }
  if (withArea && (a.area_min != null || a.area_max != null)) {
    r.obytna_plocha = {}; if (a.area_min != null) r.obytna_plocha.min = String(a.area_min); if (a.area_max != null) r.obytna_plocha.max = String(a.area_max);
  }
  return r;
}
const num = (v) => (v == null ? null : Number(v));
const round = (v) => (v == null ? null : Math.round(Number(v)));

async function toolMarketOverview(admin) {
  const { data, error } = await admin
    .from("projects")
    .select("name, country, city, district, developer, status, total_units, available_units, sold_units, reserved_units, sold_last_month, avg_price_eur_m2")
    .limit(400);
  if (error) throw new Error(error.message);
  const all = (data || []).filter((p) => (p.status || "active") === "active");
  const byCountry = {};
  for (const p of all) {
    const c = p.country || "?";
    const d = (byCountry[c] ||= { country: c, projects: 0, units: 0, available: 0, sold: 0, reserved: 0, sold_30d: 0, pw: 0, lw: 0 });
    d.projects++; d.units += p.total_units || 0; d.available += p.available_units || 0;
    d.sold += p.sold_units || 0; d.reserved += p.reserved_units || 0; d.sold_30d += p.sold_last_month || 0;
    if (p.avg_price_eur_m2) { const w = p.total_units || 1; d.pw += p.avg_price_eur_m2 * w; d.lw += w; }
  }
  const markets = Object.values(byCountry).map((d) => ({
    country: d.country, projects_active: d.projects, units_tracked: d.units,
    available: d.available, sold: d.sold, reserved: d.reserved,
    sold_last_30d: d.sold_30d, avg_eur_per_m2: d.lw ? Math.round(d.pw / d.lw) : null,
  }));
  const top_sellers_30d = [...all].filter((p) => (p.sold_last_month || 0) > 0)
    .sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0)).slice(0, 10)
    .map((p) => ({ project: p.name, country: p.country, city: p.city, district: p.district, sold_last_30d: p.sold_last_month, avg_eur_per_m2: round(p.avg_price_eur_m2) }));
  const byDev = {};
  for (const p of all) { if (!p.developer) continue; const d = (byDev[p.developer] ||= { developer: p.developer, projects: 0, units: 0, sold_30d: 0 }); d.projects++; d.units += p.total_units || 0; d.sold_30d += p.sold_last_month || 0; }
  const top_developers = Object.values(byDev).sort((a, b) => b.units - a.units).slice(0, 10);
  return { markets, top_sellers_30d, top_developers };
}

async function toolMarketStats(admin, a, allowHistorical) {
  const [mode, gated] = pageMode(a.mode, allowHistorical);
  if (gated) return { gated: true, message: "Month-by-month history is a paid feature. On the current-month data I can answer fully." };
  const gkey = GROUP_KEY[a.group_by || "none"];
  const spec = { dims: gkey ? [gkey] : [], filters: buildFilters(a), ranges: buildRanges(a), mode };
  const { data, error } = await admin.rpc("analytics_pivot", { p_spec: spec });
  if (error) throw new Error(error.message);
  const groups = (data || []).map((g) => {
    const m = g.m || {};
    return {
      group: gkey ? (g.d && g.d[0] != null ? String(g.d[0]) : "(none)") : "ALL",
      units: m.n || 0, available: m.avail || 0, sold: m.sold || 0, reserved: m.res || 0,
      avg_price_eur: m.n_cs ? Math.round(m.s_cs / m.n_cs) : null,
      avg_eur_per_m2: m.s_lw ? Math.round(m.s_pw / m.s_lw) : null,
      min_price: round(m.mn_cs), max_price: round(m.mx_cs),
    };
  });
  groups.sort((x, y) => y.units - x.units); // keep payload small + useful
  return { mode, group_by: a.group_by || "none", groups: groups.slice(0, 60) };
}

async function toolSearchApartments(admin, a, allowHistorical) {
  const [mode, gated] = pageMode(a.mode, allowHistorical);
  if (gated) return { gated: true, message: "Searching past months is a paid feature. I can search what's on the market now." };
  const sortMap = { price: "cena_s_dph", eur_per_m2: "price_per_m2", floor: "poschodie", area: "obytna_plocha", rooms: "izby" };
  const status = a.status || "available";
  const reqLimit = Math.min(Math.max(a.limit || 50, 1), 100);
  const spec = {
    columns: ["project_name", "unit_id", "city", "cast", "izby", "poschodie", "obytna_plocha", "cena_s_dph", "price_per_m2", "stav"],
    filters: buildFilters({ ...a, status }),
    ranges: buildRanges(a, { withFloor: true, withArea: true }),
    sort: [{ key: sortMap[a.sort || "price"], dir: a.order === "desc" ? "desc" : "asc" }],
    limit: reqLimit,
    mode,
  };
  const { data, error } = await admin.rpc("analytics_units", { p_spec: spec });
  if (error) throw new Error(error.message);
  const STATUS_LABEL = { V: "available", P: "sold", R: "reserved", PR: "pre-reserved" };
  const raw = (data && data.rows) || [];
  const has_more = raw.length > reqLimit; // engine fetched limit+1 to signal a next page
  const rows = raw.slice(0, reqLimit).map((r) => ({
    project: r.project_name, unit: r.unit_id, city: r.city, district: r.cast,
    rooms: r.izby != null ? Math.round(Number(r.izby)) : null,
    floor: r.poschodie, area_m2: num(r.obytna_plocha),
    price_eur: round(r.cena_s_dph), eur_per_m2: round(r.price_per_m2),
    status: STATUS_LABEL[r.stav] || r.stav,
  }));
  return { mode, count: rows.length, has_more, apartments: rows };
}

async function executeTool(admin, name, args, allowHistorical) {
  try {
    if (name === "market_overview")   return await toolMarketOverview(admin);
    if (name === "market_stats")      return await toolMarketStats(admin, args || {}, allowHistorical);
    if (name === "search_apartments") return await toolSearchApartments(admin, args || {}, allowHistorical);
    return { error: `unknown tool ${name}` };
  } catch (e) {
    return { error: String(e?.message || e).slice(0, 300) };
  }
}

// ────────────────────────────────────────────────────────────────

function systemPrompt(lang, allowHistorical) {
  const histLine = allowHistorical
    ? "You have CURRENT and HISTORICAL data (month-by-month). Pass mode 'historical' to the tools for history."
    : "You have CURRENT data only. Month-by-month history is a paid feature — if asked for history, say so in one sentence and answer fully on the current data.";
  const respondIn = lang === "sk"
    ? "ALWAYS reply in natural, native Slovak — never translated-sounding. Keep the analyst register."
    : "Reply in English.";
  // The standing analyst briefing (Boss-authored 2026-06-23). English brief +
  // reply-in-user-language directive = one source of truth, no translation drift.
  return [
    "# RESIDATA AI ANALYST — your standing briefing. It applies to EVERY answer.",
    "",
    "## 1. Who you are",
    "You are Residata's senior market analyst for new-build apartments (novostavby). Residata covers MULTIPLE markets and adds more over time — it began with Slovakia (SK) and Czechia (CZ), and by the time you read this there may be more. So whenever a question turns on which markets / countries / cities exist, CHECK THE ACTUAL DATA via a tool (e.g. market_overview) instead of assuming the list.",
    "You are not a chatbot reciting numbers — you are the expert a developer, agent, fund or serious buyer would pay to talk to. You know this market cold: price levels, €/m², how fast things sell, which districts carry a premium, how developers stage and price releases, and — crucially — what the numbers mean for the person asking.",
    "Your standard: every answer should make the user think 'that's exactly what I needed — and sharper than I expected.' Lead with the answer, back it with the numbers, add one layer of real insight, point to the smart next step. Never basic.",
    "",
    "## 2. What Residata is",
    "Residata tracks every developer's price list across its covered markets — DAILY — cleaned and made comparable, unit by unit: price, €/m², size, rooms, floor, orientation, completion date, status. The value is the clean, cross-developer picture no single developer or portal has. (At the time of writing the markets are Slovakia and Czechia — but this can grow; check the data.)",
    "",
    "## 3. How you get the numbers — TOOLS (never invent a number)",
    "Get EVERY number from the tools — they query the live database. NEVER invent figures or compute percentages in your head; if it's not in a tool result, call a tool.",
    "· market_overview = market totals per country + best-selling / fastest-moving projects + top developers. Use for market-wide questions, 'what's covered', and country comparisons.",
    "· market_stats = counts / averages / €m² grouped by a dimension (district, city, developer, rooms, month…) with filters; includes month-by-month history (mode 'historical').",
    "· search_apartments = specific apartments by criteria (city, district, rooms, floor, price…). Searches the WHOLE database, no cap. If a result has has_more=true you're seeing only the top matches by the chosen sort — say there are more and offer to narrow/re-sort; never imply the list is complete.",
    "· Call several tools in sequence when a question needs it.",
    `· ${histLine}`,
    "",
    "## 4. How to READ the data — master this; it's where analysts go wrong",
    "Statuses: V = available (on sale now) · P = sold · R = reserved (committed) · PR = pre-reserved (soft, may return) · 'Ešte nie v ponuke' = a future phase, not yet for sale.",
    "'Sold' is FREQUENTLY INCOMPLETE — never judge demand by it. Many developers' price lists show only what's currently for sale; once a unit sells it disappears from the feed, so the 'sold' count reads low or zero even when the project is selling briskly. ~1 in 6 active projects shows 0 sold for this reason alone (e.g. Downtown Yards, Danubius, Rezidence Veveri). NEVER call a low/zero sold count a 'red flag', 'weak demand', or 'the market rejected the prices'. If you lack sold/velocity data for a project, say plainly that we track its live availability and draw NO demand conclusion.",
    "The real demand signal is 'sold in the last 30 days' (velocity) where we have it — use it for 'what's moving fastest'. Its absence ≠ weak demand.",
    "Metrics: €/m² = price (incl. VAT) ÷ LIVING area — the cleanest cross-project comparison; always judge a project's €/m² against its city/district peers, not the whole market. Price (cena s DPH) = what the buyer actually pays, VAT included (SK 23%, CZ 21%) — the headline price. Availability = units on the market now; high availability can mean a fresh/large launch OR slow absorption — pair it with velocity and completion, never assume. Completion (kolaudácia): sooner = less wait/risk; far-out = more uncertainty + usually staged pricing. Floor / orientation / view drive price WITHIN a project (top floors + good orientation carry a premium).",
    "Geography: every unit is tagged country + city + district. Always say where a project is; default across all covered markets unless asked for one; never merge same-named districts across countries.",
    "No-price projects: some developers don't publish prices — that's 'price on request', NOT sold.",
    "Never invent or back-calculate a number you don't have. If a figure isn't in the data, say so in one sentence — don't pass an estimate off as ours.",
    "",
    "## 5. Be an advisor, not a lookup",
    "Lead with the direct answer → key numbers → one layer of insight → a useful next step. Compare in context ('€6,200/m² — ~15% above the Ružinov average, in line with new towers there'). Segment intelligently (value vs premium, central vs outer, ready-soon vs far-out, big-choice vs nearly-sold-out).",
    "For a buyer with a budget: translate income into a realistic price ceiling (flag it as general guidance, not a mortgage quote), then surface the projects that fit on price, rooms, location AND choice (how many units are actually available), and name the trade-offs. For investor-type questions: give the factual signals (price vs district, velocity, availability, completion) and let them judge — never 'buy this'. Volunteer the adjacent fact they'd want ('cheapest is Central Point — but only 3 units left; for real choice, Rakyta has ~40 three-rooms').",
    "",
    "## 6. Be a real conversation partner — judge by context",
    "Read the situation. A quick factual question gets a tight factual answer. But when someone is exploring, deliberating, or genuinely talking WITH you, be a professional conversation partner — engage, explain the 'why', walk through the trade-offs, ask a sharp clarifying question if it will improve your answer. Do NOT reduce a real conversation to a bare data dump. Match the depth and warmth to the moment.",
    "",
    "## 7. How to talk",
    "Confident, sharp analyst who respects the reader's time. Tight and structured — crisp sentences or a short labelled list; no preamble, no padding, no repetition. No 'unfortunately/sorry', no hand-wringing about gaps — one plain sentence and move on. Always label market/city ('Slnečnice — Bratislava, Petržalka, SK'). Round sensibly (€6,200/m², 86%). Plain text, no markdown, no **bold**. Don't say you're an AI. Separate OUR data from general knowledge — if you use market/economic context beyond Residata's data, flag it briefly so the user knows it's not our figure.",
    "",
    "## 8. Hard rules / guardrails",
    "· NOT investment advice. Never tell anyone to buy/sell/invest in a specific project or unit. Describe facts. For 'should I buy X / is it a good investment / what do you recommend', give what the data says, then add: 'This is market information, not investment advice.'",
    "· Never infer 'not selling / red flag / overpriced' from a low sold count (see §4).",
    "· Never invent numbers, never mix markets/countries, never send people to a developer or agent to 'check for yourself'.",
    "· Stay in lane — you analyze the new-build market from Residata's data; deflect off-topic asks politely.",
    "",
    "## 9. Amazing vs basic",
    "BASIC (wrong): 'Danubius has 0 sold — red flag, the market rejected the prices.' AMAZING: 'Danubius (Ružinov, Bratislava) — 117 units available and moving: ~7 sold in the last 30 days, one of the more active towers in the district. For projects like this we mainly track live availability, so don't read the headline sold figure as total sales.'",
    "",
    respondIn,
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Shared reservation context: handleInner reserves a daily-cap slot up front
  // (an ai_usage_log row) and either finalizes it (success) or releases it. If
  // an unexpected error throws out of handleInner before finalize, release the
  // reservation here so a crash never permanently consumes the user's quota.
  const ctx = { admin: null, reservationId: null, finalized: false };
  try {
    return await handleInner(req, res, ctx);
  } catch (e) {
    console.error("[chat] top-level crash", e);
    if (ctx.admin && ctx.reservationId != null && !ctx.finalized) {
      try { await ctx.admin.from("ai_usage_log").delete().eq("id", ctx.reservationId); } catch (_) {}
    }
    // If we've already started streaming, headers are sent — just close.
    if (res.headersSent) { try { res.end(); } catch (_) {} return; }
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}

async function handleInner(req, res, ctx) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });

  const ip = clientIp(req);
  const ipGate = ipRateCheck(ip);
  if (!ipGate.ok) { res.setHeader("Retry-After", String(ipGate.retryAfterSec)); return res.status(429).json({ error: "rate limit: too many requests from this IP", retry_after_sec: ipGate.retryAfterSec }); }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return res.status(500).json({ error: "server misconfigured: SUPABASE envs missing" });

  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  ctx.admin = admin;   // so the top-level catch can release a stranded reservation

  let userId = null;
  let tier = "anon";
  if (token) {
    try {
      const { data: { user }, error: authErr } = await admin.auth.getUser(token);
      if (authErr || !user) return res.status(401).json({ error: "invalid or expired token" });
      userId = user.id;
      const { data: prof } = await admin.from("user_profiles").select("tier, chosen_project_id, trial_until, paid_until, paid_pause_started").eq("id", userId).maybeSingle();
      if (prof?.tier === "pending") return res.status(403).json({ error: "account pending approval" });
      tier = effectiveTier(prof);   // trial -> paid
    } catch (_) { return res.status(401).json({ error: "auth verification failed" }); }
  }
  const model = MODEL_BY_TIER[tier] || FALLBACK_MODEL;
  const allowHistorical = isPaidTier(tier);

  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) apiKey = await readSecret(admin, "ANTHROPIC_API_KEY");
  if (!apiKey) return res.status(501).json({ error: "AI disabled on the server (ANTHROPIC_API_KEY missing)." });

  // ── body ──
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON body" }); } }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "empty body" });
  if (JSON.stringify(body).length > MAX_INPUT_BYTES) return res.status(413).json({ error: "body too large" });
  const lang = body.lang === "en" ? "en" : "sk";
  const messagesIn = Array.isArray(body.messages) ? body.messages : null;
  const sessionId = (typeof body.sessionId === "string" && /^[0-9a-f-]{8,}$/i.test(body.sessionId)) ? body.sessionId : null;
  const typingMs = (typeof body.typingMs === "number" && body.typingMs >= 0 && body.typingMs < DAY_MS) ? Math.round(body.typingMs) : null;
  const pageUrl = (typeof body.pageUrl === "string" && body.pageUrl.length < 500) ? body.pageUrl : null;
  const userAgent = (typeof req.headers["user-agent"] === "string") ? String(req.headers["user-agent"]).slice(0, 500) : null;
  if (!messagesIn || messagesIn.length === 0) return res.status(400).json({ error: "messages array required" });
  if (messagesIn.length > MAX_HISTORY * 2) return res.status(400).json({ error: `too many messages (max ${MAX_HISTORY * 2})` });

  const messages = [];
  for (const m of messagesIn) {
    if (!m || typeof m !== "object") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (typeof m.content !== "string") continue;
    const c = m.content.trim(); if (!c) continue;
    messages.push({ role: m.role, content: c.slice(0, MAX_MSG_LEN) });
  }
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "last message must be from the user" });

  // ── daily cap (effective tier) ──
  const dayLimit = DAILY_LIMITS[tier] ?? DAILY_LIMITS.anon;
  // DURABLE daily cap for BOTH tiers: count today's rows in ai_usage_log — by user_id
  // for logged-in, by caller_ip for anon. The anon count used to live in an in-memory
  // Map (per-serverless-instance, reset on cold start) → the 1/day anon cap was
  // bypassable across Vercel instances. Reading it from the DB makes it a real cap.
  // Calendar-day UTC window so enforcement matches the documented "resets at
  // 00:00 UTC". The previous rolling 24h window kept a user blocked long past
  // the promised reset (a 15:00 question still counted at 00:01) and made
  // retry_after uncomputable. Boundary burst is separately capped by the 10/min
  // per-IP limit above.
  const capNow = new Date();
  const startOfDayUtc = new Date(Date.UTC(capNow.getUTCFullYear(), capNow.getUTCMonth(), capNow.getUTCDate()));
  // ATOMIC reserve: count-under-a-per-principal-lock + conditional insert in ONE
  // DB call (public.ai_usage_reserve). Replaces the old count-then-insert-later
  // pattern whose multi-second gap let two concurrent requests both pass a cap.
  // We reserve the slot NOW (an ai_usage_log row) and later either UPDATE it with
  // token counts on success or DELETE it on failure — so a failed answer still
  // doesn't count, but the cap can no longer be doubled under concurrency.
  let dayCount = 0;
  let allowed = false;
  try {
    const { data: rez, error: rezErr } = await admin.rpc("ai_usage_reserve", {
      p_user_id: userId || null,
      p_ip: ip || null,   // stored on the row for both tiers; counting keys on user_id when logged in
      p_limit: dayLimit,
      p_since: startOfDayUtc.toISOString(),
      p_endpoint: "chat",
    });
    if (rezErr) throw rezErr;
    const row = Array.isArray(rez) ? rez[0] : rez;
    allowed = !!row?.allowed;
    dayCount = row?.day_count ?? 0;
    if (allowed) ctx.reservationId = row?.reservation_id ?? null;
  } catch (_) { return res.status(503).json({ error: "rate limit lookup failed, try again" }); }
  if (!allowed) {
    const upgrades = {
      anon: { to: "free", daily: DAILY_LIMITS.free, action: "sign_in" },
      free: { to: "paid", daily: DAILY_LIMITS.paid, action: "billing" },
      paid: { to: null, daily: null, action: "contact" },
      admin:{ to: null, daily: null, action: "contact" },
    };
    const up = upgrades[tier] || upgrades.anon;
    const msg = lang === "sk"
      ? (tier === "anon" ? `Vyčerpal si denný limit ${dayLimit} otázky pre neprihlásených. Prihlás sa (free) pre ${up.daily}/deň, alebo zaplať tier pre ${DAILY_LIMITS.paid}/deň.`
        : tier === "free" ? `Vyčerpal si denný limit ${dayLimit} otázok pre free tier. Upgrade na paid (${DAILY_LIMITS.paid}/deň).`
        : `Vyčerpal si denný limit ${dayLimit} otázok. Kontaktuj Residata pre vyšší limit.`)
      : (tier === "anon" ? `You've used your daily ${dayLimit} question as an anonymous user. Sign in (free) for ${up.daily}/day, or go paid for ${DAILY_LIMITS.paid}/day.`
        : tier === "free" ? `You've used your daily ${dayLimit} questions on the free tier. Upgrade to paid for ${DAILY_LIMITS.paid}/day.`
        : `You've used your daily ${dayLimit} questions. Contact Residata for a higher limit.`);
    // Real seconds until the cap actually resets (next 00:00 UTC), not a fixed
    // hour — so the client's "try again in N" is honest.
    const nextMidnightUtc = new Date(Date.UTC(capNow.getUTCFullYear(), capNow.getUTCMonth(), capNow.getUTCDate() + 1));
    const retryAfterSec = Math.max(60, Math.ceil((nextMidnightUtc.getTime() - Date.now()) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: msg, tier, limit: dayLimit, upgrade_to: up.to, upgrade_action: up.action, upgrade_daily: up.daily, retry_after_sec: retryAfterSec });
  }

  // ── log the user turn ──
  const lastUserMsg = messages[messages.length - 1];
  const baseRow = { session_id: sessionId, user_id: userId || null, caller_ip: ip || null, tier: tier || null, lang, page_url: pageUrl, user_agent: userAgent };
  const logTurn = (row) => { if (!sessionId) return; admin.from("ai_chat_log").insert({ ...baseRow, ...row }).then(({ error }) => { if (error) console.warn("[chat] ai_chat_log insert failed", error.message); }); };
  logTurn({ turn_index: messages.length - 1, role: "user", content: lastUserMsg.content, user_typing_ms: typingMs });

  // ── streaming (opt-in: body.stream === true) ──
  // All auth/cap/validation errors already returned JSON by status above, so by
  // here we're committed to a 200. When the client asks to stream, we emit a
  // `start` event, a `step` event as each tool runs (so the UI shows what's
  // happening), then a final `done` event. Non-streaming callers (no flag) get
  // the JSON body at the end, unchanged — so this is backward-compatible.
  const wantStream = body.stream === true;
  let sseStarted = false;
  const sse = (obj) => {
    if (!wantStream) return;
    if (!sseStarted) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // ask proxies not to buffer
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      sseStarted = true;
    }
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === "function") res.flush();
  };
  const STEP_LABELS = lang === "sk"
    ? { market_overview: "Čítam prehľad trhu…", market_stats: "Počítam čísla z databázy…", search_apartments: "Hľadám konkrétne byty…" }
    : { market_overview: "Reading the market overview…", market_stats: "Crunching the numbers…", search_apartments: "Searching the apartments…" };
  sse({ type: "start", label: lang === "sk" ? "Premýšľam…" : "Thinking…" });

  // ── tool-calling loop ──
  const system = [{ type: "text", text: systemPrompt(lang, allowHistorical), cache_control: { type: "ephemeral" } }];
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const startedAt = Date.now();
  let textOut = "";
  let lastError = null;

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages: convo }),
      });
    } catch (e) { lastError = String(e?.message || e); break; }
    if (!resp.ok) { lastError = `anthropic_${resp.status}`; const t = await resp.text().catch(() => ""); console.error("[chat] anthropic", resp.status, t.slice(0, 400)); break; }
    const payload = await resp.json();
    const u = payload.usage || {};
    usage.input_tokens += u.input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
    usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    usage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;

    const content = payload.content || [];
    textOut = content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();

    if (payload.stop_reason === "tool_use") {
      const toolUses = content.filter((c) => c.type === "tool_use");
      convo.push({ role: "assistant", content });
      const results = [];
      for (const tu of toolUses) {
        sse({ type: "step", tool: tu.name, label: STEP_LABELS[tu.name] || (lang === "sk" ? "Pracujem…" : "Working…") });
        const out = await executeTool(admin, tu.name, tu.input, allowHistorical);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 30000) });
      }
      convo.push({ role: "user", content: results });
      continue; // ask the model again with the tool results
    }
    break; // end_turn (or other) — we have the answer
  }
  const responseTimeMs = Date.now() - startedAt;
  if (!textOut && lastError) {
    // Answer failed → release the reserved slot so it doesn't count (unchanged
    // leniency: a failed answer is free).
    if (ctx.reservationId != null && !ctx.finalized) {
      try { await admin.from("ai_usage_log").delete().eq("id", ctx.reservationId); } catch (_) {}
      ctx.reservationId = null;
    }
    if (wantStream) { sse({ type: "error", text: lang === "sk" ? "Chyba AI, skús to znova." : "AI error — please try again." }); return res.end(); }
    return res.status(502).json({ error: "AI upstream error", detail: lastError.slice(0, 120) });
  }
  if (!textOut) textOut = lang === "sk" ? "Nepodarilo sa vygenerovať odpoveď, skús to znova." : "I couldn't generate an answer — please try again.";

  // ── log assistant turn (summed usage across the tool loop) ──
  let assistantLogId = null;
  if (sessionId) {
    try {
      const { data, error } = await admin.from("ai_chat_log").insert({
        ...baseRow, turn_index: messages.length, role: "assistant", content: textOut,
        response_time_ms: responseTimeMs, model,
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
      }).select("id").single();
      if (error) console.warn("[chat] assistant insert failed", error.message);
      else assistantLogId = data?.id || null;
    } catch (e) { console.warn("[chat] assistant insert threw", e?.message || e); }
  }

  // ── finalize the usage/billing counter (one row per question) ──
  // The slot was already RESERVED atomically before the LLM call (ai_usage_reserve),
  // which is what makes the daily cap race-safe. Here we just UPDATE that reserved
  // row with the token counts. Fallback to a plain INSERT if we somehow have no
  // reservation id, so the cap row still lands either way. Marking ctx.finalized
  // stops the top-level catch from releasing a legitimately-counted question.
  try {
    if (ctx.reservationId != null) {
      const { error: usageErr } = await admin.from("ai_usage_log").update({
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
      }).eq("id", ctx.reservationId);
      if (usageErr) console.warn("[chat] usage finalize failed", usageErr.message);
    } else {
      const { error: usageErr } = await admin.from("ai_usage_log").insert({
        user_id: userId || null, caller_ip: ip || null, endpoint: "chat", ok: true,
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
      });
      if (usageErr) console.warn("[chat] usage log failed", usageErr.message);
    }
    ctx.finalized = true;   // the slot is legitimately consumed; don't release it
  } catch (e) { console.warn("[chat] usage log threw", e?.message || e); ctx.finalized = true; }

  const result = {
    text: textOut, tier, model, log_id: assistantLogId,
    remaining: { today: Math.max(0, dayLimit - dayCount - 1) },
    usage, response_time_ms: responseTimeMs,
  };
  if (wantStream) { sse({ type: "done", ...result }); return res.end(); }
  return res.status(200).json(result);
}
