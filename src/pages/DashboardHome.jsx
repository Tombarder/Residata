/**
 * DashboardHome — the personalized landing page of the platform (/app).
 *
 * This is what a customer sees the instant they click "Open platform" on the
 * marketing site. It is deliberately NOT a page of random facts — it is THEIR
 * dashboard:
 *
 *   ZONE A · Market Overview (always present)
 *     General market datapoints for the selected scope, with its own filter
 *     (market comes from the sidebar market switcher; an "Area" selector here
 *     narrows to a single district). KPI strip adapts to the scope.
 *
 *   ZONE B · My dashboard (personalized · modular · persistent)
 *     A grid of widgets the customer assembles themselves — metric tiles,
 *     watched projects, leaderboards, price benchmarks, trends, district
 *     summaries. Add / configure / resize / reorder / remove. Every change is
 *     saved to public.user_dashboards and stays FOREVER until they change it.
 *
 * All data comes from the same live views the rest of the platform uses
 * (projects_live, totals_by_country/district, project_snapshots), so the
 * numbers here always match Analytics / Reports / the marketing site. Prices
 * render in the user's selected display currency; velocity/analytics widgets
 * are capability-gated (blurred + upgrade nudge for free users).
 */
import { useState, useMemo, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import {
  useProjects, useMarketTotals, useVelocityMature, useDistrictTotals, useFreshness,
} from "../lib/useData";
import { supabaseData } from "../lib/supabase";
import { useCountry, isAllCountries, countryName } from "../lib/useCountry";
import { useCurrency } from "../lib/useCurrency";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { localeTag } from "../lib/locale";
import { useActivateTrial } from "../lib/useActivateTrial";
import {
  accent as green, accentInk, orange, blue, dim, faint, text as textLight, border,
  surface as bg, surfaceDark as bg2, surfacePanel, mono,
} from "../lib/theme";
import { useDashboardConfig, newWidgetId } from "../lib/useDashboardConfig";
import MapFilterBuilder from "../components/MapFilterBuilder";
import Picker from "../components/Picker";
import { applyFilters, describe, isComplete } from "../lib/mapFilters";

const L = (lang, sk, en) => (lang === "sk" ? sk : en);

// ─── formatting ────────────────────────────────────────────────
const fmtCount = (v, lang) =>
  (v == null || Number.isNaN(Number(v))) ? "—" : Number(v).toLocaleString(localeTag(lang));
const fmtM2 = (eur, lang) =>
  (eur == null || Number.isNaN(Number(eur))) ? "—"
    : `${Math.round(moneyFromEur(Number(eur))).toLocaleString(localeTag(lang))} ${moneySymbol()}/m²`;
const fmtPct = (v) => (v == null || !Number.isFinite(Number(v))) ? "—" : `${Math.round(Number(v))}%`;
const fmtMonths = (m, lang) => {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m >= 24) return `~${(m / 12).toFixed(1)} ${L(lang, "r", "yr")}`;
  return `~${m < 10 ? m.toFixed(1) : Math.round(m)} ${L(lang, "mes", "mo")}`;
};

// ─── metric registry (shared by KPI strip + metric widget) ─────
// hint = one-line plain-language clarification shown under the number, so a
// non-analyst instantly knows what "Reserved" or "All units" actually means.
const METRICS = {
  available:   { label: { sk: "Voľné byty",     en: "Available"    }, hint: { sk: "aktuálne v predaji",         en: "on the market now"      }, fmt: "count", accent: green },
  avg_m2:      { label: { sk: "Priem. cena/m²", en: "Avg price/m²" }, hint: { sk: "ponuková, s DPH",            en: "asking, incl. VAT"      }, fmt: "m2" },
  sold30:      { label: { sk: "Predané/30 dní", en: "Sold/30 days" }, hint: { sk: "tempo predaja",              en: "sales pace"             }, fmt: "count", accent: orange, requires: "view_sold_velocity" },
  sold_total:  { label: { sk: "Predané spolu",  en: "Sold total"   }, hint: { sk: "kumulatívne doteraz",        en: "cumulative to date"     }, fmt: "count" },
  sold_through:{ label: { sk: "Vypredanosť",    en: "Sold-through" }, hint: { sk: "podiel už predaných",        en: "share already sold"     }, fmt: "pct", accent: orange },
  reserved:    { label: { sk: "Rezervované",    en: "Reserved"     }, hint: { sk: "vr. predrezervovaných",      en: "incl. pre-reserved"     }, fmt: "count", accent: blue },
  tracked:     { label: { sk: "Všetky byty",    en: "All units"    }, hint: { sk: "vrátane predaných",          en: "incl. sold"             }, fmt: "count" },
  projects:    { label: { sk: "Projekty",       en: "Projects"     }, hint: { sk: "aktívne v predaji",          en: "active in market"       }, fmt: "count" },
  developers:  { label: { sk: "Developeri",     en: "Developers"   }, hint: { sk: "aktívni na trhu",            en: "active in market"       }, fmt: "count" },
  inventory:   { label: { sk: "Zásoba",         en: "Inventory"    }, hint: { sk: "mesiacov pri dnešnom tempe", en: "months at today's pace" }, fmt: "months" },
};
// Metrics that support a month-over-month delta (derivable from project history).
const MOM_METRICS = new Set(["available", "avg_m2", "reserved", "sold_total", "sold_through"]);
const fmtMetric = (key, val, lang) => {
  const f = METRICS[key]?.fmt;
  if (f === "m2") return fmtM2(val, lang);
  if (f === "months") return fmtMonths(val, lang);
  if (f === "pct") return fmtPct(val);
  return fmtCount(val, lang);
};

// Aggregate a developer's active projects into the same numeric shape a market /
// district row exposes, so metricValue() can treat all three scopes uniformly.
function developerAgg(projects, developer) {
  const ps = (projects || []).filter(p => p.developer === developer && (p.status || "active") === "active");
  let avail = 0, sold = 0, tracked = 0, reserved = 0, sold30 = 0, wSum = 0, wTot = 0;
  for (const p of ps) {
    avail    += p.available_units || 0;
    sold     += p.sold_units || 0;
    tracked  += p.total_units || 0;
    reserved += p.reserved_units || 0;
    sold30   += p.sold_last_month || 0;
    if (p.avg_price_eur_m2) { const w = p.available_units || p.total_units || 1; wSum += p.avg_price_eur_m2 * w; wTot += w; }
  }
  return { avail, sold, tracked, reserved, sold30, projects: ps.length, avg: wTot ? wSum / wTot : null };
}

// One number for (metric × scope). Returns raw value (EUR for prices), or null.
function metricValue(metric, scope, ctx) {
  const { marketTotals, districts, projects } = ctx;
  if (!scope || scope.kind === "market") {
    const t = marketTotals;
    switch (metric) {
      case "available":  return t.unitsAvailable;
      case "avg_m2":     return t.avgPriceM2;
      case "sold30":     return t.soldLastMonth;
      case "reserved":   return t.unitsReserved;
      case "tracked":    return t.unitsTracked;
      case "projects":   return t.projectsActive;
      case "sold_total": return (projects || []).reduce((a, p) => a + (p.sold_units || 0), 0);
      case "developers": return t.developersActive;
      case "sold_through": {
        // Numerator AND denominator from the SAME source (projects) — mixing projects'
        // sold with marketTotals' available/reserved (a different, active-only aggregate)
        // could skew the ratio or push it past 100% for paused/archived projects.
        let sold = 0, den = 0;
        for (const p of projects || []) {
          const s = p.sold_units || 0;
          sold += s;
          den += s + (p.available_units || 0) + (p.reserved_units || 0) + (p.prereserved_units || 0);
        }
        return den ? (sold / den) * 100 : null;
      }
      case "inventory":  return (t.soldLastMonth > 0 && t.unitsAvailable != null) ? t.unitsAvailable / t.soldLastMonth : null;
      default: return null;
    }
  }
  if (scope.kind === "district") {
    const row = (districts || []).find(d => d.district === scope.district && String(d.city_id) === String(scope.city));
    if (!row) return null;
    switch (metric) {
      case "available":  return row.available_units;
      case "avg_m2":     return row.avg_eur_m2;
      case "reserved":   return row.reserved_units;
      case "tracked":    return row.total_units;
      case "projects":   return row.project_count;
      case "sold_total": return row.sold_units;
      case "developers": return null;   // districts view has no developer count
      case "sold_through": {
        const den = (row.sold_units || 0) + (row.available_units || 0) + (row.reserved_units || 0);
        return den ? ((row.sold_units || 0) / den) * 100 : null;
      }
      case "sold30":     return null;   // no per-district velocity
      case "inventory":  return null;
      default: return null;
    }
  }
  if (scope.kind === "developer") {
    const a = developerAgg(projects, scope.developer);
    switch (metric) {
      case "available":  return a.avail;
      case "avg_m2":     return a.avg;
      case "sold30":     return a.sold30;
      case "reserved":   return a.reserved;
      case "tracked":    return a.tracked;
      case "projects":   return a.projects;
      case "sold_total": return a.sold;
      case "developers": return null;
      case "sold_through": {
        const den = a.sold + a.avail + a.reserved;
        return den ? (a.sold / den) * 100 : null;
      }
      case "inventory":  return (a.sold30 > 0) ? a.avail / a.sold30 : null;
      default: return null;
    }
  }
  return null;
}

// ─── month-over-month deltas from project history ──────────────
// Aggregate the per-project monthly snapshots to the chosen scope, month by
// month, so the KPI strip + metric widgets can show "▲/▼ vs last month".
// Scope match: market = everything; developer = same developer; district = same
// district NAME (only used where the country is unambiguous — the KPI strip
// restricts MoM to market scope to avoid same-named districts across cities).
function scopeHistory(scope, snapshots, countryIds) {
  const rows = (snapshots || []).filter(r => {
    // Restrict to the current country's projects FIRST. project_snapshots carries
    // both markets, so a "market" (or cross-border developer) scope would sum
    // SK + CZ and show a MoM delta that never happened in the user's market.
    if (countryIds && !countryIds.has(r.project_id)) return false;
    if (!scope || scope.kind === "market") return true;
    if (scope.kind === "developer") return r.developer === scope.developer;
    if (scope.kind === "district") return r.district === scope.district;
    return true;
  });
  const byMonth = new Map();
  for (const r of rows) {
    const m = r.snapshot_month; if (!m) continue;
    let a = byMonth.get(m);
    if (!a) { a = { available: 0, sold: 0, reserved: 0, wSum: 0, wTot: 0 }; byMonth.set(m, a); }
    a.available += r.available_units || 0;
    a.sold += r.sold_units || 0;
    a.reserved += r.reserved_units || 0;
    if (r.avg_price_eur_m2) { const w = r.available_units || 1; a.wSum += r.avg_price_eur_m2 * w; a.wTot += w; }
  }
  return [...byMonth.keys()].sort().map(m => {
    const a = byMonth.get(m), den = a.sold + a.available + a.reserved;
    return { month: m, available: a.available, sold: a.sold, reserved: a.reserved,
             avg_m2: a.wTot ? a.wSum / a.wTot : null, sold_through: den ? (a.sold / den) * 100 : null };
  });
}
function momDelta(metric, scope, ctx) {
  const key = { available: "available", avg_m2: "avg_m2", reserved: "reserved", sold_total: "sold", sold_through: "sold_through" }[metric];
  if (!key) return null;
  // ctx.projects is already country-scoped → its id set restricts the history to
  // the current market (mirrors the KPI strip's aggMomDelta(overviewIds,…)).
  const countryIds = new Set((ctx.projects || []).map(p => p.id));
  const h = scopeHistory(scope, ctx.snapshots, countryIds);
  if (h.length < 2) return null;
  const cur = h[h.length - 1][key], prev = h[h.length - 2][key];
  if (cur == null || prev == null) return null;
  const abs = cur - prev;
  if (Math.abs(abs) < 1e-9) return null;
  return { abs, metric };
}
// A compact "▲ 320" / "▼ 1 200 €" / "▲ 2 pp" chip. Direction only — deliberately
// no green/red good-bad colouring (a price rise or more supply isn't "bad").
function DeltaChip({ delta, lang }) {
  if (!delta) return null;
  const up = delta.abs > 0;
  const mag = Math.abs(delta.abs);
  let txt;
  if (delta.metric === "avg_m2") txt = `${Math.round(moneyFromEur(mag)).toLocaleString(localeTag(lang))} ${moneySymbol()}`;
  else if (delta.metric === "sold_through") txt = `${mag.toFixed(1)} pp`;
  else txt = fmtCount(Math.round(mag), lang);
  return (
    <span title={L(lang, "oproti minulému mesiacu", "vs last month")}
      style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, whiteSpace: "nowrap" }}>
      <span style={{ color: up ? green : "#ff8a8a" }}>{up ? "▲" : "▼"}</span> {txt}
    </span>
  );
}

// ─── overview aggregation over an arbitrary (filtered) project set ─────
// The Market Overview zone is now driven by the same filter engine as the Map /
// Projects list (applyFilters over projects_live), so its KPIs are computed live
// from whatever subset the user's filters select — not a single pre-baked view.
function aggregateProjects(list) {
  let available = 0, sold = 0, reserved = 0, tracked = 0, sold30 = 0, wSum = 0, wTot = 0;
  const devs = new Set();
  for (const p of list || []) {
    available += p.available_units || 0;
    sold      += p.sold_units || 0;
    reserved  += p.reserved_units || 0;
    tracked   += p.total_units || 0;
    sold30    += p.sold_last_month || 0;
    if (p.developer && String(p.developer).trim()) devs.add(String(p.developer).trim());
    if (p.avg_price_eur_m2) { const w = p.available_units || p.total_units || 1; wSum += p.avg_price_eur_m2 * w; wTot += w; }
  }
  const den = sold + available + reserved;
  return {
    available, sold_total: sold, reserved, tracked, sold30,
    projects: (list || []).length, developers: devs.size,
    avg_m2: wTot ? wSum / wTot : null,
    sold_through: den ? (sold / den) * 100 : null,
    inventory: sold30 > 0 ? available / sold30 : null,
  };
}
const aggMetric = (agg, metric) => (agg && metric in agg ? agg[metric] : null);

// Monthly history aggregated over a set of project ids → MoM delta for the strip.
function aggHistory(idSet, snapshots) {
  const byMonth = new Map();
  for (const r of snapshots || []) {
    if (!idSet.has(r.project_id)) continue;
    const m = r.snapshot_month; if (!m) continue;
    let a = byMonth.get(m);
    if (!a) { a = { available: 0, sold: 0, reserved: 0, wSum: 0, wTot: 0 }; byMonth.set(m, a); }
    a.available += r.available_units || 0;
    a.sold += r.sold_units || 0;
    a.reserved += r.reserved_units || 0;
    if (r.avg_price_eur_m2) { const w = r.available_units || 1; a.wSum += r.avg_price_eur_m2 * w; a.wTot += w; }
  }
  return [...byMonth.keys()].sort().map(m => {
    const a = byMonth.get(m), den = a.sold + a.available + a.reserved;
    return { available: a.available, sold_total: a.sold, reserved: a.reserved,
             avg_m2: a.wTot ? a.wSum / a.wTot : null, sold_through: den ? (a.sold / den) * 100 : null };
  });
}
function aggMomDelta(metric, idSet, snapshots) {
  if (!MOM_METRICS.has(metric)) return null;
  const h = aggHistory(idSet, snapshots);
  if (h.length < 2) return null;
  const cur = h[h.length - 1][metric], prev = h[h.length - 2][metric];
  if (cur == null || prev == null) return null;
  const abs = cur - prev;
  if (Math.abs(abs) < 1e-9) return null;
  return { abs, metric };
}

const scopeLabel = (scope, lang) => {
  if (!scope || scope.kind === "market") return L(lang, "celý trh", "whole market");
  if (scope.kind === "district") return scope.districtLabel || scope.district;
  if (scope.kind === "developer") return scope.developer;
  return "";
};

// ─── tiny inline sparkline ─────────────────────────────────────
function Sparkline({ series, color = green, width = 120, height = 34 }) {
  const pts = (series || []).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
  if (pts.length < 2) return <div style={{ height, color: faint, fontFamily: mono, fontSize: "0.65rem", display: "flex", alignItems: "center" }}>—</div>;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const stepX = width / (pts.length - 1);
  const y = v => height - 3 - ((v - min) / span) * (height - 6);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={((pts.length - 1) * stepX).toFixed(1)} cy={y(last).toFixed(1)} r="2.4" fill={color} />
    </svg>
  );
}

// ─── styled primitives ─────────────────────────────────────────
// Pill-style chip button matching the Map / Projects filter bar.
const filterChip = (active) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999,
  fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit",
  border: `1px solid ${active ? green : border}`, background: active ? `color-mix(in srgb, var(--accent) 8%, transparent)` : bg2, color: active ? green : textLight,
});
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <span style={{ display: "block", fontSize: "0.62rem", color: dim, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.35rem" }}>{label}</span>
      {children}
    </div>
  );
}
// Config-form dropdown = the platform's Picker (portaled, on-theme, searchable),
// so the editor's menus match the Map / Projects "rolldown" style exactly.
function Select({ value, onChange, options, searchable = false, sk = false }) {
  return <Picker value={value} onChange={onChange} options={options} searchable={searchable} sk={sk} placeholder={sk ? "vyber…" : "select…"} />;
}

// ─── KPI card (Zone A) ─────────────────────────────────────────
// Colour-coded metric icons — a small tinted chip per KPI so the cards read rich
// and scannable (not empty white). Theme-invariant vivid hues, fine on both themes.
const KPI_ICON = {
  available:    { c: "#10b981", d: "M3 21V8l9-5 9 5v13M9 21v-6h6v6" },
  avg_m2:       { c: "#3b74e8", d: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  sold30:       { c: "#e0940f", d: "M3 17l5-5 4 3 8-9M21 6v5h-5" },
  sold_through: { c: "#e0940f", d: "M21 12a9 9 0 1 1-9-9v9z" },
  reserved:     { c: "#3b74e8", d: "M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" },
  inventory:    { c: "#8b5cf6", d: "M20 7l-8-4-8 4m16 0l-8 4-8-4m16 0v10l-8 4m0-14v14" },
  projects:     { c: "#10b981", d: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" },
  developers:   { c: "#64748b", d: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
};

function KpiCard({ label, value, hint, delta, lang, accent = textLight, locked = false, icon }) {
  const k = icon?.c;
  return (
    <div style={{ position: "relative", overflow: "hidden",
      background: k ? `linear-gradient(180deg, color-mix(in srgb, ${k} 9%, var(--surface)) 0%, var(--surface) 46%)` : bg,
      border: `1px solid ${border}`, borderRadius: 12, padding: "0.95rem 1.05rem", minWidth: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {k && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: k, opacity: 0.85 }} />}
      {icon && (
        <div style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${icon.c} 14%, transparent)`, marginBottom: "0.05rem" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={icon.c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon.d} /></svg>
        </div>
      )}
      <span style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.09em", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ fontFamily: mono, fontSize: "1.4rem", fontWeight: 700, color: accent, letterSpacing: "-0.02em", lineHeight: 1.05, filter: locked ? "blur(6px)" : "none", opacity: locked ? 0.55 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
      {locked
        ? <div style={{ fontSize: "0.62rem", color: orange, fontFamily: mono }}>{L(lang, "len pre paid", "paid only")}</div>
        : (hint || delta) && (
          // hint WRAPS (no ellipsis) so the full label is always readable — the cards
          // are narrow (7 across) and truncating cut "aktuálne v predaji" → "…preda…".
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.4rem" }}>
            <span style={{ fontFamily: mono, fontSize: "0.63rem", color: faint, lineHeight: 1.3, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{hint}</span>
            <div style={{ flexShrink: 0 }}><DeltaChip delta={delta} lang={lang} /></div>
          </div>
        )}
    </div>
  );
}

// Per-project monthly history for trend sparklines. MUST use the AUTHED client:
// project_snapshots is RLS-gated (historical data is a paid capability), so the
// shared anon-client useProjectSnapshots() hook returns [] for everyone. The
// dashboard is always behind auth, so we read it as the logged-in user — paid /
// admin get the full series, free users get nothing (their trend widgets are
// capability-blurred anyway). One light query (<1k rows), cached module-level —
// KEYED BY user id, because project_snapshots is RLS-gated: a paid user's rows must
// never be handed to a different (e.g. free) user who logs in during the same module
// lifetime. (Mirrors useProjects' user-keyed cache in lib/useData.js.)
let _historyCache = { key: null, rows: null };
function useProjectHistory() {
  const { user } = useAuth();
  const [rows, setRows] = useState(() => (_historyCache.key === (user?.id || null) ? _historyCache.rows : null) || []);
  useEffect(() => {
    const key = user?.id || null;
    if (!user) { setRows([]); return; }
    if (_historyCache.key === key && _historyCache.rows) { setRows(_historyCache.rows); return; }
    let cancelled = false;
    supabaseData.from("project_snapshots")
      .select("project_id,snapshot_month,available_units,sold_units,reserved_units,avg_price_eur_m2,district,developer")
      .order("snapshot_month", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error("[useProjectHistory]", error); return; }
        _historyCache = { key, rows: data || [] };
        setRows(_historyCache.rows);
      });
    return () => { cancelled = true; };
  }, [user?.id]);
  return rows;
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════
export default function DashboardHome({ lang = "en", setCurrent }) {
  useCurrency(); // re-render prices when the display currency toggles
  const { profile } = useAuth();
  const caps = useCapabilities();
  const { can, trialActive, trialDaysLeft, canStartTrial } = caps;
  const { country } = useCountry();

  const { projects } = useProjects();
  const marketTotals = useMarketTotals();
  const velocityMature = useVelocityMature();
  const { districts } = useDistrictTotals();
  const snapshots = useProjectHistory();
  const freshness = useFreshness(); // last data date (YYYY-MM-DD) — data refreshes daily
  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(localeTag(lang), { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };

  const { config, loading: cfgLoading, saveState, setConfig, resetToDefault } = useDashboardConfig();

  // trial banner (free users who never started their 7-day trial) — single
  // source of truth so this matches every other trial surface exactly.
  const showTrialOffer = canStartTrial;
  const trialOffer = useActivateTrial({ lang, onConsumed: () => setCurrent("App:Billing") });

  // ── modal state: add-widget palette / configure widget ──
  const [editor, setEditor] = useState(null); // { mode:'add'|'edit', widget }
  const [confirmReset, setConfirmReset] = useState(false);

  const ctx = { marketTotals, districts, projects, snapshots, lang, can, setCurrent };

  // Snapshot series lookup: project_id → months asc → row
  const seriesByProject = useMemo(() => {
    const m = new Map();
    for (const r of (snapshots || [])) {
      if (!m.has(r.project_id)) m.set(r.project_id, []);
      m.get(r.project_id).push(r);
    }
    for (const arr of m.values()) arr.sort((a, b) => String(a.snapshot_month).localeCompare(String(b.snapshot_month)));
    return m;
  }, [snapshots]);
  ctx.seriesByProject = seriesByProject;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const name = (profile?.full_name || "").split(" ")[0] || "";
    const word = lang === "sk"
      ? (hour < 11 ? "Dobré ráno" : hour < 17 ? "Ahoj" : "Dobrý večer")
      : (hour < 11 ? "Good morning" : hour < 17 ? "Hey" : "Good evening");
    return name ? `${word}, ${name}.` : `${word}.`;
  }, [profile?.full_name, lang]);

  // ── Zone A · Market Overview filters (persisted in config.overview.filters) ──
  // Same composable filter engine as the Map / Projects list (applyFilters over
  // projects_live). Conditions AND together; the KPI strip is computed live from
  // the matching subset — any dimension, not a single pre-baked district.
  const conditions = config?.overview?.filters || [];
  const setConditions = (next) => setConfig(c => {
    const value = typeof next === "function" ? next(c.overview?.filters || []) : next;
    return { ...c, overview: { ...c.overview, filters: value } };
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const activeConds = useMemo(() => (conditions || []).filter(isComplete), [conditions]);

  // Base set: active projects by default; if the user added a "Availability"
  // (status) condition, filter over ALL projects so they can explicitly pull in
  // sold-out / paused. Then apply the rest of their conditions.
  const overviewProjects = useMemo(() => {
    const hasStatus = activeConds.some(c => c.field === "status");
    const base = hasStatus ? (projects || []) : (projects || []).filter(p => (p.status || "active") === "active");
    return applyFilters(base, activeConds);
  }, [projects, activeConds]);
  const overviewAgg = useMemo(() => aggregateProjects(overviewProjects), [overviewProjects]);
  const overviewIds = useMemo(() => new Set(overviewProjects.map(p => p.id)), [overviewProjects]);

  const kpiMetrics = ["available", "avg_m2", "sold30", "sold_through", "reserved", "inventory", "projects", "developers"];

  // ── widget mutations ──
  const widgets = config?.widgets || [];
  const addWidget = (w) => { setConfig(c => ({ ...c, widgets: [...c.widgets, { ...w, id: newWidgetId() }] })); setEditor(null); };
  const updateWidget = (id, w) => { setConfig(c => ({ ...c, widgets: c.widgets.map(x => x.id === id ? { ...x, ...w } : x) })); setEditor(null); };
  const removeWidget = (id) => setConfig(c => ({ ...c, widgets: c.widgets.filter(x => x.id !== id) }));
  const toggleWidth = (id) => setConfig(c => ({ ...c, widgets: c.widgets.map(x => x.id === id ? { ...x, w: x.w === 2 ? 1 : 2 } : x) }));
  const moveWidget = (id, dir) => setConfig(c => {
    const arr = [...c.widgets]; const i = arr.findIndex(x => x.id === id);
    const j = i + dir; if (i < 0 || j < 0 || j >= arr.length) return c;
    [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...c, widgets: arr };
  });
  // drag reorder
  const dragId = useRef(null);
  const onDrop = (targetId) => {
    const from = dragId.current; dragId.current = null;
    if (!from || from === targetId) return;
    setConfig(c => {
      const arr = [...c.widgets];
      const fi = arr.findIndex(x => x.id === from), ti = arr.findIndex(x => x.id === targetId);
      if (fi < 0 || ti < 0) return c;
      const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m); return { ...c, widgets: arr };
    });
  };

  return (
    <div>
      {/* ═══ HERO BAND — greeting + market overview, a distinct tinted zone ═══ */}
      <div style={{ position: "relative", padding: "1.75rem 2rem 1.9rem", borderBottom: "1px solid var(--border)", background: "radial-gradient(130% 150% at 2% -10%, rgba(18,185,129,0.13) 0%, transparent 44%), radial-gradient(120% 130% at 100% 0%, rgba(59,116,232,0.08) 0%, transparent 42%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--surface)) 0%, var(--bg) 72%)" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3, background: "linear-gradient(90deg, var(--accent), #3b74e8 55%, #8b5cf6)" }} />
        <div style={{ maxWidth: 1280 }}>
      {/* Greeting + freshness line */}
      <h2 style={{ fontSize: "1.5rem", fontWeight: 600, color: textLight, margin: "0 0 0.2rem" }}>{greeting}</h2>
      <p style={{ color: dim, fontSize: "0.9rem", lineHeight: 1.55, margin: "0 0 1.4rem" }}>
        {lang === "sk"
          ? <>Tvoj osobný prehľad trhu novostavieb. Dáta sa obnovujú <strong style={{ color: textLight }}>každý deň</strong>{freshness ? <> — naposledy aktualizované <strong style={{ color: textLight }}>{fmtDate(freshness)}</strong></> : null}.</>
          : <>Your personal new-build market overview. Data refreshes <strong style={{ color: textLight }}>daily</strong>{freshness ? <> — last updated <strong style={{ color: textLight }}>{fmtDate(freshness)}</strong></> : null}.</>}
      </p>

      {showTrialOffer && <TrialOfferBanner lang={lang} onActivate={trialOffer.start} busy={trialOffer.busy} msg={trialOffer.msg} />}
      {trialActive && <TrialRunningBanner lang={lang} daysLeft={trialDaysLeft} onOpenBilling={() => setCurrent("App:Billing")} />}

      {/* ═══ ZONE A · Market overview ═══ */}
      <section style={{ marginBottom: "2.25rem", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap", marginBottom: "0.85rem" }}>
          <div style={{ width: 3, height: 14, borderRadius: 2, background: "var(--accent)", flexShrink: 0 }} />
          <div style={{ fontFamily: mono, fontSize: "0.68rem", color: accentInk, letterSpacing: "0.12em", textTransform: "uppercase", marginRight: "0.15rem" }}>
            {L(lang, "Prehľad trhu", "Market overview")}
            <span style={{ color: dim, marginLeft: "0.55rem", textTransform: "none", letterSpacing: 0 }}>
              · {isAllCountries(country) ? L(lang, "všetky trhy", "all markets") : countryName(country, lang)}
              {" · "}<strong style={{ color: textLight }}>{fmtCount(overviewProjects.length, lang)}</strong> {L(lang, "projektov", "projects")}
            </span>
          </div>
          {/* Filters — the exact same builder as the Map / Projects list */}
          <button onClick={() => setFilterOpen(o => !o)} style={filterChip(filterOpen || activeConds.length > 0)}>
            ⚙ {L(lang, "Filtre", "Filters")}{activeConds.length ? ` · ${activeConds.length}` : ""}
          </button>
          {activeConds.map(c => (
            <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: `color-mix(in srgb, var(--accent) 8%, transparent)`, color: accentInk, border: `1px solid color-mix(in srgb, var(--accent) 25%, transparent)`, borderRadius: 999, padding: "4px 9px", fontSize: "0.7rem", maxWidth: 260 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describe(c, lang === "sk")}</span>
              <span onClick={() => setConditions(cs => cs.filter(x => x.id !== c.id))} style={{ cursor: "pointer", flexShrink: 0 }}>×</span>
            </span>
          ))}
          {activeConds.length > 0 && (
            <button onClick={() => setConditions([])} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.72rem", fontFamily: mono }}>{L(lang, "vyčistiť", "clear")}</button>
          )}
        </div>

        {filterOpen && (
          <MapFilterBuilder asModal conditions={conditions} setConditions={setConditions}
            projects={(projects || [])} matchCount={overviewProjects.length} totalCount={(projects || []).length}
            sk={lang === "sk"} onClose={() => setFilterOpen(false)} />
        )}

        <div className="dash-kpi-grid" style={{ display: "grid", gap: "0.7rem" }}>
          {kpiMetrics.map(mk => {
            const def = METRICS[mk];
            const locked = def.requires && !can(def.requires);
            const gateVelocity = mk === "sold30" && !velocityMature;
            const raw = aggMetric(overviewAgg, mk);
            // In the KPI strip the "/m²" lives in the label, so the value drops the
            // suffix (just "5 104 €") — keeps the number readable in a narrow card.
            // locked → render a FAKE placeholder, never the real paid figure
            // (KpiCard's blur is cosmetic, not security — the true number must
            // not reach the DOM). Same masking MetricBody uses.
            const value = locked ? "12 345"
              : gateVelocity ? "—"
              : mk === "sold30" ? (raw == null ? "—" : raw > 0 ? `+${fmtCount(raw, lang)}` : "0")
              : mk === "avg_m2" ? (raw != null ? `${Math.round(moneyFromEur(raw)).toLocaleString(localeTag(lang))} ${moneySymbol()}` : "—")
              : fmtMetric(mk, raw, lang);
            const delta = (!locked && !gateVelocity && MOM_METRICS.has(mk)) ? aggMomDelta(mk, overviewIds, snapshots) : null;
            return (
              <KpiCard key={mk}
                label={def.label[lang] || def.label.en}
                value={value}
                hint={gateVelocity ? L(lang, "zbierame históriu", "building history") : (def.hint?.[lang] || def.hint?.en)}
                delta={delta} lang={lang}
                accent={def.accent || textLight}
                icon={KPI_ICON[mk]}
                locked={locked && !gateVelocity} />
            );
          })}
        </div>
      </section>
        </div>
      </div>
      {/* ═══ CANVAS — my dashboard on the plain workspace ═══ */}
      <div style={{ padding: "1.6rem 2rem 4rem", maxWidth: 1280 }}>
      {/* ═══ ZONE B · My dashboard ═══ */}
      <section>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "0.95rem" }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: "0.68rem", color: accentInk, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              {L(lang, "Môj dashboard", "My dashboard")}
              <SavePill saveState={saveState} lang={lang} />
            </div>
            {widgets.length > 0 && (
              <div style={{ fontSize: "0.72rem", color: faint, marginTop: "0.4rem" }}>
                {L(lang, "Ťahaj karty pre presun · ⋯ pre nastavenia · zmeny sa ukladajú samé",
                      "Drag cards to reorder · ⋯ for options · changes save automatically")}
              </div>
            )}
          </div>
          <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
            <button onClick={() => setEditor({ mode: "add" })}
              style={{ background: green, color: "#06140f", border: "none", borderRadius: 8, padding: "0.5rem 0.95rem", fontWeight: 700, fontFamily: mono, fontSize: "0.76rem", cursor: "pointer" }}>
              + {L(lang, "Pridať widget", "Add widget")}
            </button>
            {confirmReset ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ fontSize: "0.72rem", color: dim, fontFamily: mono }}>{L(lang, "Obnoviť predvolené?", "Reset to default?")}</span>
                <button onClick={() => { resetToDefault(); setConfirmReset(false); }}
                  style={{ background: "transparent", color: "#ff8a8a", border: "1px solid #ff8a8a55", borderRadius: 8, padding: "0.45rem 0.7rem", fontFamily: mono, fontSize: "0.72rem", cursor: "pointer" }}>
                  {L(lang, "Áno", "Yes")}
                </button>
                <button onClick={() => setConfirmReset(false)}
                  style={{ background: "transparent", color: dim, border: `1px solid ${border}`, borderRadius: 8, padding: "0.45rem 0.7rem", fontFamily: mono, fontSize: "0.72rem", cursor: "pointer" }}>
                  {L(lang, "Nie", "No")}
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmReset(true)}
                title={L(lang, "Obnoviť predvolené", "Reset to default")}
                style={{ background: "transparent", color: dim, border: `1px solid ${border}`, borderRadius: 8, padding: "0.5rem 0.8rem", fontFamily: mono, fontSize: "0.74rem", cursor: "pointer" }}>
                {L(lang, "Obnoviť", "Reset")}
              </button>
            )}
          </div>
        </div>

        {cfgLoading ? (
          <div style={{ color: dim, fontFamily: mono, fontSize: "0.8rem", padding: "1rem 0" }}>{L(lang, "Načítavam…", "Loading…")}</div>
        ) : widgets.length === 0 ? (
          <EmptyState lang={lang} onAdd={() => setEditor({ mode: "add" })} />
        ) : (
          <div className="dash-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.9rem" }}>
            {widgets.map((w, i) => (
              <div key={w.id}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(w.id)}
                style={{ gridColumn: w.w === 2 ? "span 2" : "span 1", minWidth: 0 }}
                className="dash-cell">
                <WidgetCard
                  widget={w} ctx={ctx} lang={lang}
                  first={i === 0} last={i === widgets.length - 1}
                  dragProps={{ draggable: true, onDragStart: () => { dragId.current = w.id; }, onDragEnd: () => { dragId.current = null; } }}
                  onConfigure={() => setEditor({ mode: "edit", widget: w })}
                  onRemove={() => removeWidget(w.id)}
                  onToggleWidth={() => toggleWidth(w.id)}
                  onMove={dir => moveWidget(w.id, dir)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {editor && (
        <WidgetEditor
          mode={editor.mode} widget={editor.widget} ctx={ctx} lang={lang}
          onClose={() => setEditor(null)}
          onAdd={addWidget}
          onSave={w => updateWidget(editor.widget.id, w)}
        />
      )}

      <style>{`
        .dash-kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        @media (max-width: 1100px) { .dash-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 720px) {
          .dash-grid { grid-template-columns: 1fr !important; }
          .dash-cell { grid-column: span 1 !important; }
        }
        @media (max-width: 460px) { .dash-kpi-grid { grid-template-columns: 1fr; } }
      `}</style>
      </div>
    </div>
  );
}

// ─── save indicator ────────────────────────────────────────────
function SavePill({ saveState, lang }) {
  if (saveState === "idle") return null;
  const map = {
    saving: { t: L(lang, "ukladám…", "saving…"), c: dim },
    saved:  { t: L(lang, "uložené ✓", "saved ✓"), c: green },
    error:  { t: L(lang, "chyba ukladania", "save failed"), c: "#ff6b6b" },
  };
  const s = map[saveState]; if (!s) return null;
  return <span style={{ marginLeft: "0.7rem", fontFamily: mono, fontSize: "0.62rem", color: s.c, textTransform: "none", letterSpacing: 0 }}>{s.t}</span>;
}

// ─── empty state ───────────────────────────────────────────────
function EmptyState({ lang, onAdd }) {
  return (
    <div style={{ border: `1px dashed ${border}`, borderRadius: 12, padding: "2.5rem 1.5rem", textAlign: "center", background: bg }}>
      <div style={{ fontSize: "1.6rem", marginBottom: "0.6rem" }}>🧩</div>
      <div style={{ color: textLight, fontWeight: 600, fontSize: "1rem", marginBottom: "0.35rem" }}>
        {L(lang, "Zostav si vlastný dashboard", "Build your own dashboard")}
      </div>
      <p style={{ color: dim, fontSize: "0.85rem", lineHeight: 1.55, maxWidth: 440, margin: "0 auto 1.1rem" }}>
        {L(lang, "Pridaj si widgety ktoré ťa zaujímajú — sledované projekty, ceny /m² po častiach mesta, rebríčky, trendy. Zostanú ti tu natrvalo.",
              "Add the widgets you care about — watched projects, €/m² by district, leaderboards, trends. They stay here for good.")}
      </p>
      <button onClick={onAdd} style={{ background: green, color: "#06140f", border: "none", borderRadius: 8, padding: "0.6rem 1.2rem", fontWeight: 700, fontFamily: mono, fontSize: "0.8rem", cursor: "pointer" }}>
        + {L(lang, "Pridať prvý widget", "Add your first widget")}
      </button>
    </div>
  );
}

// ─── trial banners ─────────────────────────────────────────────
function TrialOfferBanner({ lang, onActivate, busy, msg }) {
  return (
    <div style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 14%, transparent) 0%, color-mix(in srgb, var(--accent) 4%, transparent) 70%, transparent 100%)", border: `1px solid ${green}`, borderRadius: 12, padding: "0.95rem 1.2rem", marginBottom: "1.4rem", display: "flex", alignItems: "center", gap: "0.95rem", flexWrap: "wrap" }}>
      <div style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 8, background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: accentInk, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.05rem" }}>🎁</div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ color: textLight, fontWeight: 700, fontSize: "0.95rem" }}>{L(lang, "7 dní plného Residata — zadarmo", "7 days of the full Residata — on us")}</div>
        <div style={{ color: dim, fontSize: "0.8rem", marginTop: "0.15rem", lineHeight: 1.45 }}>{L(lang, "Všetky projekty, analytika, reporty, exporty. Bez karty. Jedným klikom.", "Every project, analytics, reports, exports. No card required. One-click.")}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem" }}>
        <button onClick={onActivate} disabled={busy} className="btn-p" style={{ fontSize: "0.82rem", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>{busy ? "…" : L(lang, "Aktivovať trial", "Activate trial")}</button>
        {msg && <span style={{ fontSize: "0.72rem", fontFamily: mono, color: msg.kind === "ok" ? green : "#ff6b6b" }}>{msg.text}</span>}
      </div>
    </div>
  );
}
function TrialRunningBanner({ lang, daysLeft, onOpenBilling }) {
  const ending = daysLeft <= 2; const accent = ending ? orange : green;
  return (
    <div style={{ background: ending ? "rgba(245,166,35,0.12)" : "color-mix(in srgb, var(--accent) 12%, transparent)", border: `1px solid color-mix(in srgb, var(--accent) 38%, transparent)`, borderRadius: 12, padding: "0.8rem 1.1rem", marginBottom: "1.4rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", fontSize: "0.85rem" }}>
      <span style={{ fontSize: "1.05rem" }}>🎁</span>
      <span style={{ color: textLight, fontWeight: 600 }}>
        {lang === "sk" ? <>Paid trial aktívny — <span style={{ color: accent }}>{daysLeft <= 0 ? "posledný deň" : `${daysLeft} dní zostáva`}</span></> : <>Paid trial active — <span style={{ color: accent }}>{daysLeft <= 0 ? "last day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</span></>}
      </span>
      <button onClick={onOpenBilling} style={{ marginLeft: "auto", background: "transparent", color: accent, border: `1px solid ${accent}`, borderRadius: 6, padding: "0.35rem 0.8rem", fontSize: "0.75rem", fontFamily: mono, fontWeight: 700, cursor: "pointer" }}>{L(lang, "Detail / upgrade", "Details / upgrade")}</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Widget card shell + toolbar
// ═══════════════════════════════════════════════════════════════
const WIDGET_META = {
  metric:    { icon: "▦", title: { sk: "Metrika", en: "Metric" } },
  project:   { icon: "★", title: { sk: "Sledovaný projekt", en: "Watched project" } },
  ranking:   { icon: "≡", title: { sk: "Rebríček", en: "Leaderboard" } },
  benchmark: { icon: "▤", title: { sk: "Ceny /m²", en: "Price benchmark" } },
  trend:     { icon: "◠", title: { sk: "Trend", en: "Trend" } },
  segment:   { icon: "◪", title: { sk: "Zhrnutie oblasti", en: "Area summary" } },
};

// A DESCRIPTIVE header title — "metric of what". Instead of a generic "Metric" /
// "Leaderboard", show exactly what the card displays: "Available · whole market",
// "Top 5 projects · Sold 30d", "€/m² by district", the project name, etc.
function widgetTitle(w, ctx, lang) {
  const { projects, districts } = ctx;
  const cfg = w.cfg || {};
  const projName = (id) => (projects || []).find(p => p.id === id)?.name;
  const distLabel = (city, district) => {
    const r = (districts || []).find(d => d.district === district && String(d.city_id) === String(city));
    return r ? `${district}${r.city_name ? ` · ${r.city_name}` : ""}` : district;
  };
  switch (w.type) {
    case "metric": {
      const m = METRICS[cfg.metric];
      return m ? `${m.label[lang] || m.label.en} · ${scopeLabel(cfg.scope, lang)}` : L(lang, "Metrika", "Metric");
    }
    case "project": return projName(cfg.projectId) || L(lang, "Sledovaný projekt", "Watched project");
    case "trend": {
      const s = TREND_SERIES[cfg.series] || TREND_SERIES.available;
      const pn = projName(cfg.projectId);
      return pn ? `${pn} · ${s.label[lang] || s.label.en}` : L(lang, "Trend projektu", "Project trend");
    }
    case "benchmark": {
      const byL = cfg.by === "developer" ? L(lang, "developera", "developer") : L(lang, "časti mesta", "district");
      return `${moneySymbol()}/m² ${L(lang, "podľa", "by")} ${byL}`;
    }
    case "ranking": {
      const entL = { projects: L(lang, "projekty", "projects"), districts: L(lang, "časti mesta", "districts"), developers: L(lang, "developeri", "developers") }[cfg.entity || "projects"];
      const md = (RANK_METRICS[cfg.entity] || RANK_METRICS.projects)[cfg.metric];
      const mL = md ? (md.label[lang] || md.label.en) : "";
      const dir = cfg.dir === "bottom" ? L(lang, "Najnižšie", "Bottom") : "Top";
      return `${dir} ${cfg.n || 5} ${entL} · ${mL}`;
    }
    case "segment": return cfg.district ? distLabel(cfg.city, cfg.district) : L(lang, "Zhrnutie oblasti", "Area summary");
    default: return w.type;
  }
}

function WidgetCard({ widget, ctx, lang, first, last, dragProps, onConfigure, onRemove, onToggleWidth, onMove }) {
  const [hover, setHover] = useState(false);
  const meta = WIDGET_META[widget.type] || { icon: "▦", title: { sk: widget.type, en: widget.type } };
  const title = widgetTitle(widget, ctx, lang);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: bg, border: `1px solid ${hover ? "var(--border-soft)" : border}`, borderRadius: 12, height: "100%", boxSizing: "border-box", transition: "border-color 0.15s", display: "flex", flexDirection: "column" }}>
      {/* header — drag handle + icon + DESCRIPTIVE title on the left; ⋯ menu on
          the right. Only the header is draggable, so clicks inside the body
          (leaderboard rows, project cards) never start an accidental drag. */}
      <div {...dragProps}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem",
          padding: "0.62rem 0.7rem 0.62rem 0.85rem", borderBottom: `1px solid ${border}`, cursor: "grab" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
          <span title={L(lang, "Ťahaj pre presun", "Drag to reorder")} style={{ color: hover ? dim : faint, fontSize: "0.8rem", lineHeight: 1, letterSpacing: "-2px", transition: "color 0.15s", flexShrink: 0 }}>⠿</span>
          <span style={{ color: accentInk, fontSize: "0.8rem", flexShrink: 0 }}>{meta.icon}</span>
          <span title={title} style={{ fontSize: "0.82rem", fontWeight: 600, color: textLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </div>
        <WidgetMenu lang={lang} widget={widget} first={first} last={last}
          onConfigure={onConfigure} onToggleWidth={onToggleWidth} onMove={onMove} onRemove={onRemove} />
      </div>
      {/* body */}
      <div style={{ padding: "0.9rem 1.05rem 1rem", flex: 1 }}>
        <WidgetBody widget={widget} ctx={ctx} lang={lang} />
      </div>
    </div>
  );
}

// Always-visible "⋯" overflow menu — the discoverable home for every widget
// action (configure / resize / reorder / remove). Replaces the old cryptic
// hover-only glyph toolbar.
function WidgetMenu({ lang, widget, first, last, onConfigure, onToggleWidth, onMove, onRemove }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button aria-label={L(lang, "Možnosti widgetu", "Widget options")} onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        onMouseDown={e => e.stopPropagation()}
        style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", background: open ? "var(--surface-2)" : "transparent", border: `1px solid ${open ? border : "transparent"}`, borderRadius: 7, color: dim, cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}
        onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = textLight; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = dim; }}>⋯</button>
      {open && (
        <>
          <div onClick={close} onMouseDown={e => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div onMouseDown={e => e.stopPropagation()} style={{ position: "absolute", right: 0, top: "calc(100% + 5px)", zIndex: 41, minWidth: 184, background: "var(--surface)", border: "1px solid #23232a", borderRadius: 11, boxShadow: "0 20px 52px rgba(0,0,0,0.72)", padding: "0.35rem", cursor: "default" }}>
            <MenuItem icon="⚙" onClick={() => { onConfigure(); close(); }}>{L(lang, "Nastaviť", "Configure")}</MenuItem>
            <MenuItem icon={widget.w === 2 ? "▭" : "▬"} onClick={() => { onToggleWidth(); close(); }}>{widget.w === 2 ? L(lang, "Na polovicu", "Half width") : L(lang, "Na celú šírku", "Full width")}</MenuItem>
            <MenuItem icon="↑" disabled={first} onClick={() => { onMove(-1); close(); }}>{L(lang, "Posunúť vyššie", "Move up")}</MenuItem>
            <MenuItem icon="↓" disabled={last} onClick={() => { onMove(1); close(); }}>{L(lang, "Posunúť nižšie", "Move down")}</MenuItem>
            <div style={{ height: 1, background: border, margin: "0.3rem 0.15rem" }} />
            <MenuItem icon="🗑" danger onClick={() => { onRemove(); close(); }}>{L(lang, "Odstrániť", "Remove")}</MenuItem>
          </div>
        </>
      )}
    </div>
  );
}
function MenuItem({ icon, children, onClick, disabled, danger }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ display: "flex", alignItems: "center", gap: "0.6rem", width: "100%", textAlign: "left", padding: "0.5rem 0.6rem", background: "transparent", border: "none", borderRadius: 7, cursor: disabled ? "default" : "pointer", color: disabled ? faint : (danger ? "#ff8a8a" : textLight), fontFamily: "inherit", fontSize: "0.82rem" }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = danger ? "rgba(255,107,107,0.1)" : "var(--surface-2)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
      <span style={{ width: 16, textAlign: "center", fontSize: "0.8rem", opacity: 0.9 }}>{icon}</span>
      <span>{children}</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// Widget bodies
// ═══════════════════════════════════════════════════════════════
function WidgetBody({ widget, ctx, lang }) {
  switch (widget.type) {
    case "metric":    return <MetricBody cfg={widget.cfg} ctx={ctx} lang={lang} />;
    case "project":   return <ProjectBody cfg={widget.cfg} ctx={ctx} lang={lang} />;
    case "ranking":   return <RankingBody cfg={widget.cfg} ctx={ctx} lang={lang} />;
    case "benchmark": return <BenchmarkBody cfg={widget.cfg} ctx={ctx} lang={lang} />;
    case "trend":     return <TrendBody cfg={widget.cfg} ctx={ctx} lang={lang} />;
    case "segment":   return <SegmentBody cfg={widget.cfg} ctx={ctx} lang={lang} />;
    default:          return <Muted lang={lang} />;
  }
}
const Muted = ({ lang, text }) => <div style={{ color: faint, fontFamily: mono, fontSize: "0.75rem" }}>{text || L(lang, "Nastav tento widget ⚙", "Configure this widget ⚙")}</div>;

function MetricBody({ cfg, ctx, lang }) {
  const { can } = ctx;
  const def = METRICS[cfg.metric]; if (!def) return <Muted lang={lang} />;
  const locked = def.requires && !can(def.requires);
  const raw = metricValue(cfg.metric, cfg.scope, ctx);
  const scopeKind = cfg.scope?.kind || "market";
  const delta = (!locked && MOM_METRICS.has(cfg.metric) && scopeKind !== "district") ? momDelta(cfg.metric, cfg.scope, ctx) : null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
        <div style={{ fontFamily: mono, fontSize: "1.95rem", fontWeight: 700, color: def.accent || textLight, letterSpacing: "-0.02em", lineHeight: 1, filter: locked ? "blur(6px)" : "none", opacity: locked ? 0.55 : 1 }}>
          {locked ? "12 345" : fmtMetric(cfg.metric, raw, lang)}
        </div>
        {!locked && <DeltaChip delta={delta} lang={lang} />}
      </div>
      <div style={{ fontFamily: mono, fontSize: "0.66rem", color: dim, marginTop: "0.55rem" }}>
        {locked ? <span style={{ color: orange }}>{L(lang, "len pre paid", "paid only")}</span>
          : <>{def.label[lang] || def.label.en} · {scopeLabel(cfg.scope, lang)} · <span style={{ color: faint }}>{def.hint?.[lang] || def.hint?.en}</span></>}
      </div>
    </div>
  );
}

function ProjectBody({ cfg, ctx, lang }) {
  const { projects, seriesByProject, setCurrent, can } = ctx;
  const p = (projects || []).find(x => x.id === cfg.projectId);
  if (!p) return <Muted lang={lang} text={L(lang, "Projekt nenájdený — vyber iný ⚙", "Project not found — pick another ⚙")} />;
  const series = (seriesByProject.get(p.id) || []).map(r => r.available_units);
  const soldLocked = !can("view_sold_velocity");
  return (
    <div role="button" tabIndex={0} onClick={() => setCurrent(`App:ProjectDetail:${p.id}`)}
      onKeyDown={e => { if (e.key === "Enter") setCurrent(`App:ProjectDetail:${p.id}`); }}
      style={{ cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: textLight, fontSize: "0.98rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
          <div style={{ fontFamily: mono, fontSize: "0.68rem", color: dim, marginTop: 2 }}>{p.district || "—"}{p.developer ? ` · ${p.developer}` : ""}</div>
        </div>
        <Sparkline series={series} color={green} width={92} height={30} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: "0.5rem", marginTop: "0.85rem" }}>
        <MiniStat label={L(lang, "Voľné", "Avail")} value={fmtCount(p.available_units, lang)} accent={green} />
        <MiniStat label={L(lang, "Predané", "Sold")} value={p.sold_percentage != null ? `${Math.round(p.sold_percentage)}%` : "—"} />
        <MiniStat label={`${moneySymbol()}/m²`} value={p.avg_price_eur_m2 ? Math.round(moneyFromEur(p.avg_price_eur_m2)).toLocaleString(localeTag(lang)) : "—"} />
        <MiniStat label={L(lang, "30d", "30d")} value={soldLocked ? "🔒" : (p.sold_last_month == null ? "—" : p.sold_last_month > 0 ? `+${p.sold_last_month}` : "0")} accent={orange} />
      </div>
    </div>
  );
}
function MiniStat({ label, value, accent = textLight }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: mono, fontSize: "1.02rem", fontWeight: 700, color: accent, lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontFamily: mono, fontSize: "0.56rem", color: dim, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: "0.3rem" }}>{label}</div>
    </div>
  );
}

// leaderboard
const RANK_METRICS = {
  projects: {
    available:  { label: { sk: "Voľné byty", en: "Available" }, get: p => p.available_units, fmt: "count" },
    sold30:     { label: { sk: "Predaj 30d", en: "Sold 30d" }, get: p => p.sold_last_month, fmt: "count", requires: "view_sold_velocity" },
    avg_m2:     { label: { sk: "Cena /m²", en: "Price /m²" }, get: p => p.avg_price_eur_m2, fmt: "m2" },
    sold_pct:   { label: { sk: "% predané", en: "% sold" }, get: p => p.sold_percentage, fmt: "pct" },
  },
  districts: {
    available:   { label: { sk: "Voľné byty", en: "Available" }, get: d => d.available_units, fmt: "count" },
    avg_m2:      { label: { sk: "Cena /m²", en: "Price /m²" }, get: d => d.avg_eur_m2, fmt: "m2" },
    sold_total:  { label: { sk: "Predané", en: "Sold" }, get: d => d.sold_units, fmt: "count" },
    sold_through:{ label: { sk: "Vypredanosť", en: "Sold-through" }, get: d => { const den = (d.sold_units || 0) + (d.available_units || 0) + (d.reserved_units || 0); return den ? (d.sold_units || 0) / den * 100 : null; }, fmt: "pct" },
    projects:    { label: { sk: "Projekty", en: "Projects" }, get: d => d.project_count, fmt: "count" },
  },
  developers: {
    available:   { label: { sk: "Voľné byty", en: "Available" }, get: a => a.avail, fmt: "count" },
    sold30:      { label: { sk: "Predaj 30d", en: "Sold 30d" }, get: a => a.sold30, fmt: "count", requires: "view_sold_velocity" },
    sold_through:{ label: { sk: "Vypredanosť", en: "Sold-through" }, get: a => { const den = a.sold + a.avail + a.reserved; return den ? a.sold / den * 100 : null; }, fmt: "pct" },
    projects:    { label: { sk: "Projekty", en: "Projects" }, get: a => a.projects, fmt: "count" },
    avg_m2:      { label: { sk: "Cena /m²", en: "Price /m²" }, get: a => a.avg, fmt: "m2" },
  },
};
function fmtRankVal(fmt, v, lang) {
  if (v == null) return "—";
  if (fmt === "m2") return fmtM2(v, lang);
  if (fmt === "pct") return `${Math.round(v)}%`;
  return fmtCount(v, lang);
}
function RankingBody({ cfg, ctx, lang }) {
  const { projects, districts, can, setCurrent } = ctx;
  const entity = cfg.entity || "projects";
  const mdef = (RANK_METRICS[entity] || RANK_METRICS.projects)[cfg.metric] || Object.values(RANK_METRICS[entity])[0];
  const locked = mdef.requires && !can(mdef.requires);
  const dir = cfg.dir || "top"; const n = cfg.n || 5;

  let rows = [];
  if (entity === "projects") {
    rows = (projects || []).filter(p => (p.status || "active") === "active" && mdef.get(p) != null)
      .map(p => ({ key: p.id, name: p.name, sub: p.district || "—", val: mdef.get(p), clickId: p.id }));
  } else if (entity === "districts") {
    rows = (districts || []).filter(d => d.district && mdef.get(d) != null)
      .map(d => ({ key: `${d.city_id}:${d.district}`, name: d.district, sub: d.city_name || "—", val: mdef.get(d) }));
  } else {
    const byDev = new Map();
    for (const p of (projects || [])) { if (p.developer && (p.status || "active") === "active") { if (!byDev.has(p.developer)) byDev.set(p.developer, developerAgg(projects, p.developer)); } }
    rows = [...byDev.entries()].filter(([, a]) => mdef.get(a) != null)
      .map(([name, a]) => ({ key: name, name, sub: `${a.projects} ${L(lang, "proj.", "proj")}`, val: mdef.get(a) }));
  }
  // locked → replace real names+values with fake placeholder rows (the blur
  // below is cosmetic, not security — real leaderboard data must not reach the
  // DOM). Mirrors MetricBody's fake-value masking.
  if (locked) {
    rows = Array.from({ length: n }, (_, i) => ({ key: `locked-${i}`, name: "••••••••", sub: "••••", val: (n - i) * 10 }));
  } else {
    rows.sort((a, b) => dir === "top" ? b.val - a.val : a.val - b.val);
    rows = rows.slice(0, n);
  }

  if (rows.length === 0) return <Muted lang={lang} text={L(lang, "Žiadne dáta", "No data")} />;
  const max = Math.max(...rows.map(r => Math.abs(r.val) || 0)) || 1;
  return (
    <div style={{ filter: locked ? "blur(6px)" : "none", opacity: locked ? 0.6 : 1 }}>
      {rows.map((r, i) => (
        <div key={r.key} role={r.clickId ? "button" : undefined} tabIndex={r.clickId ? 0 : undefined}
          onClick={r.clickId ? () => setCurrent(`App:ProjectDetail:${r.clickId}`) : undefined}
          style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.32rem 0", cursor: r.clickId ? "pointer" : "default", borderBottom: i < rows.length - 1 ? `1px solid ${border}55` : "none" }}>
          <span style={{ fontFamily: mono, fontSize: "0.66rem", color: faint, width: 14, flexShrink: 0 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.82rem", color: textLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
            <div style={{ position: "relative", height: 3, background: `${border}`, borderRadius: 2, marginTop: 4 }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(4, (Math.abs(r.val) / max) * 100)}%`, background: green, borderRadius: 2, opacity: 0.7 }} />
            </div>
          </div>
          <span style={{ fontFamily: mono, fontSize: "0.78rem", fontWeight: 700, color: textLight, flexShrink: 0 }}>{fmtRankVal(mdef.fmt, r.val, lang)}</span>
        </div>
      ))}
    </div>
  );
}

// price benchmark (bar list)
function BenchmarkBody({ cfg, ctx, lang }) {
  const { districts, projects } = ctx;
  const by = cfg.by || "district"; const n = cfg.n || 8;
  let rows = [];
  if (by === "district") {
    rows = (districts || []).filter(d => d.district && d.avg_eur_m2).map(d => ({ name: d.district, sub: d.city_name, val: d.avg_eur_m2 }));
  } else {
    const byDev = new Map();
    for (const p of (projects || [])) { if (p.developer && (p.status || "active") === "active" && !byDev.has(p.developer)) byDev.set(p.developer, developerAgg(projects, p.developer)); }
    rows = [...byDev.entries()].filter(([, a]) => a.avg != null).map(([name, a]) => ({ name, val: a.avg }));
  }
  rows.sort((a, b) => b.val - a.val); rows = rows.slice(0, n);
  if (rows.length === 0) return <Muted lang={lang} text={L(lang, "Žiadne dáta", "No data")} />;
  const max = Math.max(...rows.map(r => r.val)) || 1;
  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.name + i} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.28rem 0" }}>
          <div style={{ width: "38%", minWidth: 0, fontSize: "0.78rem", color: textLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</div>
          <div style={{ flex: 1, height: 8, background: `${border}`, borderRadius: 3, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(5, (r.val / max) * 100)}%`, background: `linear-gradient(90deg, var(--accent-strong), var(--accent))`, borderRadius: 3 }} />
          </div>
          <div style={{ fontFamily: mono, fontSize: "0.72rem", fontWeight: 700, color: textLight, flexShrink: 0, minWidth: 62, textAlign: "right" }}>{fmtM2(r.val, lang)}</div>
        </div>
      ))}
    </div>
  );
}

// trend (sparkline of a project series over the available months)
const TREND_SERIES = {
  available: { label: { sk: "Voľné byty", en: "Available units" }, get: r => r.available_units, fmt: "count", color: accentInk },
  sold:      { label: { sk: "Predané (spolu)", en: "Sold (total)" }, get: r => r.sold_units, fmt: "count", color: orange },
  avg_m2:    { label: { sk: "Cena /m²", en: "Price /m²" }, get: r => r.avg_price_eur_m2, fmt: "m2", color: blue },
};
const monthShort = (m, lang) => {
  try { const [y, mo] = String(m).split("-"); return new Date(+y, +mo - 1, 1).toLocaleDateString(localeTag(lang), { month: "short" }); }
  catch { return m; }
};
const monthLong = (m, lang) => {
  try { const [y, mo] = String(m).split("-"); return new Date(+y, +mo - 1, 1).toLocaleDateString(localeTag(lang), { month: "short", year: "numeric" }); }
  catch { return m; }
};

// Interactive project trend chart — area + line, month axis, and a hover readout
// (value + month) with a vertical guide. Replaces the bare, label-less, non-
// interactive sparkline in trend widgets (hover/dates/numbers were all missing).
function TrendChart({ rows, sdef, lang }) {
  const [hi, setHi] = useState(null);
  const svgRef = useRef(null);
  const gid = useId();
  const pts = useMemo(() => (rows || [])
    .map(r => ({ m: r.snapshot_month, v: sdef.get(r) }))
    .filter(p => p.v != null && Number.isFinite(Number(p.v)))
    .map(p => ({ m: p.m, v: Number(p.v) })), [rows, sdef]);
  if (pts.length < 2)
    return <div style={{ height: 62, display: "flex", alignItems: "center", color: faint, fontFamily: mono, fontSize: "0.68rem" }}>{L(lang, "Zatiaľ málo histórie na graf", "Not enough history to chart yet")}</div>;
  const W = 300, H = 74, padT = 8, padB = 4;
  const vals = pts.map(p => p.v);
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const X = i => (i / (pts.length - 1)) * W;
  const Y = v => padT + (1 - (v - min) / span) * (H - padT - padB);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${W.toFixed(1)},${(H - padB).toFixed(1)} L0,${(H - padB).toFixed(1)} Z`;
  const onMove = (e) => {
    const r = svgRef.current?.getBoundingClientRect(); if (!r || !r.width) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHi(Math.round(frac * (pts.length - 1)));
  };
  const hp = hi != null ? pts[hi] : null;
  const hpct = hi != null ? (hi / (pts.length - 1)) * 100 : 0;
  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
        onMouseMove={onMove} onMouseLeave={() => setHi(null)}
        style={{ display: "block", overflow: "visible", cursor: "crosshair" }}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sdef.color} stopOpacity="0.26" /><stop offset="100%" stopColor={sdef.color} stopOpacity="0" />
        </linearGradient></defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={sdef.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hp && <line x1={X(hi)} y1={padT} x2={X(hi)} y2={H - padB} stroke={sdef.color} strokeWidth="1" strokeDasharray="2 2" opacity="0.55" vectorEffect="non-scaling-stroke" />}
        {pts.map((p, i) => <circle key={i} cx={X(i)} cy={Y(p.v)} r={hi === i ? 3.4 : 1.8} fill={sdef.color} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: "0.56rem", color: faint, marginTop: 3 }}>
        <span>{monthShort(pts[0].m, lang)}</span>
        {pts.length > 2 && <span>{monthShort(pts[Math.floor((pts.length - 1) / 2)].m, lang)}</span>}
        <span>{monthShort(pts[pts.length - 1].m, lang)}</span>
      </div>
      {hp && (
        <div style={{ position: "absolute", top: -6, left: `${hpct}%`, transform: `translate(${hpct > 80 ? "-100%" : hpct < 20 ? "0" : "-50%"},-100%)`,
          background: "var(--surface)", border: `1px solid ${border}`, borderRadius: 7, padding: "3px 8px", fontFamily: mono, fontSize: "0.66rem",
          color: textLight, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 6px 18px rgba(0,0,0,0.55)", zIndex: 2 }}>
          <span style={{ color: sdef.color, fontWeight: 700 }}>{fmtRankVal(sdef.fmt, hp.v, lang)}</span>
          <span style={{ color: dim }}> · {monthLong(hp.m, lang)}</span>
        </div>
      )}
    </div>
  );
}

function TrendBody({ cfg, ctx, lang }) {
  const { projects, seriesByProject, can, setCurrent } = ctx;
  const locked = !can("view_historical_data");
  const p = (projects || []).find(x => x.id === cfg.projectId);
  if (!p) return <Muted lang={lang} text={L(lang, "Vyber projekt ⚙", "Pick a project ⚙")} />;
  const sdef = TREND_SERIES[cfg.series] || TREND_SERIES.available;
  const rows = seriesByProject.get(p.id) || [];
  const vals = rows.map(sdef.get);
  const first = vals.find(v => v != null), last = [...vals].reverse().find(v => v != null);
  const delta = (first != null && last != null) ? last - first : null;
  const clickable = !locked;
  const open = () => setCurrent(`App:ProjectDetail:${p.id}`);
  return (
    <div role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? open : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter") open(); } : undefined}
      title={clickable ? L(lang, "Otvoriť detail projektu", "Open project detail") : undefined}
      style={{ filter: locked ? "blur(6px)" : "none", opacity: locked ? 0.6 : 1, cursor: clickable ? "pointer" : "default" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: textLight, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
          <div style={{ fontFamily: mono, fontSize: "0.62rem", color: dim }}>{sdef.label[lang] || sdef.label.en} · {rows.length} {L(lang, "mes.", "mo")}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: textLight, lineHeight: 1.1 }}>{fmtRankVal(sdef.fmt, last, lang)}</div>
          {delta != null && delta !== 0 && (
            <div style={{ fontFamily: mono, fontSize: "0.68rem", color: delta > 0 ? green : "#ff6b6b" }}>{delta > 0 ? "▲" : "▼"} {fmtRankVal(sdef.fmt, Math.abs(delta), lang)}</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: "0.6rem" }}><TrendChart rows={rows} sdef={sdef} lang={lang} /></div>
    </div>
  );
}

// district / area summary
function SegmentBody({ cfg, ctx, lang }) {
  const { districts } = ctx;
  const row = (districts || []).find(d => d.district === cfg.district && String(d.city_id) === String(cfg.city));
  if (!row) return <Muted lang={lang} text={L(lang, "Vyber oblasť ⚙", "Pick an area ⚙")} />;
  const stats = [
    { label: L(lang, "Voľné", "Available"), value: fmtCount(row.available_units, lang), accent: green },
    { label: L(lang, "Predané", "Sold"), value: fmtCount(row.sold_units, lang) },
    { label: `${moneySymbol()}/m²`, value: row.avg_eur_m2 ? Math.round(moneyFromEur(row.avg_eur_m2)).toLocaleString(localeTag(lang)) : "—" },
    { label: L(lang, "Rezerv.", "Reserved"), value: fmtCount(row.reserved_units, lang), accent: blue },
    { label: L(lang, "Projekty", "Projects"), value: fmtCount(row.project_count, lang) },
    { label: L(lang, "Spolu", "Total"), value: fmtCount(row.total_units, lang) },
  ];
  return (
    <div>
      <div style={{ fontWeight: 600, color: textLight, fontSize: "0.92rem" }}>{row.district}</div>
      <div style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, marginBottom: "0.7rem" }}>{row.city_name || "—"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem" }}>
        {stats.map(s => <MiniStat key={s.label} label={s.label} value={s.value} accent={s.accent || textLight} />)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Widget editor (add palette + per-type config)
// ═══════════════════════════════════════════════════════════════
const PALETTE = [
  { type: "project",   desc: { sk: "Priebežne sleduj jeden projekt.", en: "Keep one project in view." } },
  { type: "ranking",   desc: { sk: "Top-N projektov / častí / developerov.", en: "Top-N projects / districts / developers." } },
  { type: "benchmark", desc: { sk: "Ceny /m² podľa časti mesta alebo developera.", en: "€/m² by district or developer." } },
  { type: "metric",    desc: { sk: "Jedno číslo pre trh / oblasť / developera.", en: "One number for market / area / developer." } },
  { type: "trend",     desc: { sk: "Vývoj projektu v čase.", en: "A project's trend over time." } },
  { type: "segment",   desc: { sk: "Zhrnutie jednej časti mesta.", en: "Summary of one district." } },
];
const DEFAULT_CFG = {
  project:   () => ({ projectId: "" }),
  ranking:   () => ({ entity: "projects", metric: "available", dir: "top", n: 5 }),
  benchmark: () => ({ by: "district", metric: "avg_m2", n: 8 }),
  metric:    () => ({ metric: "available", scope: { kind: "market" } }),
  trend:     () => ({ projectId: "", series: "available" }),
  segment:   () => ({ district: "", city: "" }),
};

function WidgetEditor({ mode, widget, ctx, lang, onClose, onAdd, onSave }) {
  const [type, setType] = useState(mode === "edit" ? widget.type : null);
  const [cfg, setCfg] = useState(mode === "edit" ? { ...widget.cfg } : null);
  const w = mode === "edit" ? (widget.w || 1) : 1;

  const pick = (t) => { setType(t); setCfg(DEFAULT_CFG[t]()); };
  const commit = () => {
    if (!type) return;
    if (mode === "edit") onSave({ type, cfg, w });
    else onAdd({ type, cfg, w });
  };
  const valid = type && isCfgValid(type, cfg);

  // Portaled to <body> so the fixed overlay is positioned against the VIEWPORT,
  // not the transform'd .page-transition wrapper (which would pin it to the top
  // of the page — invisible when the user is scrolled down). zIndex stays below
  // the Picker menu's 1000 so its dropdowns render above this modal.
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.62)", zIndex: 80, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "7vh 1rem 4vh", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 500, background: surfacePanel, border: `1px solid ${border}`, borderRadius: 14, padding: "1.4rem 1.5rem", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0, color: textLight, fontSize: "1.1rem", fontWeight: 700 }}>
            {mode === "edit" ? L(lang, "Nastaviť widget", "Configure widget") : L(lang, "Pridať widget", "Add widget")}
          </h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: dim, fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        {/* type picker (add mode, before a type is chosen) */}
        {mode === "add" && !type && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            {PALETTE.map(pt => (
              <button key={pt.type} onClick={() => pick(pt.type)}
                style={{ textAlign: "left", background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "0.8rem 0.9rem", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = green}
                onMouseLeave={e => e.currentTarget.style.borderColor = border}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.3rem" }}>
                  <span style={{ color: accentInk }}>{WIDGET_META[pt.type].icon}</span>
                  <span style={{ color: textLight, fontWeight: 600, fontSize: "0.86rem" }}>{WIDGET_META[pt.type].title[lang] || WIDGET_META[pt.type].title.en}</span>
                </div>
                <div style={{ color: dim, fontSize: "0.72rem", lineHeight: 1.4 }}>{pt.desc[lang] || pt.desc.en}</div>
              </button>
            ))}
          </div>
        )}

        {/* config form */}
        {type && (
          <div>
            {mode === "add" && (
              <button onClick={() => { setType(null); setCfg(null); }}
                style={{ background: "transparent", border: "none", color: dim, fontFamily: mono, fontSize: "0.72rem", cursor: "pointer", marginBottom: "0.8rem", padding: 0 }}>
                ← {L(lang, "Späť na výber", "Back to picker")}
              </button>
            )}
            <ConfigForm type={type} cfg={cfg} setCfg={setCfg} ctx={ctx} lang={lang} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1.1rem" }}>
              <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>{L(lang, "Zrušiť", "Cancel")}</button>
              <button onClick={commit} disabled={!valid}
                style={{ background: valid ? green : border, color: valid ? "#06140f" : faint, border: "none", borderRadius: 8, padding: "0.5rem 1.2rem", fontWeight: 700, fontFamily: mono, fontSize: "0.8rem", cursor: valid ? "pointer" : "default" }}>
                {mode === "edit" ? L(lang, "Uložiť", "Save") : L(lang, "Pridať", "Add")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function isCfgValid(type, cfg) {
  if (!cfg) return false;
  if (type === "project" || type === "trend") return !!cfg.projectId;
  if (type === "segment") return !!cfg.district;
  if (type === "metric") {
    if (cfg.scope?.kind === "district") return !!cfg.scope.district;
    if (cfg.scope?.kind === "developer") return !!cfg.scope.developer;
    return true;
  }
  return true;
}

function ConfigForm({ type, cfg, setCfg, ctx, lang }) {
  const { projects, districts } = ctx;
  const set = (patch) => setCfg({ ...cfg, ...patch });

  const projectOpts = useMemo(() => [{ value: "", label: L(lang, "— vyber projekt —", "— pick a project —") },
    ...[...(projects || [])].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(p => ({ value: p.id, label: p.name }))], [projects, lang]);
  const districtOpts = useMemo(() => [{ value: "", label: L(lang, "— vyber oblasť —", "— pick an area —") },
    ...[...(districts || [])].filter(d => d.district).sort((a, b) => (b.total_units || 0) - (a.total_units || 0))
      .map(d => ({ value: `${d.city_id}::${d.district}`, label: `${d.district}${d.city_name ? ` · ${d.city_name}` : ""}` }))], [districts, lang]);
  const developerOpts = useMemo(() => {
    const set2 = new Map();
    for (const p of (projects || [])) if (p.developer && (p.status || "active") === "active") set2.set(p.developer, (set2.get(p.developer) || 0) + 1);
    return [{ value: "", label: L(lang, "— vyber developera —", "— pick a developer —") },
      ...[...set2.keys()].sort().map(d => ({ value: d, label: d }))];
  }, [projects, lang]);

  if (type === "project") {
    return <Field label={L(lang, "Projekt", "Project")}><Select value={cfg.projectId} onChange={v => set({ projectId: v })} options={projectOpts} searchable sk={lang === "sk"} /></Field>;
  }
  if (type === "trend") {
    return <>
      <Field label={L(lang, "Projekt", "Project")}><Select value={cfg.projectId} onChange={v => set({ projectId: v })} options={projectOpts} searchable sk={lang === "sk"} /></Field>
      <Field label={L(lang, "Ukazovateľ", "Series")}><Select value={cfg.series} onChange={v => set({ series: v })}
        options={Object.entries(TREND_SERIES).map(([k, d]) => ({ value: k, label: d.label[lang] || d.label.en }))} /></Field>
    </>;
  }
  if (type === "segment") {
    return <Field label={L(lang, "Oblasť", "Area")}><Select value={cfg.district ? `${cfg.city}::${cfg.district}` : ""}
      onChange={v => { const [c, ...r] = v.split("::"); set({ city: c, district: r.join("::") }); }} options={districtOpts} searchable sk={lang === "sk"} /></Field>;
  }
  if (type === "benchmark") {
    return <>
      <Field label={L(lang, "Podľa", "Group by")}><Select value={cfg.by} onChange={v => set({ by: v })}
        options={[{ value: "district", label: L(lang, "Časť mesta", "District") }, { value: "developer", label: L(lang, "Developer", "Developer") }]} /></Field>
      <Field label={L(lang, "Počet", "Rows")}><Select value={String(cfg.n)} onChange={v => set({ n: Number(v) })}
        options={[5, 8, 10, 15].map(n => ({ value: String(n), label: String(n) }))} /></Field>
    </>;
  }
  if (type === "ranking") {
    const metricOpts = Object.entries(RANK_METRICS[cfg.entity] || RANK_METRICS.projects).map(([k, d]) => ({ value: k, label: d.label[lang] || d.label.en }));
    return <>
      <Field label={L(lang, "Zoznam", "List of")}><Select value={cfg.entity} onChange={v => {
        const first = Object.keys(RANK_METRICS[v])[0];
        set({ entity: v, metric: Object.keys(RANK_METRICS[v]).includes(cfg.metric) ? cfg.metric : first });
      }} options={[
        { value: "projects", label: L(lang, "Projekty", "Projects") },
        { value: "districts", label: L(lang, "Časti mesta", "Districts") },
        { value: "developers", label: L(lang, "Developeri", "Developers") },
      ]} /></Field>
      <Field label={L(lang, "Metrika", "Metric")}><Select value={cfg.metric} onChange={v => set({ metric: v })} options={metricOpts} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
        <Field label={L(lang, "Poradie", "Order")}><Select value={cfg.dir} onChange={v => set({ dir: v })}
          options={[{ value: "top", label: L(lang, "Najviac", "Highest") }, { value: "bottom", label: L(lang, "Najmenej", "Lowest") }]} /></Field>
        <Field label={L(lang, "Počet", "Rows")}><Select value={String(cfg.n)} onChange={v => set({ n: Number(v) })}
          options={[3, 5, 8, 10].map(n => ({ value: String(n), label: String(n) }))} /></Field>
      </div>
    </>;
  }
  if (type === "metric") {
    const kind = cfg.scope?.kind || "market";
    return <>
      <Field label={L(lang, "Metrika", "Metric")}><Select value={cfg.metric} onChange={v => set({ metric: v })}
        options={Object.entries(METRICS).map(([k, d]) => ({ value: k, label: d.label[lang] || d.label.en }))} /></Field>
      <Field label={L(lang, "Rozsah", "Scope")}><Select value={kind} onChange={v => set({ scope: v === "market" ? { kind: "market" } : { kind: v } })}
        options={[{ value: "market", label: L(lang, "Celý trh", "Whole market") }, { value: "district", label: L(lang, "Časť mesta", "District") }, { value: "developer", label: L(lang, "Developer", "Developer") }]} /></Field>
      {kind === "district" && (
        <Field label={L(lang, "Oblasť", "Area")}><Select value={cfg.scope.district ? `${cfg.scope.city}::${cfg.scope.district}` : ""}
          onChange={v => { const [c, ...r] = v.split("::"); const district = r.join("::"); const row = (districts || []).find(d => d.district === district && String(d.city_id) === String(c)); set({ scope: { kind: "district", city: c, district, districtLabel: row ? `${district}${row.city_name ? ` · ${row.city_name}` : ""}` : district } }); }}
          options={districtOpts} searchable sk={lang === "sk"} /></Field>
      )}
      {kind === "developer" && (
        <Field label={L(lang, "Developer", "Developer")}><Select value={cfg.scope.developer || ""}
          onChange={v => set({ scope: { kind: "developer", developer: v } })} options={developerOpts} searchable sk={lang === "sk"} /></Field>
      )}
    </>;
  }
  return null;
}
