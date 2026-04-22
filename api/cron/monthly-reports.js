// Vercel Cron endpoint: /api/cron/monthly-reports
//
// Fires on the 1st of each month at 08:00 UTC (configured in vercel.json).
// For every enabled entry in `report_subscriptions`, it:
//   1. Reads the relevant scope data from Supabase.
//   2. Builds an HTML report (same data shape as the in-app report).
//   3. Emails it to the subscriber's address via the existing Gmail SMTP.
//   4. Stamps `last_sent_at` so the admin can see delivery history.
//
// Auth: Vercel injects an `Authorization: Bearer <CRON_SECRET>` header when
// calling Cron endpoints if CRON_SECRET env is configured. We check it so
// the endpoint isn't callable by random POSTs. If CRON_SECRET isn't set,
// we fall back to verifying `x-vercel-cron: 1` which Vercel always adds
// on cron invocations (present since Jan 2024).
//
// Manual trigger: anyone with CRON_SECRET can POST to test. Without the
// secret + without the vercel header, the endpoint refuses.

import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_lib/emails.js";

// Gmail SMTP sends are sequential and can take ~2-5s each. With 20+
// subscribers plus the retention prune, default 10s timeout is tight.
// 60s covers roughly 20 sends before we'd need a queue.
export const maxDuration = 60;

const green = "#00e5a0";
const textLight = "#e8e8ed";
const textDim = "#8a8a96";
const orange = "#f5a623";

export default async function handler(req, res) {
  // ── Env (needed early so we can resolve secrets from app_secrets
  //    if they aren't in the Vercel env) ──
  const SUPABASE_URL        = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  const WEB_URL             = process.env.WEB_URL || "https://residata-gamma.vercel.app";
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: "SUPABASE envs missing" });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve secret with DB fallback
  const secretOrFallback = async (envKey) => {
    if (process.env[envKey]) return process.env[envKey];
    try {
      const { data } = await admin.from("app_secrets").select("value").eq("key", envKey).maybeSingle();
      return data?.value || null;
    } catch (_) { return null; }
  };

  // ── Auth ──
  const secret = await secretOrFallback("CRON_SECRET");
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  const tokenOk = secret && authHeader === `Bearer ${secret}`;
  if (!tokenOk && !isVercelCron) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // Matches the existing welcome-user webhook convention: GMAIL_FROM +
  // GMAIL_APP_PASSWORD, with a hard-coded default sender.
  const GMAIL_FROM         = (await secretOrFallback("GMAIL_FROM")) || "tkamhal@gmail.com";
  const GMAIL_APP_PASSWORD = await secretOrFallback("GMAIL_APP_PASSWORD");
  if (!GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: "GMAIL_APP_PASSWORD missing (neither Vercel env nor app_secrets row found)" });
  }

  // ── Load subscribers ──
  const { data: subs, error: subErr } = await admin
    .from("report_subscriptions")
    .select("*")
    .eq("enabled", true);
  if (subErr) return res.status(500).json({ error: `subs query: ${subErr.message}` });

  // ── Load project data once (shared across all subscriptions) ──
  const { data: projects, error: pErr } = await admin.from("projects").select("*");
  if (pErr) return res.status(500).json({ error: `projects query: ${pErr.message}` });

  const month = new Date().toLocaleDateString("sk-SK", { month: "long", year: "numeric" });
  const results = [];

  for (const sub of subs || []) {
    try {
      // Filter projects by scope
      const scoped = filterByScope(projects, sub.scope, sub.scope_label);
      const summary = summariseProjects(scoped);
      const html = renderReportEmailHtml({
        subscriberEmail: sub.email,
        month,
        scope: sub.scope,
        scopeLabel: sub.scope_label,
        summary,
        webUrl: WEB_URL,
        lang: sub.lang || "sk",
      });
      await sendEmail({
        to: sub.email,
        subject: `Residata · ${capitalize(month)} · ${sub.scope_label || scopeTitle(sub.scope, sub.lang)}`,
        html,
        from: GMAIL_FROM,
        gmailUser: GMAIL_FROM,
        gmailPassword: GMAIL_APP_PASSWORD,
      });
      await admin.from("report_subscriptions")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("user_id", sub.user_id);
      results.push({ email: sub.email, scope: sub.scope, ok: true });
    } catch (e) {
      results.push({ email: sub.email, scope: sub.scope, ok: false, error: String(e?.message || e) });
    }
  }

  // Prune old ai_usage_log rows (retention 90 days). Best-effort — a
  // prune failure shouldn't affect the email delivery report.
  // The SQL function is capped at 100k rows per call so we loop until
  // it returns 0 (or we hit the safety bound of 20 iterations = 2M
  // rows, which is waaay more than any realistic log volume).
  let pruned = 0;
  try {
    for (let i = 0; i < 20; i++) {
      const { data, error } = await admin.rpc("prune_ai_usage_log", { retention_days: 90 });
      if (error || !data || data === 0) break;
      pruned += data;
    }
  } catch (_) { /* ignore */ }

  return res.status(200).json({
    month,
    subscribers: subs?.length || 0,
    sent_ok:   results.filter(r => r.ok).length,
    sent_fail: results.filter(r => !r.ok).length,
    pruned_usage_rows: pruned,
    results,
  });
}

/* ─── Scope filter (mirrors Reports.jsx) ───
   Accepts both English and Slovak scope keys — the UI tab uses Slovak
   ("mesto","cast","projekt") but we also accept the English variants
   for backwards-compat + future API callers. */
function filterByScope(projects, scope, label) {
  const s = String(scope || "").toLowerCase();
  if (!s || s === "market" || s === "trh") return projects;
  if (s === "developer") return projects.filter(p => p.developer === label);
  if (s === "district" || s === "cast" || s === "cast mesta")
    return projects.filter(p => p.district === label);
  if (s === "city" || s === "mesto")
    return projects.filter(p => inferCity(p.district) === label || p.city === label);
  if (s === "project" || s === "projekt")
    return projects.filter(p => p.id === label);
  return projects;
}
function inferCity(district) {
  if (!district) return null;
  const s = String(district).trim();
  if (/^Bratislava\b/i.test(s)) return "Bratislava";
  if (/^Košice\b/i.test(s))     return "Košice";
  if (/^Prešov\b/i.test(s))     return "Prešov";
  if (/^Žilina\b/i.test(s))     return "Žilina";
  if (/^Nitra\b/i.test(s))      return "Nitra";
  if (/^Trnava\b/i.test(s))     return "Trnava";
  if (/^Banská Bystrica\b/i.test(s)) return "Banská Bystrica";
  if (/^Trenčín\b/i.test(s))    return "Trenčín";
  return s;
}
function scopeTitle(scope, lang) {
  const sk = {
    market: "Trh", trh: "Trh",
    city: "Mesto", mesto: "Mesto",
    district: "Časť mesta", cast: "Časť mesta", "cast mesta": "Časť mesta",
    developer: "Developer",
    project: "Projekt", projekt: "Projekt",
  };
  return sk[String(scope || "").toLowerCase()] || scope || "";
}
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ─── Summarise (mirrors Reports.jsx summariseProjects) ─── */
function summariseProjects(projects) {
  const totalUnits = projects.reduce((a, p) => a + (p.total_units || 0), 0);
  const available  = projects.reduce((a, p) => a + (p.available_units || 0), 0);
  const sold       = projects.reduce((a, p) => a + (p.sold_units || 0), 0);
  const sold30     = projects.reduce((a, p) => a + (p.sold_last_month || 0), 0);
  const soldPct    = totalUnits > 0 ? (sold / totalUnits) * 100 : 0;
  const priced = projects.filter(p => p.avg_price_eur_m2 && (p.total_units || 0) > 0);
  const wavgM2 = priced.length
    ? priced.reduce((a, p) => a + p.avg_price_eur_m2 * p.total_units, 0) /
      priced.reduce((a, p) => a + p.total_units, 0)
    : null;
  const topSellers = [...projects]
    .filter(p => (p.sold_last_month || 0) > 0)
    .sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0))
    .slice(0, 5);
  const soldOutWatch = projects
    .filter(p => (p.sold_percentage || 0) >= 85 && (p.sold_percentage || 0) < 100)
    .sort((a, b) => (b.sold_percentage || 0) - (a.sold_percentage || 0))
    .slice(0, 5);
  return {
    projectCount: projects.length, totalUnits, available, sold, sold30,
    soldPct, wavgM2, topSellers, soldOutWatch,
  };
}

/* HTML-escape user-supplied strings so project names / districts / emails
   that happen to contain < > & " ' don't break the email markup or
   inject active content. Keep this tight — the email is inline-styled
   HTML rendered by Gmail/Outlook; any stray quote breaks layout. */
function escHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ─── Email HTML template ─── */
function renderReportEmailHtml({ subscriberEmail, month, scope, scopeLabel, summary, webUrl, lang }) {
  const fmt = (n) => n == null ? "—" : Math.round(n).toLocaleString("sk-SK");
  const title = scopeLabel ? `${escHtml(scopeTitle(scope))} · ${escHtml(scopeLabel)}` : escHtml(scopeTitle(scope));
  const cap = escHtml(capitalize(month));

  const topList = summary.topSellers.length
    ? summary.topSellers.map(p => `<li style="margin:4px 0"><strong style="color:${textLight}">${escHtml(p.name)}</strong> <span style="color:${textDim}">(${escHtml(p.district || "—")})</span> — <span style="color:${green};font-weight:700">+${p.sold_last_month}</span> predaných</li>`).join("")
    : `<li style="color:${textDim};list-style:none">Žiadne predajné dáta za posledný mesiac.</li>`;

  const soldOutList = summary.soldOutWatch.length
    ? summary.soldOutWatch.map(p => `<li style="margin:4px 0"><strong style="color:${textLight}">${escHtml(p.name)}</strong> — <span style="color:#ff6b6b;font-weight:700">${Math.round(p.sold_percentage)}%</span> predané, ${p.available_units} zostáva</li>`).join("")
    : `<li style="color:${textDim};list-style:none">Nikto nad 85%.</li>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${textLight}">
<div style="max-width:640px;margin:0 auto;padding:32px 20px">
  <div style="margin-bottom:24px">
    <span style="display:inline-block;width:32px;height:32px;background:${green};border-radius:7px;text-align:center;line-height:32px;font-weight:700;color:#0a0a0b;font-family:'JetBrains Mono',monospace">R</span>
    <span style="font-size:18px;font-weight:600;margin-left:8px">Residata</span>
  </div>
  <div style="background:#16161a;border:1px solid #2a2a32;border-radius:12px;padding:28px">
    <div style="font-size:11px;color:${green};font-family:'JetBrains Mono',monospace;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px">Mesačný report · ${title}</div>
    <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;letter-spacing:-0.02em">${cap}</h1>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 20px">
      <div style="flex:1;min-width:110px;padding:12px;background:#0e0e10;border:1px solid #2a2a32;border-radius:8px">
        <div style="font-size:10px;color:${textDim};text-transform:uppercase;letter-spacing:0.08em;font-family:'JetBrains Mono',monospace">Projektov</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${summary.projectCount}</div>
      </div>
      <div style="flex:1;min-width:110px;padding:12px;background:#0e0e10;border:1px solid #2a2a32;border-radius:8px">
        <div style="font-size:10px;color:${textDim};text-transform:uppercase;letter-spacing:0.08em;font-family:'JetBrains Mono',monospace">Bytov</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${fmt(summary.totalUnits)}</div>
      </div>
      <div style="flex:1;min-width:110px;padding:12px;background:#0e0e10;border:1px solid #2a2a32;border-radius:8px">
        <div style="font-size:10px;color:${textDim};text-transform:uppercase;letter-spacing:0.08em;font-family:'JetBrains Mono',monospace">Predaných %</div>
        <div style="font-size:20px;font-weight:700;color:${orange};margin-top:4px">${Math.round(summary.soldPct)}%</div>
      </div>
      <div style="flex:1;min-width:110px;padding:12px;background:#0e0e10;border:1px solid #2a2a32;border-radius:8px">
        <div style="font-size:10px;color:${textDim};text-transform:uppercase;letter-spacing:0.08em;font-family:'JetBrains Mono',monospace">Ø €/m²</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px">${fmt(summary.wavgM2)}</div>
      </div>
    </div>
    <p style="font-size:15px;line-height:1.6;color:#c0c0c8;margin:0 0 20px">
      Za posledných 30 dní pribudlo <strong style="color:${orange}">${summary.sold30}</strong> nových predajov.
      Aktuálne je voľných <strong style="color:${green}">${fmt(summary.available)}</strong> bytov z ${fmt(summary.totalUnits)}.
    </p>
    <h3 style="font-size:14px;margin:24px 0 8px;color:${textLight};letter-spacing:0.02em">Top predajcovia (30 dní)</h3>
    <ul style="margin:0;padding-left:18px;font-size:14px;color:#c0c0c8">${topList}</ul>
    <h3 style="font-size:14px;margin:24px 0 8px;color:${textLight};letter-spacing:0.02em">Dopredáva sa (nad 85%)</h3>
    <ul style="margin:0;padding-left:18px;font-size:14px;color:#c0c0c8">${soldOutList}</ul>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #2a2a32">
      <a href="${webUrl}/app/reports" style="display:inline-block;background:${green};color:#0a0a0b;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none">
        Otvoriť plný report →
      </a>
    </div>
  </div>
  <div style="margin-top:24px;font-size:11px;color:#55555f;text-align:center;line-height:1.6">
    Dostávaš tento mesačný e-mail pretože si sa prihlásil na ${escHtml(subscriberEmail)}.
    <br/>Residata · <a href="${webUrl}" style="color:#55555f">${webUrl}</a>
  </div>
</div>
</body></html>`;
}
