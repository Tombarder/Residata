// Vercel serverless endpoint: /api/ai/summary
//
// Generates a Slovak (or English) executive summary from a report
// context passed by the client. Uses the Anthropic Messages API —
// the client never sees the key.
//
// Request body:
//   { context: {...}, lang: "sk" | "en" }
//
// Auth:
//   · Caller sends their Supabase session access-token as Authorization:
//     Bearer <token>. Endpoint validates via auth.getUser().
//   · No token → anonymous call, rate-limited more aggressively.
//
// Rate limits (per user, rolling windows):
//   · Authenticated paid/admin:    30 / hour,  200 / day
//   · Authenticated free:           5 / hour,   20 / day
//   · Anonymous (no token):         3 / hour,   10 / day  (per-IP)
//
// Responses:
//   200 { text, model, usage }
//   401 { error: "auth required" } (when caller sends malformed token)
//   429 { error: "rate limit", retry_after_sec }
//   501 { error: "AI disabled — ANTHROPIC_API_KEY missing" }
//   4xx/5xx { error: "..." }
//
// Security notes:
//   · Input bounded at 16 KB JSON.
//   · Output capped at 900 tokens.
//   · No PII in `context` — aggregates only (enforced by client shape,
//     not by the server — don't ingest untrusted extra fields).

import { createClient } from "@supabase/supabase-js";

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS      = 900;
const MAX_INPUT_BYTES = 16 * 1024;

// Rate-limit windows (milliseconds)
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

// [per-hour, per-day] caps by tier
const LIMITS = {
  paid:  [30, 200],
  admin: [60, 500],
  free:  [ 5,  20],
  anon:  [ 3,  10],
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  // Resolve ANTHROPIC_API_KEY — env var wins; otherwise fall back to
  // the app_secrets table in Supabase (populated by the agent so the
  // user didn't have to copy-paste into Vercel envs manually).
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    apiKey = await readSecret("ANTHROPIC_API_KEY");
  }
  if (!apiKey) {
    return res.status(501).json({
      error: "AI disabled on the server (ANTHROPIC_API_KEY missing).",
    });
  }

  // ── Body read + validate ──
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

  // ── Auth + tier detection ──
  const SUPABASE_URL        = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  // If Supabase envs are missing, auth is disabled entirely — every call
  // is treated as "anon". That's a degraded mode for local dev; in prod
  // both envs are set (SUPABASE_URL is public, SECRET is server-only).
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  let userId = null, tier = "anon";

  if (SUPABASE_URL && SUPABASE_SECRET_KEY && token) {
    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: { user }, error: authErr } = await admin.auth.getUser(token);
      if (authErr || !user) {
        return res.status(401).json({ error: "invalid token" });
      }
      userId = user.id;
      // Fetch tier from user_profiles (table used elsewhere in the app)
      const { data: prof } = await admin
        .from("user_profiles")
        .select("tier")
        .eq("id", userId)
        .maybeSingle();
      tier = prof?.tier || "free";
    } catch (_) {
      tier = "free";   // token present but lookup failed — degrade safely
    }
  }

  // ── Rate limiting ──
  // When Supabase is configured we persist usage + check real counts.
  // Otherwise we fall back to an in-memory counter (useful for local dev;
  // doesn't survive cold starts, but the limit is generous there anyway).
  const [perHour, perDay] = LIMITS[tier] || LIMITS.anon;
  let admin = null;
  if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Count the user's (or for anon: all anon's) calls in the last hour and day
    const hourAgo = new Date(Date.now() - HOUR_MS).toISOString();
    const dayAgo  = new Date(Date.now() - DAY_MS).toISOString();
    let hourCount = 0, dayCount = 0;
    try {
      const qH = admin.from("ai_usage_log").select("id", { count: "exact", head: true })
        .gte("requested_at", hourAgo);
      const qD = admin.from("ai_usage_log").select("id", { count: "exact", head: true })
        .gte("requested_at", dayAgo);
      if (userId) { qH.eq("user_id", userId); qD.eq("user_id", userId); }
      else        { qH.is("user_id", null);   qD.is("user_id", null); }
      const [h, d] = await Promise.all([qH, qD]);
      hourCount = h.count || 0;
      dayCount  = d.count || 0;
    } catch (_) { /* fail open on count-query error */ }

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
