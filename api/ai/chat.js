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

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS      = 500;
const MAX_INPUT_BYTES = 24 * 1024;
const MAX_HISTORY     = 10;
const MAX_MSG_LEN     = 2000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

// Per-day caps by tier. `pending` refused earlier in the flow; `anon`
// applies when no Authorization header was sent.
const DAILY_LIMITS = {
  anon:  3,
  free:  10,
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

// In-memory per-IP rate limit (10 requests/min). Resets on cold start
// but that's fine — it's a bursty-abuse absorber, the tier-based DB
// counter is the persistent authority.
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

// ────────────────────────────────────────────────────────────────
// Tier-aware data context builders.
// Each function returns a structured JSON of Residata data scoped
// to what the caller is allowed to see. The JSON gets serialised
// into the system prompt so Claude answers from it. Anything not
// in the returned object is invisible to the LLM — no amount of
// prompt-jailbreaking can reveal paid-tier data to an anon caller.
// ────────────────────────────────────────────────────────────────

async function buildAnonContext(admin) {
  // Hero metrics + a few high-level district benchmarks. No per-
  // project detail, no flat-level data, no velocity breakdowns.
  const [metrics, topDistricts] = await Promise.all([
    admin.from("metrics").select("metric_key, value_numeric").in(
      "metric_key",
      ["total_units_tracked", "total_available", "total_reserved",
       "total_sold_to_date", "total_projects_active"]
    ),
    admin.from("projects").select("district, avg_price_eur_m2, total_units")
      .not("avg_price_eur_m2", "is", null).limit(200),
  ]);
  const mm = {};
  for (const m of metrics.data || []) mm[m.metric_key] = m.value_numeric;
  // Aggregate to top-5 districts by weighted €/m². Kept intentionally
  // coarse: anon users get market-wide orientation, no project names.
  const byD = {};
  for (const p of topDistricts.data || []) {
    if (!p.district) continue;
    const d = byD[p.district] ||= { district: p.district, sumP: 0, sumW: 0, n: 0 };
    const w = p.total_units || 1;
    d.sumP += p.avg_price_eur_m2 * w;
    d.sumW += w;
    d.n += 1;
  }
  const districts = Object.values(byD)
    .map(d => ({ district: d.district, avg_eur_m2: Math.round(d.sumP / d.sumW), projects: d.n }))
    .sort((a, b) => b.avg_eur_m2 - a.avg_eur_m2)
    .slice(0, 5);
  return {
    scope: "anon (market overview only)",
    city: "Bratislava",
    totals: {
      projects_tracked: mm.total_projects_active ?? null,
      units_tracked:    mm.total_units_tracked ?? null,
      units_available:  mm.total_available ?? null,
      units_reserved:   mm.total_reserved ?? null,
      units_sold_to_date: mm.total_sold_to_date ?? null,
    },
    top_districts_by_price: districts,
    data_restrictions: "Per-project detail, unit-level data, developer comparisons and sell-through velocity are reserved for Residata paid subscribers. Answer general questions from the totals above and decline specific per-project questions politely.",
  };
}

async function buildFreeContext(admin, userProfile) {
  // Anon context + user's chosen project detail (if any).
  const anon = await buildAnonContext(admin);
  const chosenId = userProfile?.chosen_project_id || null;
  if (!chosenId) {
    return { ...anon, your_project: null,
      data_restrictions: anon.data_restrictions + " This user is on the free tier and hasn't picked their one free-tier project yet — suggest they pick one on /app/projects if they ask about per-project detail." };
  }
  const [proj, flats] = await Promise.all([
    admin.from("projects").select("*").eq("id", chosenId).maybeSingle(),
    admin.from("flats").select("stav, izby, obytna_plocha, cena_s_dph").eq("project_id", chosenId).limit(2000),
  ]);
  const p = proj.data;
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
    ...anon,
    your_project: p ? {
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
    } : null,
    data_restrictions: "Answer questions about totals + the user's own project only. Do NOT reveal details of other projects, developer-to-developer comparisons, or velocity of projects the user hasn't selected. If asked, say it's available on the paid tier.",
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
      "· Odpovedaj PRIMÁRNE z dát pod ### DATA. Vyhýbaj sa všeobecným odhadom keď dáta máš.",
      "· Ak otázka vyžaduje informáciu mimo dát (napr. ekonomické trendy, politický kontext, predpovede do budúcna), môžeš čerpať z bežnej vedomosti, ALE prefixuj takú časť odpovede na samostatnom riadku: `[všeobecná znalosť, nie dáta Residata]` a potom napíš čo vieš. Residata neručí za tieto údaje.",
      "· Ak sa ťa niekto pýta na niečo čo nie je v dátach A ani to nie je všeobecne známe, povedz úprimne že to vieme priniesť v platenej verzii, alebo že pre presnú odpoveď treba kontaktovať Residata.",
      "· Čísla zaokrúhľuj rozumne (4 320 €/m², 86 %, 1 200 bytov).",
      "· Píš krátko a vecne, 2-4 vety typicky, iba pri explicitnej žiadosti dlhšie.",
      "· Formátuj ako plain text — žiadne markdown nadpisy, žiadne **tučné**, žiadne bullets. Len čisté vety.",
      "· Neuvádzaj, že si AI. Neuvádzaj „podľa dostupných informácií" — jednoducho odpovedz.",
      "",
      "### DATA",
      jsonBlock,
    ].join("\n");
  }
  return [
    "You are Residata's AI analyst — a market-data service for Bratislava new-build residential real estate.",
    "",
    "ANSWER RULES (critical):",
    "· Answer PRIMARILY from the JSON under ### DATA. Don't guess when the data is there.",
    "· If the question needs information outside the data (economic trends, political context, forecasts), you may draw on general knowledge BUT prefix that part of the answer on its own line: `[general knowledge, not Residata data]` and continue. Residata doesn't vouch for those details.",
    "· If neither the data nor general knowledge covers the question, say so — we can add it in the paid tier, or the user should email Residata.",
    "· Round numbers sensibly (4,320 €/m², 86 %, 1,200 units).",
    "· Write short, factual answers — typically 2-4 sentences; go longer only when asked.",
    "· Plain text output — no markdown, no headings, no bullet lists. Just sentences.",
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

  // ANTHROPIC key check before body read so we fail fast.
  const apiKey = process.env.ANTHROPIC_API_KEY;
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
  const dayLimit = DAILY_LIMITS[tier] ?? DAILY_LIMITS.anon;
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  let dayCount = 0;
  try {
    // Count today's calls: by user_id if logged in, by IP if anon.
    const idCol = userId ? "user_id" : "caller_ip";
    const idVal = userId || ip;
    const { count } = await admin.from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .gte("requested_at", dayAgo)
      .eq(idCol, idVal);
    dayCount = count || 0;
  } catch (_) {
    // Fail closed — don't spend credit if we can't count.
    return res.status(503).json({ error: "rate limit lookup failed, try again" });
  }
  if (dayCount >= dayLimit) {
    const msg = tier === "anon"
      ? (lang === "sk"
          ? `Dosiahli ste denný limit ${dayLimit} otázok ako neprihlásený užívateľ. Prihláste sa pre viac.`
          : `You've reached the daily limit of ${dayLimit} questions for anonymous users. Sign in for more.`)
      : (lang === "sk"
          ? `Dosiahli ste denný limit ${dayLimit} otázok pre tier ${tier}.`
          : `You've reached the daily limit of ${dayLimit} questions for tier ${tier}.`);
    return res.status(429).json({ error: msg, tier, limit: dayLimit, retry_after_sec: 3600 });
  }

  // ── Build tier-appropriate data context ──
  let dataCtx;
  try {
    if (tier === "anon")         dataCtx = await buildAnonContext(admin);
    else if (tier === "free")    dataCtx = await buildFreeContext(admin, userProfile);
    else /* paid / admin */      dataCtx = await buildPaidContext(admin);
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

  // ── Log the call (best-effort — never blocks the response) ──
  admin.from("ai_usage_log").insert({
    user_id: userId,
    caller_ip: userId ? null : ip,
    tier,
    requested_at: new Date().toISOString(),
    model: ANTHROPIC_MODEL,
    input_tokens: payload.usage?.input_tokens ?? null,
    output_tokens: payload.usage?.output_tokens ?? null,
    endpoint: "chat",
  }).then(({ error }) => {
    if (error) console.warn("[chat] usage log failed (non-fatal)", error.message);
  });

  return res.status(200).json({
    text: textOut,
    tier,
    remaining: { today: Math.max(0, dayLimit - dayCount - 1) },
    usage: payload.usage || null,
  });
}
