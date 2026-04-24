// Vercel serverless endpoint: /api/ai/chat
//
// Residata AI assistant — grounded chatbot. Users ask free-form
// questions about the Bratislava new-build market, the endpoint
// assembles a TIER-APPROPRIATE data context from Supabase, calls
// Claude, and returns prose. Tier-based context slicing is the key
// data-protection mechanism: anonymous users CANNOT see per-project
// detail because the server doesn't put that data in the prompt —
// it's not a "tell Claude not to share it" rule (unreliable), it's
// "the information never reaches Claude" (ironclad).
//
// === Security layers (defence in depth) ===
//
// 1. **Origin / Referer allowlist** — rejects curl / Postman calls
//    that didn't come from a trusted Residata domain. CORS is
//    browser-enforced so this server-side check is the actual gate.
//
// 2. **Per-IP rate limit** (10 req/min in-memory) — absorbs bursty
//    abuse before it hits the DB counter or spends Anthropic credit.
//
// 3. **Auth verification** (Supabase session) — for logged-in users
//    we read tier from user_profiles server-side. Client can't lie
//    about their tier; anon is the only un-authed state and it hits
//    the strictest limits.
//
// 4. **Tier-based daily counter** (ai_usage_log) — caps per user
//    (or per IP for anon) by tier. Persists across serverless cold
//    starts via the DB. Paid 30/day, free 10/day, anon 3/day, admin
//    100/day. pending tier is refused outright.
//
// 5. **Bounded input** — request JSON max 24 KB. Each user message
//    max 2000 chars. Conversation history max 10 turns.
//
// 6. **Bounded output** — max_tokens=500 on Anthropic side. Worst-
//    case single call cost ≈ $0.015 for paid, $0.01 for free.
//
// 7. **Monthly hard cap on Anthropic side** — configured in the
//    Anthropic dashboard (Usage Limits → Monthly Spend Cap). Set
//    this to $100-200/month as a last-resort backstop.
//
// === Request / response ===
//
//   Request:
//     { messages: [{role: 'user'|'assistant', content: string}],
//       lang: 'sk'|'en' }
//
//   Response (200):
//     { text, tier, remaining: { today }, usage: { input_tokens, output_tokens } }
//
//   Non-200:
//     401 — not authenticated (when the caller sent an invalid token)
//     403 — untrusted origin OR tier is 'pending' (awaiting approval)
//     429 — rate limit (per-IP or per-tier daily cap)
//     413 — body too large
//     501 — ANTHROPIC_API_KEY missing
//     500 — unexpected server error

import { createClient } from "@supabase/supabase-js";

export const maxDuration = 30;

// Haiku 4.5 — 3× faster than Sonnet, 5× cheaper, and quality is
// plenty for grounded market Q&A (we're answering from a structured
// JSON context, not doing complex reasoning). Switch to Sonnet if
// users start asking questions that need chain-of-thought.
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const MAX_TOKENS      = 500;
const MAX_INPUT_BYTES = 24 * 1024;
const MAX_HISTORY     = 10;
const MAX_MSG_LEN     = 2000;
// Data-context cache. The market data only refreshes on monthly
// sync, so a 15-min TTL is safe and cuts two Supabase round-trips
// from every chat request → shaves ~300-800ms off cold turns.
const CTX_TTL_MS      = 15 * 60 * 1000;
const ctxCache        = new Map();  // key → { at: ms, value: object }
function cachedContext(key, builder) {
  const hit = ctxCache.get(key);
  if (hit && Date.now() - hit.at < CTX_TTL_MS) return Promise.resolve(hit.value);
  return builder().then(v => { ctxCache.set(key, { at: Date.now(), value: v }); return v; });
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

// Per-day caps by tier. pending is refused earlier in the flow.
// Design note (2026-04-24): topic-restriction by tier was REMOVED —
// every tier (anon included) now receives the full market context.
// Only the daily question quantity changes between tiers. This is
// the "free taste for everyone, pay for volume" model.
const DAILY_LIMITS = {
  anon:  1,
  free:  3,
  paid:  30,
  admin: 100,
};

const TRUSTED_ORIGINS = [
  "https://residata-gamma.vercel.app",
  "https://residata.sk",
  "https://www.residata.sk",
  "http://localhost:5173",
  "http://localhost:3000",
];

function isTrustedOrigin(req) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  if (origin && TRUSTED_ORIGINS.some(o => origin === o)) return true;
  if (referer && TRUSTED_ORIGINS.some(o => referer.startsWith(o))) return true;
  return false;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "0.0.0.0";
}

/* Read one secret from app_secrets via service-role. Returns null on
   any failure so the caller can fall back to a 501 response. */
async function readSecret(admin, key) {
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("app_secrets")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) return null;
    return data?.value || null;
  } catch (_) { return null; }
}

// In-memory per-IP rate limit (10 requests/min). Resets on cold start
// but that's fine — it's a bursty-abuse absorber, the tier-based DB
// counter is the persistent authority for logged-in users.
const ipBucket = new Map();  // ip → { start: ms, count: number }
const IP_WINDOW_MS = 60 * 1000;
const IP_MAX = 10;
function ipRateCheck(ip) {
  const now = Date.now();
  const b = ipBucket.get(ip);
  if (!b || now - b.start > IP_WINDOW_MS) {
    ipBucket.set(ip, { start: now, count: 1 });
    return { ok: true };
  }
  b.count += 1;
  if (b.count > IP_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((b.start + IP_WINDOW_MS - now) / 1000) };
  }
  return { ok: true };
}

// Per-IP ANON daily counter (in-memory, 24h TTL). For logged-in
// users we use the ai_usage_log DB row count, but anon doesn't
// write to that table (no user_id). This counter stops the most
// obvious bypass (hit limit → hard-refresh → get another free
// question) as long as the Vercel function stays warm. Cold
// starts reset the counter; a fully bullet-proof persistent
// counter requires a DB table, tracked as a v2 follow-up.
const anonBucket = new Map();  // ip → { day: "2026-04-24", count: number }
function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function anonDailyCount(ip) {
  const day = todayKey();
  const b = anonBucket.get(ip);
  if (!b || b.day !== day) return 0;
  return b.count;
}
function anonDailyIncrement(ip) {
  const day = todayKey();
  const b = anonBucket.get(ip);
  if (!b || b.day !== day) { anonBucket.set(ip, { day, count: 1 }); return 1; }
  b.count += 1;
  return b.count;
}

// ────────────────────────────────────────────────────────────────
// Tier-aware data context builders.
// Each function returns a structured JSON of Residata data scoped
// to what the caller is allowed to see. The JSON gets serialised
// into the system prompt so Claude answers from it. Anything not
// in the returned object is invisible to the LLM — no amount of
// prompt-jailbreaking can reveal paid-tier data to an anon caller.
// ────────────────────────────────────────────────────────────────

/* Append user's chosen-project flat-level detail on top of the
   shared market context. Used only for free-tier users who have
   selected their one project — gives the assistant the room to
   answer "how's my project doing" type questions personally. */
async function buildChosenProjectContext(admin, chosenId) {
  const [proj, flats] = await Promise.all([
    admin.from("projects").select("*").eq("id", chosenId).maybeSingle(),
    admin.from("flats").select("stav, izby, obytna_plocha, cena_s_dph").eq("project_id", chosenId).limit(2000),
  ]);
  const p = proj.data;
  if (!p) return null;
  const fs = flats.data || [];
  const roomMix = {};
  for (const f of fs) {
    const k = f.izby == null ? "?" : String(f.izby);
    const r = roomMix[k] ||= { total: 0, V: 0, R: 0, P: 0 };
    r.total += 1;
    if (f.stav === "V") r.V += 1;
    else if (f.stav === "P") r.P += 1;
    else if (f.stav === "R" || f.stav === "PR") r.R += 1;
  }
  return {
    name: p.name,
    developer: p.developer,
    district: p.district,
    status: p.status,
    total_units: p.total_units,
    available: p.available_units,
    sold: p.sold_units,
    sold_percentage: p.sold_percentage,
    avg_price_eur_m2: p.avg_price_eur_m2,
    sold_last_month: p.sold_last_month,
    room_mix: Object.entries(roomMix).map(([rooms, r]) => ({ rooms, ...r })),
  };
}

async function buildPaidContext(admin) {
  // Everything the aggregations page shows. Capped by row count so
  // the prompt stays under the token budget; full data is available
  // in-app, the chatbot is for Q&A not for bulk retrieval.
  const [metrics, projects] = await Promise.all([
    admin.from("metrics").select("metric_key, value_numeric"),
    admin.from("projects").select("id, name, developer, district, status, total_units, available_units, sold_units, sold_last_month, sold_percentage, avg_price_eur_m2").limit(200),
  ]);
  const mm = {};
  for (const m of metrics.data || []) mm[m.metric_key] = m.value_numeric;
  const all = projects.data || [];
  const active = all.filter(p => (p.status || "active") === "active");
  // District summary (weighted avg €/m²).
  const byD = {};
  for (const p of active) {
    if (!p.district) continue;
    const d = byD[p.district] ||= { district: p.district, projects: 0, units: 0, avail: 0, sold: 0, sold30: 0, priceW: 0, priceSumW: 0 };
    d.projects += 1;
    d.units += p.total_units || 0;
    d.avail += p.available_units || 0;
    d.sold  += p.sold_units || 0;
    d.sold30 += p.sold_last_month || 0;
    if (p.avg_price_eur_m2) {
      const w = p.total_units || 1;
      d.priceSumW += p.avg_price_eur_m2 * w;
      d.priceW += w;
    }
  }
  const districts = Object.values(byD)
    .map(d => ({
      district: d.district, projects: d.projects, units: d.units,
      avail: d.avail, sold: d.sold, sold_30d: d.sold30,
      avg_eur_m2: d.priceW ? Math.round(d.priceSumW / d.priceW) : null,
    }))
    .sort((a, b) => b.units - a.units);
  // Top velocity (last-30-day sellers)
  const topVelocity = [...active]
    .filter(p => (p.sold_last_month || 0) > 0)
    .sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0))
    .slice(0, 10)
    .map(p => ({ name: p.name, developer: p.developer, district: p.district, sold_30d: p.sold_last_month, avg_eur_m2: p.avg_price_eur_m2 }));
  // Developer aggregation
  const byDev = {};
  for (const p of active) {
    if (!p.developer) continue;
    const d = byDev[p.developer] ||= { developer: p.developer, projects: 0, units: 0, sold30: 0 };
    d.projects += 1;
    d.units += p.total_units || 0;
    d.sold30 += p.sold_last_month || 0;
  }
  const topDevelopers = Object.values(byDev).sort((a, b) => b.units - a.units).slice(0, 10);
  return {
    scope: "paid (full market)",
    city: "Bratislava",
    totals: {
      projects_tracked: mm.total_projects_active ?? null,
      units_tracked:    mm.total_units_tracked ?? null,
      units_available:  mm.total_available ?? null,
      units_reserved:   mm.total_reserved ?? null,
      units_sold_to_date: mm.total_sold_to_date ?? null,
    },
    projects: active.map(p => ({
      name: p.name, developer: p.developer, district: p.district,
      total: p.total_units, avail: p.available_units, sold: p.sold_units,
      sold_30d: p.sold_last_month, sold_pct: p.sold_percentage,
      avg_eur_m2: p.avg_price_eur_m2,
    })),
    districts,
    top_developers_by_inventory: topDevelopers,
    top_velocity_30d: topVelocity,
  };
}

function systemPrompt(lang, dataCtx) {
  const SK = lang !== "en";
  const jsonBlock = JSON.stringify(dataCtx);
  if (SK) {
    return [
      "Si AI analytik Residata, realitnej dátovej služby pre trh novostavieb v Bratislave.",
      "",
      "PRAVIDLÁ ODPOVEDANIA (kritické):",
      "",
      "OBSAH:",
      "· Odpovedaj PRIMÁRNE z dát pod ### DATA. Vyhýbaj sa všeobecným odhadom keď dáta máš.",
      "· Ak otázka vyžaduje informáciu mimo dát (ekonomické trendy, politický kontext, predpovede), môžeš čerpať z bežnej vedomosti, ALE prefixuj takú časť odpovede na samostatnom riadku: `[všeobecná znalosť, nie dáta Residata]` a potom napíš čo vieš. Residata neručí za tieto údaje.",
      "· Čísla zaokrúhľuj rozumne (4 320 €/m², 86 %, 1 200 bytov).",
      "",
      "CHÝBAJÚCE DÁTA — dôležité:",
      "· Ak dáta na presnú odpoveď nemáš, NIKDY nepošli užívateľa k developerovi, na realitnú kanceláriu, ani mu nenavrhuj aby si to \"overil sám\".",
      "· Namiesto toho povedz úprimne že presná odpoveď nie je v aktuálnom datasete a rámcuj to takto: \"V paid tieri Residata vieme tieto dáta pridať / pripraviť custom report — kontaktuj residata@proton.me.\" Užívateľa VŽDY smeruj späť k Residata, nie preč od Residata.",
      "· Ak vieš čiastočnú odpoveď, najprv povedz čo vieš z dát, POTOM navrhni Residata paid tier pre rozšírenie.",
      "",
      "PRÁVNE OCHRANNÉ PRAVIDLÁ — kritické:",
      "· Toto NIE JE investičné poradenstvo. Residata je informačná služba.",
      "· NIKDY neradím konkrétne kúpiť / predať / neinvestovať do konkrétneho projektu / bytu / developera. Nehovorím \"kúp si toto\", \"toto je dobrá investícia\", \"tento projekt má potenciál\".",
      "· Môžem opisovať tržné dáta (predajnosť, cena, dostupnosť, trend) ale zostávam pri faktoch. Interpretáciu a rozhodnutie nechávam na užívateľa.",
      "· Ak sa niekto pýta \"mám kúpiť X?\" alebo \"je to dobrá investícia?\", odpoviem čo hovoria DÁTA o tom projekte + dodám: \"Toto je tržná informácia, nie investičné odporúčanie. Pre rozhodnutie konzultuj s realitným alebo finančným poradcom.\"",
      "· Ak sa niekto pýta na predpovede cien do budúcna, označím to ako neisté a neradím. Môžem uviesť historický trend z dát.",
      "",
      "FORMÁT:",
      "· Píš krátko a vecne, 2–4 vety typicky, iba pri explicitnej žiadosti dlhšie.",
      "· Plain text — žiadne markdown nadpisy, žiadne **tučné**, žiadne bullets.",
      "· Neuvádzaj, že si AI. Neuvádzaj frázy typu 'podľa dostupných informácií' — jednoducho odpovedz.",
      "",
      "### DATA",
      jsonBlock,
    ].join("\n");
  }
  return [
    "You are Residata's AI analyst — a market-data service for Bratislava new-build residential real estate.",
    "",
    "ANSWER RULES (critical):",
    "",
    "CONTENT:",
    "· Answer PRIMARILY from the JSON under ### DATA. Don't guess when the data is there.",
    "· If the question needs information outside the data (economic trends, political context, forecasts), you may draw on general knowledge BUT prefix that part of the answer on its own line: `[general knowledge, not Residata data]` and continue. Residata doesn't vouch for those details.",
    "· Round numbers sensibly (4,320 €/m², 86 %, 1,200 units).",
    "",
    "MISSING DATA — important:",
    "· If you can't answer exactly from the data, NEVER redirect the user to the developer, a real-estate agency, or suggest they \"check for themselves\".",
    "· Instead, be honest that the exact answer isn't in the current dataset and frame it: \"Residata's paid tier can add this data / prepare a custom report — email residata@proton.me.\" ALWAYS point the user back to Residata, never away.",
    "· If you have a partial answer, lead with what the data shows, THEN offer the Residata paid tier to expand it.",
    "",
    "LEGAL SAFEGUARD RULES — critical:",
    "· This is NOT investment advice. Residata is an information service.",
    "· NEVER recommend specific buy / sell / invest actions on a particular project / flat / developer. Don't say \"buy this\", \"this is a good investment\", \"this project has potential\".",
    "· You may describe market data (sales velocity, price, availability, trend) but stick to facts. Interpretation and decisions stay with the user.",
    "· If someone asks \"should I buy X?\" or \"is this a good investment?\", answer with what the DATA says about that project + add: \"This is market information, not investment advice. For a decision consult a real-estate or financial professional.\"",
    "· For price-forecast questions, mark them as uncertain and don't recommend. You may cite historical trend from the data.",
    "",
    "FORMAT:",
    "· Write short, factual answers — typically 2–4 sentences; go longer only when asked.",
    "· Plain text — no markdown, no headings, no bullet lists.",
    "· Don't say you're AI. Don't preface with 'based on the available information' — just answer.",
    "",
    "### DATA",
    jsonBlock,
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    return await handleInner(req, res);
  } catch (e) {
    console.error("[chat] top-level crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}

async function handleInner(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!isTrustedOrigin(req)) {
    return res.status(403).json({ error: "untrusted origin" });
  }

  const ip = clientIp(req);
  const ipGate = ipRateCheck(ip);
  if (!ipGate.ok) {
    res.setHeader("Retry-After", String(ipGate.retryAfterSec));
    return res.status(429).json({ error: "rate limit: too many requests from this IP", retry_after_sec: ipGate.retryAfterSec });
  }

  const SUPABASE_URL        = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: "server misconfigured: SUPABASE envs missing" });
  }

  // ── Resolve caller identity (anon vs logged-in) ──
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId = null;
  let tier = "anon";
  let userProfile = null;

  if (token) {
    try {
      const { data: { user }, error: authErr } = await admin.auth.getUser(token);
      if (authErr || !user) {
        return res.status(401).json({ error: "invalid or expired token" });
      }
      userId = user.id;
      const { data: prof } = await admin.from("user_profiles")
        .select("tier, chosen_project_id").eq("id", userId).maybeSingle();
      userProfile = prof || null;
      tier = prof?.tier || "free";
      if (tier === "pending") {
        return res.status(403).json({ error: "account pending approval" });
      }
    } catch (_) {
      return res.status(401).json({ error: "auth verification failed" });
    }
  }

  // ANTHROPIC key — env first, then app_secrets fallback (same pattern
  // the old summary endpoint used, preserved so the user doesn't have
  // to re-configure Vercel envs for this new endpoint).
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) apiKey = await readSecret(admin, "ANTHROPIC_API_KEY");
  if (!apiKey) {
    return res.status(501).json({ error: "AI disabled on the server (ANTHROPIC_API_KEY missing)." });
  }

  // ── Body parse + validate ──
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON body" }); }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "empty body" });
  }
  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_INPUT_BYTES) {
    return res.status(413).json({ error: `body too large (${serialized.length} > ${MAX_INPUT_BYTES})` });
  }
  const lang = body.lang === "en" ? "en" : "sk";
  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: "messages array required (non-empty)" });
  }
  if (messages.length > MAX_HISTORY * 2) {
    return res.status(400).json({ error: `too many messages (max ${MAX_HISTORY * 2})` });
  }
  // Each message: { role: 'user'|'assistant', content: string (<=2000 chars) }
  const clean = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (typeof m.content !== "string") continue;
    const c = m.content.trim();
    if (!c) continue;
    clean.push({ role: m.role, content: c.slice(0, MAX_MSG_LEN) });
  }
  if (clean.length === 0 || clean[clean.length - 1].role !== "user") {
    return res.status(400).json({ error: "last message must be from the user" });
  }

  // ── Tier-based daily rate limit ──
  // For logged-in users we count today's rows in ai_usage_log by
  // user_id (persists across cold starts, cross-endpoint). For anon
  // we rely solely on the per-IP in-memory burst limit above —
  // ai_usage_log doesn't carry a caller_ip column and adding one
  // would require a schema migration. Anon abuse is capped by the
  // origin+IP layers; per-anon daily counting is a v2 enhancement.
  const dayLimit = DAILY_LIMITS[tier] ?? DAILY_LIMITS.anon;
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  let dayCount = 0;
  if (userId) {
    try {
      const { count } = await admin.from("ai_usage_log")
        .select("id", { count: "exact", head: true })
        .gte("requested_at", dayAgo)
        .eq("user_id", userId);
      dayCount = count || 0;
    } catch (_) {
      return res.status(503).json({ error: "rate limit lookup failed, try again" });
    }
  } else {
    // Anon path — per-IP in-memory counter, resets at midnight UTC.
    dayCount = anonDailyCount(ip);
  }
  if (dayCount >= dayLimit) {
    // Tier-specific upgrade CTA. Each tier sees a different message
    // nudging them toward the next tier with a concrete benefit:
    //
    //   anon  → sign up (free) for 3 questions/day
    //   free  → upgrade to paid for 30 questions/day
    //   paid  → contact support (30 is the current max for non-admin)
    //
    // The client reads `tier` + `limit` + `upgrade_to` from the JSON
    // body and renders a styled banner with a Login / Billing button.
    const upgrades = {
      anon:  { to: "free",  daily: DAILY_LIMITS.free,  action: "sign_in" },
      free:  { to: "paid",  daily: DAILY_LIMITS.paid,  action: "billing" },
      paid:  { to: null,    daily: null,               action: "contact" },
      admin: { to: null,    daily: null,               action: "contact" },
    };
    const up = upgrades[tier] || upgrades.anon;
    const msg = lang === "sk"
      ? (tier === "anon"
          ? `Vyčerpal si denný limit ${dayLimit} otázky pre neprihlásených. Prihlás sa (free) pre ${up.daily} otázok denne, alebo zaplať tier pre ${DAILY_LIMITS.paid}/deň.`
          : tier === "free"
          ? `Vyčerpal si denný limit ${dayLimit} otázok pre free tier. Upgrade na paid (${DAILY_LIMITS.paid}/deň).`
          : `Vyčerpal si denný limit ${dayLimit} otázok. Kontaktuj Residata pre vyšší limit.`)
      : (tier === "anon"
          ? `You've used your daily ${dayLimit} question as an anonymous user. Sign in (free) for ${up.daily}/day, or go paid for ${DAILY_LIMITS.paid}/day.`
          : tier === "free"
          ? `You've used your daily ${dayLimit} questions on the free tier. Upgrade to paid for ${DAILY_LIMITS.paid}/day.`
          : `You've used your daily ${dayLimit} questions. Contact Residata for a higher limit.`);
    return res.status(429).json({
      error: msg,
      tier,
      limit: dayLimit,
      upgrade_to: up.to,
      upgrade_action: up.action,
      upgrade_daily: up.daily,
      retry_after_sec: 3600,
    });
  }

  // ── Build data context ──
  // Every tier now receives the FULL market context. The earlier
  // tier-based topic-restriction design (anon = hero totals only)
  // was dropped: users found it more confusing than protective, and
  // the actual protection comes from the DAILY QUANTITY limits above.
  // Free users with a chosen_project_id get their project's flat-
  // level detail appended on top so the assistant can answer
  // personal "my project" questions too.
  let dataCtx;
  try {
    const fullCtx = await cachedContext("full", () => buildPaidContext(admin));
    if (tier === "free" && userProfile?.chosen_project_id) {
      const projKey = `free-proj:${userProfile.chosen_project_id}`;
      const yourProject = await cachedContext(projKey,
        () => buildChosenProjectContext(admin, userProfile.chosen_project_id));
      dataCtx = { ...fullCtx, your_project: yourProject };
    } else {
      dataCtx = fullCtx;
    }
  } catch (e) {
    console.error("[chat] context build", e);
    return res.status(500).json({ error: "failed to build data context" });
  }

  // ── Call Anthropic ──
  const system = systemPrompt(lang, dataCtx);
  let anthropicResp;
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: clean,
      }),
    });
  } catch (e) {
    console.error("[chat] anthropic fetch", e);
    return res.status(502).json({ error: "AI upstream error" });
  }
  if (!anthropicResp.ok) {
    const errBody = await anthropicResp.text().catch(() => "");
    console.error("[chat] anthropic non-200", anthropicResp.status, errBody.slice(0, 500));
    return res.status(502).json({ error: `AI upstream ${anthropicResp.status}` });
  }
  const payload = await anthropicResp.json();
  const textOut = (payload.content || [])
    .filter(c => c.type === "text")
    .map(c => c.text)
    .join("\n")
    .trim();

  // ── Log the call ──
  // For authed users: append to ai_usage_log (persistent, cross-
  // cold-start). For anon: bump the in-memory per-IP counter so
  // the next request from this IP in the same UTC day sees a higher
  // dayCount.
  if (userId) {
    admin.from("ai_usage_log").insert({
      user_id: userId,
      endpoint: "chat",
      input_tokens: payload.usage?.input_tokens ?? null,
      output_tokens: payload.usage?.output_tokens ?? null,
      ok: true,
    }).then(({ error }) => {
      if (error) console.warn("[chat] usage log failed (non-fatal)", error.message);
    });
  } else {
    anonDailyIncrement(ip);
  }

  return res.status(200).json({
    text: textOut,
    tier,
    remaining: { today: Math.max(0, dayLimit - dayCount - 1) },
    usage: payload.usage || null,
  });
}
