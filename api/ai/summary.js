// Vercel serverless endpoint: /api/ai/summary
//
// Generates a Slovak (or English) executive summary from a report
// context. Hits Anthropic Messages API — this is our main paid-API
// cost exposure, so it's hardened accordingly.
//
// Request body:
//   { context: {...}, lang: "sk" | "en" }
//
// === Cost-abuse protection layers (defence in depth) ===
//
// 1. **Authenticated callers only** — no anon tier.
//    Previous anon-allowed design meant random internet traffic could
//    burn up to 10 Anthropic calls/day. Changed to require a valid
//    Supabase session. Forces abusers to create an account (rate
//    limited by email domain validation) before spending any credit.
//
// 2. **Server-side Origin / Referer check** — CORS is browser-only.
//    Curl, Postman, server-side scripts bypass CORS entirely. We also
//    check Origin + Referer headers on the server and reject calls
//    that don't claim to come from an allowed origin.
//
// 3. **Per-IP rate limit** (10 req/min, in-memory) — absorbs bursts
//    before they hit the DB counter or burn credit.
//
// 4. **Tier-based DB counter** (rolling hour + day windows) —
//    paid=30h/200d, free=5h/20d, admin=60h/500d. Persists across
//    serverless cold starts via ai_usage_log table.
//
// 5. **Bounded input** — 16 KB JSON. Bounded output — 900 tokens.
//    Worst-case single call cost ≈ $0.025.
//
// 6. **Monthly hard cap on Anthropic side** — MUST be configured in
//    the Anthropic dashboard (Usage Limits → Monthly Spend Cap).
//    Set to $50-100/month as a last-resort backstop. Documented in
//    docs/SECURITY.md.
//
// === Responses ===
//   200 { text, model, usage }
//   401 { error: "authentication required" } — no or invalid token
//   403 { error: "untrusted origin" } — Origin/Referer check failed
//   429 { error: "rate limit: ...", retry_after_sec }
//   501 { error: "AI disabled — ANTHROPIC_API_KEY missing" }

import { createClient } from "@supabase/supabase-js";

// Allow the Anthropic round-trip to take longer than Vercel's default
// 10s timeout on the Hobby plan. 30s is a safe ceiling for 900-token
// generations on claude-sonnet-4-5; Pro/Enterprise plans cap at 60s
// but 30s is plenty. Configuration is honoured by Vercel at deploy.
export const maxDuration = 30;

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS      = 900;
const MAX_INPUT_BYTES = 16 * 1024;

// Rate-limit windows (milliseconds)
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

// [per-hour, per-day] caps by tier. anon is intentionally absent —
// the endpoint now requires a valid session.
const LIMITS = {
  paid:  [30, 200],
  admin: [60, 500],
  free:  [ 5,  20],
};

// Origin check — allowlist for server-side verification. Distinct from
// CORS which is browser-enforced; this catches curl/Postman/bot calls
// that don't care about CORS.
const TRUSTED_ORIGINS = [
  "https://residata-gamma.vercel.app",
  "https://residata.sk",
  "https://www.residata.sk",
  "http://localhost:5173",
  "http://localhost:3000",
];

function isTrustedOrigin(req) {
  const origin = req.headers?.origin;
  const referer = req.headers?.referer || "";
  if (origin && TRUSTED_ORIGINS.includes(origin)) return true;
  // Some browsers omit Origin on same-site requests; fall back to Referer prefix
  if (referer && TRUSTED_ORIGINS.some(o => referer.startsWith(o + "/"))) return true;
  return false;
}

// Allowed origins for CORS. Anything else gets no Access-Control-Allow-Origin
// header and the browser blocks the request at the preflight stage.
// Add domains here if/when a custom domain is introduced.
const ALLOWED_ORIGINS = new Set([
  "https://residata-gamma.vercel.app",
  "https://residata.sk",
  "https://www.residata.sk",
  "http://localhost:5173",  // Vite dev
  "http://localhost:3000",  // alt dev
]);

/**
 * In-memory per-IP rate limiter for anon callers. Belt-and-suspenders
 * layer on top of the ai_usage_log tier limits — stops a burst attack
 * before it even hits the DB counter. Ephemeral (cold-start loses it),
 * which is fine: it's a speed bump, not a fortress.
 * Window: 1 minute. Cap: 10 anon calls/min per IP.
 */
const IP_BUCKET = new Map(); // ip → { count, resetAt }
const IP_WINDOW_MS = 60 * 1000;
const IP_CAP = 10;

function ipRateCheck(ip) {
  if (!ip) return { ok: true };
  const now = Date.now();
  const bucket = IP_BUCKET.get(ip);
  if (!bucket || bucket.resetAt < now) {
    IP_BUCKET.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    // Best-effort prune — keep the map from growing unbounded during
    // a long-lived function instance.
    if (IP_BUCKET.size > 1000) {
      for (const [k, v] of IP_BUCKET) {
        if (v.resetAt < now) IP_BUCKET.delete(k);
      }
    }
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > IP_CAP) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  return { ok: true };
}

function clientIp(req) {
  const h = req.headers || {};
  const fwd = h["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return h["x-real-ip"] || req.socket?.remoteAddress || null;
}

function applyCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  // If origin isn't allowed we simply omit the ACAO header — the
  // browser enforces same-origin and blocks the call client-side.
  // (This is safer than echoing the request origin back, which
  // effectively means "allow everything".)
}

export default async function handler(req, res) {
  // CORS preflight
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  // ── Server-side Origin / Referer gate ──
  // CORS alone is not enough — it's enforced by browsers, not servers.
  // Anyone using curl / Postman / a script bypasses CORS entirely and
  // hits the endpoint. We reject here if neither Origin nor Referer
  // claims one of our trusted domains. Note: Origin/Referer can be
  // spoofed by a determined attacker, so this is a speed bump, not a
  // fortress — it stops casual script-kiddie abuse cold, while auth
  // below is the actual gate.
  if (!isTrustedOrigin(req)) {
    return res.status(403).json({ error: "untrusted origin" });
  }

  // Per-IP rate limit (belt-and-suspenders; authenticated callers also
  // get tier limits below from the ai_usage_log counter).
  const ip = clientIp(req);
  const gate = ipRateCheck(ip);
  if (!gate.ok) {
    res.setHeader("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({
      error: "rate limit: too many requests from this IP",
      retry_after_sec: gate.retryAfterSec,
    });
  }

  // ── Auth check FIRST (before any other logic) ──
  // Order matters for cost protection: validate the caller before we
  // do anything else. A 400 leak on body shape is harmless on its own,
  // but rejecting unauthed callers immediately keeps the endpoint
  // opaque and stops attackers from probing internals.
  // Anon tier removed — the biggest cost-abuse vector.
  const SUPABASE_URL        = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: "server misconfigured: SUPABASE envs missing" });
  }
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "authentication required" });
  }

  let userId, tier;
  try {
    const authAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authErr } = await authAdmin.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: "invalid or expired token" });
    }
    userId = user.id;
    const { data: prof } = await authAdmin
      .from("user_profiles")
      .select("tier")
      .eq("id", userId)
      .maybeSingle();
    tier = prof?.tier || "free";
    if (tier === "pending") {
      return res.status(403).json({ error: "account pending approval" });
    }
  } catch (_) {
    return res.status(401).json({ error: "auth verification failed" });
  }

  // Resolve ANTHROPIC_API_KEY — env wins; app_secrets fallback.
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    apiKey = await readSecret("ANTHROPIC_API_KEY");
  }
  if (!apiKey) {
    return res.status(501).json({
      error: "AI disabled on the server (ANTHROPIC_API_KEY missing).",
    });
  }

  // ── Body read + validate (only after caller is authenticated) ──
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON body" }); }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "empty body" });
  }
  const { context, lang = "sk" } = body;
  if (!context || typeof context !== "object") {
    return res.status(400).json({ error: "missing context" });
  }
  const serialized = JSON.stringify(context);
  if (serialized.length > MAX_INPUT_BYTES) {
    return res.status(413).json({ error: `context too large (${serialized.length} bytes > ${MAX_INPUT_BYTES})` });
  }

  // ── Rate limiting (per-user, rolling hour + day) ──
  // Counters live in ai_usage_log so they persist across cold starts.
  const [perHour, perDay] = LIMITS[tier] || LIMITS.free;
  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const hourAgo = new Date(Date.now() - HOUR_MS).toISOString();
  const dayAgo  = new Date(Date.now() - DAY_MS).toISOString();
  let hourCount = 0, dayCount = 0;
  try {
    const [h, d] = await Promise.all([
      admin.from("ai_usage_log").select("id", { count: "exact", head: true })
        .gte("requested_at", hourAgo).eq("user_id", userId),
      admin.from("ai_usage_log").select("id", { count: "exact", head: true })
        .gte("requested_at", dayAgo).eq("user_id", userId),
    ]);
    hourCount = h.count || 0;
    dayCount  = d.count || 0;
  } catch (_) {
    // If the counter lookup fails, fail CLOSED (not open) — refusing
    // a call is cheaper than double-spending credit.
    return res.status(503).json({ error: "rate limit lookup failed, try again" });
  }

  if (hourCount >= perHour) {
    return res.status(429).json({
      error: `rate limit: ${perHour} AI calls / hour reached`,
      retry_after_sec: 60,
      tier,
    });
  }
  if (dayCount >= perDay) {
    return res.status(429).json({
      error: `rate limit: ${perDay} AI calls / day reached`,
      retry_after_sec: 3600,
      tier,
    });
  }

  // ── Prompt assembly ──
  const SK = lang !== "en";
  const system = SK
    ? `Si senior real-estate analytik Residata. Píšeš stručné, vecné executive-summary reporty v slovenčine pre klientov z developerskej a investičnej sféry.

PRAVIDLÁ FORMÁTOVANIA (kritické):
· Píš PLAIN TEXT, bez markdown. Žiadne #, ##, ###, žiadne **bold**, žiadne odrážky "- ", žiadne code-blocky.
· 3–5 krátkych odsekov oddelených prázdnym riadkom.
· Bez nadpisov — každý odsek začni priamo vecou.
· Bez zoznamov s odrážkami — ak potrebuješ zoznam, napíš ho ako súvislú vetu ("Top tri projekty: X, Y, Z.").

OBSAH:
· Opieraj sa iba o čísla, ktoré ti dám. Nehádaj. Keď niečo chýba, nepíš že to chýba — jednoducho to vynechaj.
· Čísla zaokrúhľuj (4 320 €/m², 86 %, 1 200 bytov).
· Keď porovnávaš, uvádzaj smer a veľkosť zmeny v percentách.
· Neuvádzaj, že si AI. Vyhýbaj sa klišé ("v dnešnej dobe", "dnes viac než kedykoľvek").`
    : `You are a senior real-estate analyst at Residata. Write concise, factual executive-summary reports in English for developer and investor clients.

FORMATTING RULES (critical):
· Write plain text. NO markdown. No #, **bold**, no bullet lists, no code blocks.
· 3–5 short paragraphs separated by blank lines.
· No headings.

CONTENT:
· Rely only on the numbers I provide. Don't guess or fabricate.
· Round numbers sensibly.
· Compare with direction and percentage.
· Don't reveal you are AI.`;

  const user = SK
    ? `Dáta (JSON):\n\n${serialized}\n\nNapíš exekutívne zhrnutie tohto scope-u (max 5 odsekov). Ak je scope "market", píš o trhu celkom. Ak scope je mesto / časť / developer / projekt, zameraj sa na to a porovnaj s benchmarkom ak je v dátach. Štruktúra:\n1) 1 veta o tom čo scope je a aká je veľkosť.\n2) Absorpcia + predaje (kde sme aktuálne, čo sa dialo).\n3) Ceny (úroveň, rozloženie, prípadný výkyv).\n4) Najväčší dríver/názor (tvoja jedna kľúčová observácia).\n5) 1 risk alebo 1 príležitosť pre developera/analyta. Neopakuj čísla z KPI riadka len kvôli forme — vyber 3–4 najdôležitejšie.`
    : `Data (JSON):\n\n${serialized}\n\nWrite an executive summary of this scope (max 5 paragraphs). If the scope is "market", cover the whole market. If it's city / district / developer / project, focus there and benchmark against the broader set when present. Structure: 1) one-line scope intro; 2) absorption + sales; 3) prices; 4) the main observation; 5) one risk or opportunity for a developer/analyst. Don't robotically repeat every KPI.`;

  // ── Call Anthropic ──
  let r;
  const startedAt = Date.now();
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:       ANTHROPIC_MODEL,
        max_tokens:  MAX_TOKENS,
        system,
        messages:    [{ role: "user", content: user }],
      }),
    });
  } catch (e) {
    await logUsage(admin, userId, context, null, false, `upstream call failed: ${e?.message || e}`);
    return res.status(502).json({ error: `upstream call failed: ${e?.message || e}` });
  }

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    await logUsage(admin, userId, context, null, false, `anthropic HTTP ${r.status}`);
    return res.status(r.status).json({ error: `anthropic HTTP ${r.status}: ${txt.slice(0, 500)}` });
  }

  const data = await r.json().catch(() => null);
  if (!data) {
    await logUsage(admin, userId, context, null, false, "invalid anthropic response");
    return res.status(502).json({ error: "invalid response from anthropic" });
  }

  const text = Array.isArray(data.content)
    ? data.content.filter(b => b.type === "text").map(b => b.text).join("\n\n")
    : "";
  if (!text) {
    await logUsage(admin, userId, context, data.usage, false, "empty AI response");
    return res.status(502).json({ error: "empty AI response" });
  }

  await logUsage(admin, userId, context, data.usage, true, null);

  return res.status(200).json({
    text,
    model: data.model,
    usage: data.usage,
    duration_ms: Date.now() - startedAt,
    tier,
  });
}

/* Read one secret from app_secrets. Returns null if Supabase isn't
   configured or the row doesn't exist. Service-role client bypasses
   RLS so the table stays locked down to other callers. */
async function readSecret(key) {
  const URL = process.env.SUPABASE_URL;
  const SK  = process.env.SUPABASE_SECRET_KEY;
  if (!URL || !SK) return null;
  try {
    const admin = createClient(URL, SK, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin
      .from("app_secrets")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) return null;
    return data?.value || null;
  } catch (_) { return null; }
}

/* Best-effort log insert. Never throws — a failed log shouldn't break
   the response. If admin client is null (local dev, no Supabase), skip. */
async function logUsage(admin, userId, context, usage, ok, error) {
  if (!admin) return;
  try {
    await admin.from("ai_usage_log").insert({
      user_id:        userId,
      endpoint:       "summary",
      scope:          context?.scope || null,
      scope_label:    context?.scopeLabel || null,
      input_tokens:   usage?.input_tokens || null,
      output_tokens:  usage?.output_tokens || null,
      ok, error,
    });
  } catch (_) { /* silent */ }
}
