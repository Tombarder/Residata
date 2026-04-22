// Vercel serverless endpoint: /api/ai/summary
//
// Generates a Slovak (or English) executive summary from a report
// context passed by the client. Uses the Anthropic Messages API —
// the client never sees the key.
//
// Request body:
//   { context: {...}, lang: "sk" | "en" }
//
// Response (200): { text: "…" }
// Response (501): "AI disabled — ANTHROPIC_API_KEY missing."
// Response (4xx/5xx): { error: "…" }
//
// Security notes:
//   · Only POST is accepted.
//   · Input is bounded — we reject oversize bodies (>16 KB of JSON) to
//     limit cost from malicious callers. That's plenty for one report.
//   · Output is capped at 900 tokens.
//   · No PII in `context` — it's aggregate numbers only.
//   · Anthropic key is read from env ONCE per request.

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS      = 900;
const MAX_INPUT_BYTES = 16 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error: "AI disabled on the server (ANTHROPIC_API_KEY missing).",
    });
  }

  // ── Read + validate body ──
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

  // ── Prompt assembly ──
  const SK = lang !== "en";
  const system = SK
    ? `Si senior real-estate analytik Residata. Píšeš stručné, vecné executive-summary reporty v slovenčine pre klientov z developerskej a investičnej sféry. Si kalkulovaný: opieraš sa iba o čísla, ktoré ti poskytnem. Nehádaš. Keď niečo chýba, nepredstieraj to. Neobetuješ jasnosť za marketingový jazyk. Formátuj ako 3–5 krátkych odsekov v prirodzenej slovenčine, bez zbytočných nadpisov. Nepoužívaj odrážky, ak nie je zoznam nutný. Vyhýbaj sa klišé ako "v dnešnej dobe". Neuvádzaj, že si AI. Čísla zaokrúhľuj (napr. 4 320 €/m², 86 %). Keď porovnávaš so širším trhom, uvádzaj smer (drahšie / lacnejšie / vyššia absorpcia) a veľkosť zmeny v percentách.`
    : `You are a senior real-estate analyst at Residata. Write concise, factual executive-summary reports in English for developer and investor clients. You are calibrated: rely only on the numbers I give you. Do not guess. If something is missing, don't fabricate. Do not sacrifice clarity for marketing language. Format as 3–5 short paragraphs in natural English. No bullet lists unless a list is truly needed. No clichés. Don't reveal you are AI. Round numbers sensibly.`;

  const user = SK
    ? `Dáta (JSON):\n\n${serialized}\n\nNapíš exekutívne zhrnutie tohto scope-u (max 5 odsekov). Ak je scope "market", píš o trhu celkom. Ak scope je mesto / časť / developer / projekt, zameraj sa na to a porovnaj s benchmarkom ak je v dátach. Štruktúra:\n1) 1 veta o tom čo scope je a aká je veľkosť.\n2) Absorpcia + predaje (kde sme aktuálne, čo sa dialo).\n3) Ceny (úroveň, rozloženie, prípadný výkyv).\n4) Najväčší dríver/názor (tvoja jedna kľúčová observácia).\n5) 1 risk alebo 1 príležitosť pre developera/analyta. Neopakuj čísla z KPI riadka len kvôli forme — vyber 3–4 najdôležitejšie.`
    : `Data (JSON):\n\n${serialized}\n\nWrite an executive summary of this scope (max 5 paragraphs). If the scope is "market", cover the whole market. If it's city / district / developer / project, focus there and benchmark against the broader set when present. Structure: 1) one-line scope intro; 2) absorption + sales; 3) prices; 4) the main observation; 5) one risk or opportunity for a developer/analyst. Don't robotically repeat every KPI.`;

  // ── Call Anthropic ──
  let r;
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
    return res.status(502).json({ error: `upstream call failed: ${e?.message || e}` });
  }

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    return res.status(r.status).json({ error: `anthropic HTTP ${r.status}: ${txt.slice(0, 500)}` });
  }

  const data = await r.json().catch(() => null);
  if (!data) return res.status(502).json({ error: "invalid response from anthropic" });

  // Messages API returns content as an array of blocks
  const text = Array.isArray(data.content)
    ? data.content.filter(b => b.type === "text").map(b => b.text).join("\n\n")
    : "";
  if (!text) return res.status(502).json({ error: "empty AI response" });

  return res.status(200).json({
    text,
    model: data.model,
    usage: data.usage,
  });
}
