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
import { isTrustedOrigin as checkTrustedOrigin } from "../_lib/origin.js";

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

const TRUSTED_ORIGINS = [
  "https://residata-gamma.vercel.app",
  "https://residata.sk",
  "https://www.residata.sk",
  "http://localhost:5173",
  "http://localhost:3000",
];
const isTrustedOrigin = (req) => checkTrustedOrigin(req, TRUSTED_ORIGINS);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "0.0.0.0";
}

/* Effective tier: an active trial (trial_until > now) is treated as paid — the
   same promotion src/lib/capabilities.js does (trial keeps the row tier 'free'). */
function effectiveTier(prof) {
  const base = prof?.tier || "anon";
  if (base === "free" && prof?.trial_until && new Date(prof.trial_until).getTime() > Date.now()) {
    return "paid";
  }
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

// Per-IP ANON daily counter (in-memory, resets on cold start / midnight UTC).
const anonBucket = new Map();
function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function anonDailyCount(ip) { const b = anonBucket.get(ip); return (!b || b.day !== todayKey()) ? 0 : b.count; }
function anonDailyIncrement(ip) {
  const day = todayKey(); const b = anonBucket.get(ip);
  if (!b || b.day !== day) { anonBucket.set(ip, { day, count: 1 }); return 1; }
  b.count += 1; return b.count;
}

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
  const SK = lang !== "en";
  const histLine = allowHistorical
    ? (SK ? "Máš prístup k AKTUÁLNYM aj HISTORICKÝM dátam (mesiac po mesiaci) — pre históriu daj mode 'historical'."
          : "You have CURRENT and HISTORICAL data (month-by-month) — pass mode 'historical' for history.")
    : (SK ? "Máš prístup k AKTUÁLNYM dátam. História (mesiac po mesiaci) je platená funkcia — ak ju pýta, povedz to jednou vetou."
          : "You have CURRENT data. Month-by-month history is a paid feature — if asked, say so in one sentence.");
  if (SK) {
    return [
      "Si AI analytik Residata — dátovej služby pre trh novostavieb na Slovensku a v Česku (SK + CZ).",
      "",
      "AKO ODPOVEDÁŠ:",
      "· VŠETKY čísla získavaj cez nástroje (tools) — dotazujú živú databázu všetkých bytov a projektov. NIKDY si čísla nevymýšľaj a nepočítaj percentá z hlavy; ak nie sú v odpovedi nástroja, zavolaj nástroj.",
      "· market_overview = prehľad trhu, najpredávanejšie / najrýchlejšie projekty, porovnanie SK vs CZ.",
      "· market_stats = počty/priemery/€m² zoskupené podľa dimenzie (okres, mesto, developer, izby, mesiac…) s filtrami; vrátane histórie (mode 'historical').",
      "· search_apartments = konkrétne byty podľa kritérií (mesto, okres, izby, poschodie, cena…). Prehľadáva CELÚ databázu, žiadny strop. Ak má výsledok has_more=true, vidíš len prvé výsledky podľa triedenia — povedz že je ich viac a ponúkni zúženie; netvrď že je to úplný zoznam.",
      "· Pokojne zavolaj viac nástrojov po sebe. Po získaní dát odpovedz vecne.",
      `· ${histLine}`,
      "",
      "TRHY (SK + CZ): odpovedaj defaultne za OBA trhy; filtruj na jeden LEN keď to užívateľ pýta. Pri projektoch z rôznych miest VŽDY uveď kde sú — napr. 'Slnečnice (Bratislava, SK)', 'Nový Rohan (Praha, CZ)'.",
      "",
      "HLAS: sebavedomý analytik, nie hedge-ujúci byrokrat. ZÁKAZ slov 'žiaľ/bohužiaľ/prepáčam/sorry/unfortunately'. Ak nástroj vráti 0 výsledkov, povedz to priamo (napr. 'žiadny byt nespĺňa kritériá'), neospravedlňuj sa za 'chýbajúce dáta'. Ak konkrétne pole reálne v dátach nie je, povedz to 1 vetou a ponúkni paid: residata@proton.me.",
      "",
      "PRÁVNE: toto NIE je investičné poradenstvo. Neraď konkrétne kúpiť/predať. Opisuj fakty (predajnosť, cena, dostupnosť). Pri otázke 'mám kúpiť X?' uveď čo hovoria dáta + 'Toto je tržná informácia, nie investičné odporúčanie.'",
      "",
      "FORMÁT: krátko, 2–5 viet alebo krátky zoznam. Plain text, žiadny markdown, žiadne **tučné**. Neuvádzaj že si AI.",
    ].join("\n");
  }
  return [
    "You are Residata's AI analyst — a market-data service for Slovak and Czech (SK + CZ) new-build apartments.",
    "",
    "HOW YOU ANSWER:",
    "· Get ALL numbers via the tools — they query the live database of every apartment and project. NEVER invent numbers or compute percentages in your head; if it's not in a tool result, call a tool.",
    "· market_overview = market totals, best-selling / fastest-moving projects, SK-vs-CZ comparison.",
    "· market_stats = counts/averages/€m² grouped by a dimension (district, city, developer, rooms, month…) with filters; includes history (mode 'historical').",
    "· search_apartments = specific apartments by criteria (city, district, rooms, floor, price…). Searches the WHOLE database, no cap. If the result has has_more=true you're seeing only the top matches by the chosen sort — say there are more and offer to narrow/re-sort; never imply the list is complete.",
    "· Call multiple tools in sequence if needed. Once you have the data, answer concretely.",
    `· ${histLine}`,
    "",
    "MARKETS (SK + CZ): answer across BOTH by default; filter to one only when asked. When listing projects from different places ALWAYS say where each is — e.g. 'Slnečnice (Bratislava, SK)', 'Nový Rohan (Prague, CZ)'.",
    "",
    "VOICE: confident analyst, not a hedging bureaucrat. BANNED: 'unfortunately/sorry/apologies'. If a tool returns 0 results, say it plainly ('no apartment matches those criteria') — do NOT apologise for 'missing data'. If a specific field genuinely isn't in the data, say so in one sentence and offer the paid tier: residata@proton.me.",
    "",
    "LEGAL: this is NOT investment advice. Don't recommend buying/selling a specific project. Describe facts (sales pace, price, availability). For 'should I buy X?' give what the data says + 'This is market information, not investment advice.'",
    "",
    "FORMAT: short — 2–5 sentences or a short list. Plain text, no markdown, no **bold**. Don't say you're an AI.",
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    return await handleInner(req, res);
  } catch (e) {
    console.error("[chat] top-level crash", e);
    // If we've already started streaming, headers are sent — just close.
    if (res.headersSent) { try { res.end(); } catch (_) {} return; }
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}

async function handleInner(req, res) {
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

  let userId = null;
  let tier = "anon";
  if (token) {
    try {
      const { data: { user }, error: authErr } = await admin.auth.getUser(token);
      if (authErr || !user) return res.status(401).json({ error: "invalid or expired token" });
      userId = user.id;
      const { data: prof } = await admin.from("user_profiles").select("tier, chosen_project_id, trial_until").eq("id", userId).maybeSingle();
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
  let dayCount = 0;
  if (userId) {
    try {
      const { count } = await admin.from("ai_usage_log").select("id", { count: "exact", head: true })
        .gte("requested_at", new Date(Date.now() - DAY_MS).toISOString()).eq("user_id", userId);
      dayCount = count || 0;
    } catch (_) { return res.status(503).json({ error: "rate limit lookup failed, try again" }); }
  } else { dayCount = anonDailyCount(ip); }
  if (dayCount >= dayLimit) {
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
    return res.status(429).json({ error: msg, tier, limit: dayLimit, upgrade_to: up.to, upgrade_action: up.action, upgrade_daily: up.daily, retry_after_sec: 3600 });
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

  // ── usage/billing counter (one row per question) ──
  if (userId) {
    admin.from("ai_usage_log").insert({
      user_id: userId, endpoint: "chat", ok: true,
      input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
    }).then(({ error }) => { if (error) console.warn("[chat] usage log failed", error.message); });
  } else { anonDailyIncrement(ip); }

  const result = {
    text: textOut, tier, model, log_id: assistantLogId,
    remaining: { today: Math.max(0, dayLimit - dayCount - 1) },
    usage, response_time_ms: responseTimeMs,
  };
  if (wantStream) { sse({ type: "done", ...result }); return res.end(); }
  return res.status(200).json(result);
}
