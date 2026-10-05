/**
 * ScrapeCadenceEditor — admin-only "Zber dát" tab inside Data Control.
 *
 * Shows and sets how often the market data is collected: every N days, N = 1…30.
 * One number for every market. The scheduler keeps its morning times; on each
 * morning the collection job decides whether at least N days have passed since the
 * market's last full collection. A change applies from the next morning.
 *
 * Data: two admin-gated RPCs (public._require_admin, fail closed), both returning
 * the same jsonb report:
 *   admin_scrape_cadence()            → the setting, per-market last/next, history
 *   admin_set_scrape_cadence(p_days)  → sets it (1…30, validated server-side too)
 */
import { useEffect, useMemo, useState } from "react";
import { MAX_DAYS, MIN_DAYS, PRESETS, everyDays, parseDays, stepDays } from "../lib/scrapeCadence";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function storedAccessToken() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.includes("-auth-token")) {
        const v = JSON.parse(localStorage.getItem(k));
        const tok = v?.access_token || v?.currentSession?.access_token || (Array.isArray(v) ? v[0] : null);
        if (tok) return tok;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** POST an RPC; resolves to the JSON body, rejects with { code, message }. */
async function rpc(fn, body, { timeoutMs = 30000 } = {}) {
  const token = storedAccessToken();
  if (!token) throw { code: "NO_SESSION" };
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    if (r.status === 401) throw { code: "SESSION_EXPIRED" };
    if (!r.ok) {
      let e = {};
      try { e = await r.json(); } catch { /* not json */ }
      throw { code: e.code || String(r.status), message: e.message || "" };
    }
    return await r.json();
  } catch (e) {
    if (e?.name === "AbortError") throw { code: "TIMEOUT" };
    if (e?.code) throw e;
    throw { code: "NETWORK", message: String(e?.message || e) };
  } finally { clearTimeout(killer); }
}

const GREEN = "var(--accent)", BORDER = "var(--border)", BG2 = "var(--surface-2)", FG = "var(--text)", DIM = "var(--text-dim)";
const AMBER = "#f5a623";
const MONO = "'JetBrains Mono', monospace";
const TZ = "Europe/Bratislava";

const card = { background: BG2, borderWidth: "1px", borderStyle: "solid", borderColor: BORDER, borderRadius: 10, padding: "14px 16px" };
const label = { fontSize: 11, color: DIM, fontFamily: MONO, textTransform: "uppercase", letterSpacing: 0.4 };
const btn = (enabled, primary = false) => ({
  padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
  borderWidth: "1px", borderStyle: "solid", borderColor: primary && enabled ? GREEN : BORDER,
  background: primary && enabled ? GREEN : "transparent",
  color: primary && enabled ? "var(--accent-ink)" : enabled ? FG : DIM,
  cursor: enabled ? "pointer" : "not-allowed",
});
const th = { textAlign: "left", padding: "7px 10px", fontSize: 11, color: DIM, fontFamily: MONO,
  textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${BORDER}` };
const td = { padding: "8px 10px", borderBottom: `1px solid ${BORDER}`, fontSize: 13 };

export default function ScrapeCadenceEditor({ lang = "sk" }) {
  const t = (en, sk) => (lang === "sk" ? sk : en);
  const loc = lang === "sk" ? "sk-SK" : "en-GB";

  const [report, setReport] = useState(null);
  const [draft, setDraft] = useState("");
  const [loadErr, setLoadErr] = useState(null);  // the rejected { code } of the last load
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);   // { kind: "ok" } | { kind: "err", error }

  const errText = (e) => {
    switch (e?.code) {
      case "22023": return t("Enter a whole number of days from 1 to 30.", "Zadaj celé číslo dní od 1 do 30.");
      case "42501": return t("Admins only.", "Len pre admina.");
      case "NO_SESSION":
      case "SESSION_EXPIRED": return t("Your session expired — reload and sign in again.", "Platnosť prihlásenia vypršala — obnov stránku a prihlás sa znova.");
      case "TIMEOUT": return t("The database did not answer in time — try again.", "Databáza neodpovedala včas — skús to znova.");
      default: return t(`Could not complete the request (${e?.code || "error"}).`, `Požiadavku sa nepodarilo dokončiť (${e?.code || "chyba"}).`);
    }
  };

  useEffect(() => {
    let alive = true;
    rpc("admin_scrape_cadence", {})
      .then((rep) => {
        if (!alive) return;
        setLoadErr(null);
        setReport(rep);
        setDraft(String(rep?.cadence_days ?? ""));
      })
      .catch((e) => { if (alive) setLoadErr(e); });
    return () => { alive = false; };
  }, [reloadKey]);

  const current = report?.cadence_days ?? null;
  const parsed = parseDays(draft);
  const dirty = parsed != null && parsed !== current;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const rep = await rpc("admin_set_scrape_cadence", { p_days: parsed });
      setReport(rep);
      setDraft(String(rep?.cadence_days ?? parsed));
      setStatus({ kind: "ok" });
    } catch (e) {
      setStatus({ kind: "err", error: e });
    } finally {
      setSaving(false);
    }
  };

  const step = (delta) => {
    setDraft(String(stepDays(draft, current, delta)));
    setStatus(null);
  };

  const every = (n) => everyDays(n, lang);

  const fmtTs = (ts) => (ts ? new Date(ts).toLocaleString(loc, { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const fmtDate = (d) => {
    if (!d) return "—";
    const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, dd, 12)).toLocaleDateString(loc, { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric" });
  };
  const marketName = (m) => (m.market_key === "sk" ? t("Slovakia", "Slovensko")
    : m.market_key === "cz" ? t("Czechia", "Česko") : (m.market_name || m.market_key));

  const markets = useMemo(() => report?.markets || [], [report]);
  const history = useMemo(() => report?.history || [], [report]);

  if (loadErr) {
    return (
      <div style={{ ...card, borderColor: AMBER, color: AMBER }} data-testid="scrape-cadence-error">
        {errText(loadErr)}{" "}
        <button onClick={() => { setLoadErr(null); setReloadKey((k) => k + 1); }} style={{ ...btn(true), marginLeft: 8 }}>{t("Retry", "Skúsiť znova")}</button>
      </div>
    );
  }
  if (!report) {
    return <div style={{ color: DIM, fontFamily: MONO, fontSize: 13 }}>{t("Loading…", "Načítavam…")}</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 880 }} data-testid="scrape-cadence">
      <div style={card}>
        <div style={label}>{t("Data collection", "Zber dát")}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: FG, marginTop: 6 }} data-testid="scrape-cadence-current"
             data-days={current}>
          {every(current)}
        </div>
        <p style={{ color: DIM, fontSize: 13, lineHeight: 1.55, margin: "8px 0 0", maxWidth: "70ch" }}>
          {t("The collection job still starts every morning at the same time. It collects a market only when at least this many days have passed since that market's last full collection; on the other mornings it records that it ran and stops. A failed collection is retried the next morning. Manual runs are not affected.",
             "Zberová úloha sa naďalej spúšťa každé ráno v rovnakom čase. Trh zozbiera, len keď od jeho posledného úplného zberu uplynul aspoň tento počet dní; v ostatné rána zaznamená, že bežala, a skončí. Neúspešný zber sa zopakuje nasledujúce ráno. Ručné spustenia sa to netýka.")}
        </p>
      </div>

      <div style={card}>
        <div style={label}>{t("Change", "Zmeniť")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <span style={{ color: FG, fontSize: 14 }}>{t("Days between collections:", "Počet dní medzi zbermi:")}</span>
          <button type="button" onClick={() => step(-1)} style={btn(true)} aria-label={t("One day less", "O deň menej")}
                  data-testid="scrape-cadence-minus">−</button>
          <input
            type="number" inputMode="numeric" min={MIN_DAYS} max={MAX_DAYS} step={1}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setStatus(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
            aria-label={t("Days between collections", "Počet dní medzi zbermi")}
            data-testid="scrape-cadence-input"
            style={{ width: 72, padding: "7px 10px", borderRadius: 8, border: `1px solid ${parsed == null ? AMBER : BORDER}`,
                     background: "var(--surface-3)", color: FG, fontSize: 15, fontFamily: MONO, textAlign: "center" }}
          />
          <button type="button" onClick={() => step(1)} style={btn(true)} aria-label={t("One day more", "O deň viac")}
                  data-testid="scrape-cadence-plus">+</button>
          <button type="button" onClick={save} disabled={!dirty || saving} style={{ ...btn(dirty && !saving, true), marginLeft: 6 }}
                  data-testid="scrape-cadence-save">
            {saving ? t("Saving…", "Ukladám…") : t("Save", "Uložiť")}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {PRESETS.map((n) => (
            <button key={n} type="button" onClick={() => { setDraft(String(n)); setStatus(null); }}
                    data-testid={`scrape-cadence-preset-${n}`}
                    style={{ ...btn(true), padding: "4px 10px", fontSize: 12,
                             borderColor: parsed === n ? GREEN : BORDER, color: parsed === n ? GREEN : FG }}>
              {n === 1 ? t("daily", "denne") : `${n} ${t("d", "d")}`}
            </button>
          ))}
        </div>
        {parsed == null && (
          <div style={{ color: AMBER, fontSize: 12, marginTop: 8 }} data-testid="scrape-cadence-invalid">
            {t("A whole number of days from 1 to 30.", "Celé číslo dní od 1 do 30.")}
          </div>
        )}
        {status && (
          <div style={{ color: status.kind === "ok" ? GREEN : AMBER, fontSize: 13, marginTop: 10 }}
               data-testid="scrape-cadence-status" data-kind={status.kind}>
            {status.kind === "ok"
              ? t("Saved — applies from the next morning's run.", "Uložené — platí od najbližšieho ranného spustenia.")
              : errText(status.error)}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={label}>{t("Markets", "Trhy")}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              <th style={th}>{t("Market", "Trh")}</th>
              <th style={th}>{t("Last full collection", "Posledný úplný zber")}</th>
              <th style={th}>{t("Next collection", "Najbližší zber")}</th>
              <th style={th}>{t("Last morning run", "Posledné ranné spustenie")}</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.market_key} data-testid={`scrape-cadence-market-${m.market_key}`}>
                <td style={td}>{marketName(m)}</td>
                <td style={{ ...td, fontFamily: MONO }}>{fmtTs(m.last_scrape_at)}</td>
                <td style={{ ...td, fontFamily: MONO }} data-testid={`scrape-cadence-next-${m.market_key}`} data-date={m.next_scrape_date || ""}>
                  {m.running_since ? t("running now", "práve beží") : `${fmtDate(m.next_scrape_date)} ${t("(morning)", "(ráno)")}`}
                </td>
                <td style={{ ...td, fontFamily: MONO, color: DIM }}>
                  {m.last_fire_at
                    ? `${fmtTs(m.last_fire_at)} · ${m.last_fire_due ? t("collected", "zbieralo sa") : t("not a collection day", "nebol deň zberu")}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <div style={label}>{t("History", "História zmien")}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }} data-testid="scrape-cadence-history">
          <tbody>
            {history.map((h, i) => (
              <tr key={`${h.effective_from || "start"}-${i}`}>
                <td style={{ ...td, fontFamily: MONO, width: 190 }}>{h.effective_from ? fmtTs(h.effective_from) : t("from the start", "od začiatku")}</td>
                <td style={td}>{every(h.days)}</td>
                <td style={{ ...td, color: DIM }}>{h.set_by === "migration" ? t("system", "systém") : h.set_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
