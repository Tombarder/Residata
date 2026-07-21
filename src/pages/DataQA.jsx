/**
 * DataQA — admin-only "Kontrola dát" tool.
 *
 * Pick a project (searchable, optionally pre-filtered by Country / Region / City),
 * pick a snapshot DATE, and see that project's units for that day — sortable,
 * status-filterable, with Excel-style row-select aggregation and a one-click open
 * of the developer's site for side-by-side comparison. Read-only (control, not edit).
 *
 * Column manager (2026-07-02): every column we have is available; the reviewer can
 * show/hide, reorder (drag a header or use the ⚙ panel), and reset to the original
 * layout with one button. The chosen layout persists in localStorage across projects
 * and reloads — only Reset clears it.
 *
 * Selected counter (2026-07-02): a live "Vybrané X / Y" stat card counts ticked units
 * against the snapshot total, for checking completeness vs. the developer's website.
 *
 * Project pager (2026-07-02): ◀ ▶ arrows step through the currently-filtered project
 * list (respects the Country/Region/City filters), so the reviewer can go project by
 * project without re-searching.
 *
 * Data: 3 admin-gated RPCs (public._require_admin), all returning jsonb (no row cap):
 *   admin_qa_projects()                  → projects + counts + country/region/city + url
 *   admin_qa_dates(p_project_id)         → available snapshot dates (newest first)
 *   admin_qa_units(p_project_id, p_date) → that snapshot's units (full QA column set)
 *
 * Hardened (2026-06-24 audit): request-sequencing guard against out-of-order responses,
 * NaN-safe aggregates, "Na vyžiadanie" sentinel shown, CSV escaped + injection-safe,
 * memoised rows + deferred search for big projects, localized errors, select-all.
 */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import ProjectsEditor from "../components/ProjectsEditor";
import Picker from "../components/Picker";

const green = "var(--accent)";
const greenInk = "var(--accent-ink)";
const amber = "#f5a623";
const blue = "#4a9eff";
const textLight = "var(--text)";
const dim = "var(--text-dim)";
const border = "var(--border)";
const bg = "var(--bg)";
const bg2 = "var(--surface-2)";
const mono = "'JetBrains Mono', monospace";

// ── "Normal theme" shared visual helpers (visual-only) ──────────────
const eyebrowBar = <span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />;
const cardBar = (color) => <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color, opacity: 0.85 }} />;
const tintBg = (color) => `linear-gradient(180deg, color-mix(in srgb, ${color} 9%, var(--surface)) 0%, var(--surface) 46%)`;
const C_GREEN = "#10b981", C_BLUE = "#3b74e8", C_AMBER = "#e0940f", C_SLATE = "#64748b";

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
async function rpcDirect(fn, body, { timeoutMs = 45000 } = {}) {
  const token = storedAccessToken();
  if (!token) throw new Error("NO_SESSION");
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    if (r.status === 401) throw new Error("SESSION_EXPIRED");
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.warn(`rpcDirect ${fn}: ${r.status} ${detail.slice(0, 200)}`);
      throw new Error("RPC_ERROR");
    }
    return await r.json();
  } finally { clearTimeout(killer); }
}

const norm = (s) => (s == null ? "" : String(s)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
// NOTE: guard null/"" first — Number(null) and Number("") are 0 (finite), which would
// silently turn missing values into 0 and corrupt every aggregate (avg €/m², min price)
// and render null numeric cells as "0"/"0.0" instead of "—".
const fin = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmt = (n) => { const x = fin(n); return x == null ? "—" : Math.round(x).toLocaleString("sk-SK"); };
const fmt1 = (n) => { const x = fin(n); return x == null ? "—" : x.toFixed(1); };
const izbyTxt = (s) => (s == null ? "—" : String(s).replace(/\.0$/, ""));
const avgFin = (arr, f) => { const v = arr.map((r) => fin(f(r))).filter((n) => n != null); return v.length ? v.reduce((a, n) => a + n, 0) / v.length : null; };

const STAVY = [["all", "Všetky", "All"], ["V", "Voľné", "Available"], ["P", "Predané", "Sold"], ["R", "Rezervované", "Reserved"], ["PR", "Predrezerv.", "Pre-reserved"]];
const stavColor = (s) => (s === "V" ? green : s === "P" ? dim : s === "R" ? amber : s === "PR" ? blue : textLight);
const COUNTRIES = { SK: "Slovensko", CZ: "Česko" };

// Full column registry. { key, sk, en, type } — type "n" = numeric (right-aligned), "t" = text.
// Order here is the DEFAULT (used by Reset). Every column is visible by default.
const ALL_COLS = [
  { key: "unit_id",      sk: "Byt",          en: "Unit",            type: "t" },
  { key: "typ",          sk: "Typ",          en: "Type",            type: "t" },
  { key: "etapa",        sk: "Etapa",        en: "Phase",           type: "t" },
  { key: "budova",       sk: "Budova",       en: "Building",        type: "t" },
  { key: "unit_detail",  sk: "Detail",       en: "Detail",          type: "t" },
  { key: "poschodie",    sk: "Posch.",       en: "Floor",           type: "n" },
  { key: "izby",         sk: "Izby",         en: "Rooms",           type: "n" },
  { key: "obytna",       sk: "Obytná m²",    en: "Living m²",       type: "n" },
  { key: "balkon",       sk: "Balkón m²",    en: "Balcony m²",      type: "n" },
  { key: "loggia",       sk: "Loggia m²",    en: "Loggia m²",       type: "n" },
  { key: "terasa",       sk: "Terasa m²",    en: "Terrace m²",      type: "n" },
  { key: "zahrada",      sk: "Záhrada m²",   en: "Garden m²",       type: "n" },
  { key: "exterier",     sk: "Exteriér m²",  en: "Exterior m²",     type: "n" },
  { key: "kobka",        sk: "Kobka m²",     en: "Storage m²",      type: "n" },
  { key: "celkova",      sk: "Celková m²",   en: "Total m²",        type: "n" },
  { key: "cena_bez_dph", sk: "Cena bez DPH", en: "Price excl. VAT", type: "n" },
  { key: "cena",         sk: "Cena s DPH",   en: "Price incl. VAT", type: "n" },
  { key: "cennikova",    sk: "Cenníková",    en: "List price",      type: "n" },
  { key: "eur_m2",       sk: "€/m²",         en: "€/m²",            type: "n" },
  { key: "stav",         sk: "Stav",         en: "Status",          type: "t" },
  { key: "orientacia",   sk: "Orient.",      en: "Orient.",         type: "t" },
  { key: "kolaudacia",   sk: "Kolaudácia",   en: "Completion",      type: "t" },
];
const COL_MAP = Object.fromEntries(ALL_COLS.map((c) => [c.key, c]));
const DEFAULT_ORDER = ALL_COLS.map((c) => c.key);
const AREA = new Set(["obytna", "celkova", "balkon", "loggia", "terasa", "zahrada", "exterier", "kobka"]);
const PRICE = new Set(["cena_bez_dph", "cennikova"]);
const LS_COLS = "residata_dataqa_columns_v1";

// Load persisted column layout, reconciled with the current registry:
// unknown keys dropped, newly-added columns appended (visible), so it survives schema growth.
function loadColCfg() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_COLS));
    if (raw && Array.isArray(raw.order)) {
      const known = raw.order.filter((k) => COL_MAP[k]);
      const missing = DEFAULT_ORDER.filter((k) => !known.includes(k));
      const hidden = {};
      for (const k of Object.keys(raw.hidden || {})) if (COL_MAP[k]) hidden[k] = true;
      return { order: [...known, ...missing], hidden };
    }
  } catch { /* ignore */ }
  return { order: [...DEFAULT_ORDER], hidden: {} };
}

const tdStyle = (type) => ({ padding: "8px 11px", textAlign: type === "n" ? "right" : "left", color: textLight, fontSize: 13, whiteSpace: "nowrap" });
const thStyle = (type) => ({ padding: "9px 11px", textAlign: type === "n" ? "right" : "left", color: dim, fontFamily: mono, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", borderBottom: `1px solid ${border}` });
const selStyle = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, padding: "9px 12px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 14, outline: "none" };

function cellNode(u, key) {
  if (key === "stav") return <span style={{ color: stavColor(u.stav), fontWeight: 600 }}>{u.stav || "—"}</span>;
  if (key === "izby") return izbyTxt(u.izby);
  if (AREA.has(key)) return fmt1(u[key]);
  if (key === "cena") return u.cena != null ? fmt(u.cena) : (u.cena_text || "—");
  if (PRICE.has(key)) return fmt(u[key]);
  if (key === "eur_m2") return fmt(u.eur_m2);
  return u[key] == null || u[key] === "" ? "—" : u[key];
}
// Raw value for CSV (no JSX, no "—" placeholders).
function csvValue(u, key) {
  if (key === "izby") return izbyTxt(u.izby) === "—" ? "" : izbyTxt(u.izby);
  if (key === "cena") return u.cena != null ? u.cena : (u.cena_text || "");
  return u[key] == null ? "" : u[key];
}

const Row = memo(function Row({ u, cols, isChecked, onToggle, lang }) {
  return (
    <tr style={{ borderBottom: `1px solid ${border}`, background: isChecked ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent" }}>
      <td style={{ padding: "8px 11px" }}>
        <input type="checkbox" checked={isChecked} onChange={() => onToggle(u.unit_id)}
          aria-label={(lang === "sk" ? "Vybrať byt " : "Select unit ") + u.unit_id} />
      </td>
      {cols.map((c) => <td key={c.key} style={tdStyle(c.type)}>{cellNode(u, c.key)}</td>)}
    </tr>
  );
});

export default function DataQA({ lang = "sk" }) {
  const t = (en, sk) => (lang === "sk" ? sk : en);
  const mapErr = (code) => ({
    NO_SESSION: t("Couldn't read your session — reload and sign in again.", "Nedá sa prečítať relácia — obnov stránku a prihlás sa znova."),
    SESSION_EXPIRED: t("Session expired — reload and sign in again.", "Relácia vypršala — obnov stránku a prihlás sa znova."),
    RPC_ERROR: t("Couldn't load data — try again.", "Nepodarilo sa načítať dáta — skús znova."),
  }[code] || code);

  const [projects, setProjects] = useState(null);
  const [view, setView] = useState("snapshots");   // "snapshots" | "edit"
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const [fCountry, setFCountry] = useState("");
  const [fRegion, setFRegion] = useState("");
  const [fCity, setFCity] = useState("");

  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [units, setUnits] = useState(null);
  const [uErr, setUErr] = useState(null);

  const [stav, setStav] = useState("all");
  const [uSearch, setUSearch] = useState("");
  const dSearch = useDeferredValue(uSearch);
  const [sortCol, setSortCol] = useState("unit_id");
  const [sortDir, setSortDir] = useState(1);
  const [checked, setChecked] = useState({});
  const boxRef = useRef(null);
  const reqRef = useRef(0);

  // Column manager (persisted across projects + reloads; only Reset clears it).
  const [colCfg, setColCfg] = useState(loadColCfg);
  const [colPanel, setColPanel] = useState(false);
  const dragKey = useRef(null);
  useEffect(() => {
    try { localStorage.setItem(LS_COLS, JSON.stringify(colCfg)); } catch { /* ignore */ }
  }, [colCfg]);
  const visibleCols = useMemo(
    () => colCfg.order.filter((k) => !colCfg.hidden[k]).map((k) => COL_MAP[k]).filter(Boolean),
    [colCfg]
  );
  const hiddenCount = ALL_COLS.length - visibleCols.length;

  function toggleColHidden(key) {
    setColCfg((cfg) => { const hidden = { ...cfg.hidden }; if (hidden[key]) delete hidden[key]; else hidden[key] = true; return { ...cfg, hidden }; });
  }
  function moveCol(key, delta) {
    setColCfg((cfg) => {
      const order = [...cfg.order];
      const i = order.indexOf(key), j = i + delta;
      if (i < 0 || j < 0 || j >= order.length) return cfg;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...cfg, order };
    });
  }
  function dropCol(targetKey) {
    const from = dragKey.current; dragKey.current = null;
    if (!from || from === targetKey) return;
    setColCfg((cfg) => {
      const order = cfg.order.filter((k) => k !== from);
      const idx = order.indexOf(targetKey);
      order.splice(idx < 0 ? order.length : idx, 0, from);
      return { ...cfg, order };
    });
  }
  function resetCols() { setColCfg({ order: [...DEFAULT_ORDER], hidden: {} }); }
  function showAllCols() { setColCfg((cfg) => ({ ...cfg, hidden: {} })); }

  useEffect(() => {
    let alive = true;
    rpcDirect("admin_qa_projects", {})
      .then((p) => { if (alive) setProjects(Array.isArray(p) ? p : []); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);

  const loadUnits = useCallback((pid, d) => {
    setUnits(null); setUErr(null); setChecked({});
    const my = ++reqRef.current;
    rpcDirect("admin_qa_units", { p_project_id: pid, p_date: d || null })
      .then((u) => { if (my === reqRef.current) setUnits(Array.isArray(u) ? u : []); })
      .catch((e) => { if (my === reqRef.current) setUErr(e.message); });
  }, []);

  const pick = useCallback((p) => {
    setSel(p); setQuery(p.name); setOpen(false);
    setUnits(null); setUErr(null); setChecked({}); setStav("all"); setUSearch("");
    setSortCol("unit_id"); setSortDir(1);
    const my = ++reqRef.current;
    rpcDirect("admin_qa_dates", { p_project_id: p.id })
      .then((d) => {
        if (my !== reqRef.current) return;
        const sorted = [...(Array.isArray(d) ? d : [])].sort((a, b) => (a.scrape_date < b.scrape_date ? 1 : a.scrape_date > b.scrape_date ? -1 : 0));
        setDates(sorted);
        const first = sorted.length ? sorted[0].scrape_date : "";
        setDate(first);
        loadUnits(p.id, first);
      })
      .catch((e) => { if (my === reqRef.current) setUErr(e.message); });
  }, [loadUnits]);

  function changeDate(d) { if (!sel) return; setDate(d); loadUnits(sel.id, d); }

  const onToggle = useCallback((id) => {
    setChecked((c) => { const n = { ...c }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  }, []);

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const opts = useMemo(() => {
    const ps = projects || [];
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "sk"));
    return {
      countries: uniq(ps.map((p) => p.country)),
      regions: uniq(ps.filter((p) => !fCountry || p.country === fCountry).map((p) => p.region)),
      cities: uniq(ps.filter((p) => (!fCountry || p.country === fCountry) && (!fRegion || p.region === fRegion)).map((p) => p.city)),
    };
  }, [projects, fCountry, fRegion]);

  // Projects passing the Country/Region/City filters (NOT the text query).
  // This is the list the ◀ ▶ pager steps through and the "N projektov" count reflects.
  const filtered = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) =>
      (!fCountry || p.country === fCountry) &&
      (!fRegion || p.region === fRegion) &&
      (!fCity || p.city === fCity)
    );
  }, [projects, fCountry, fRegion, fCity]);

  // Filtered list further narrowed by the search box — powers the dropdown.
  const matches = useMemo(() => {
    const q = norm(query);
    if (!q) return filtered;
    return filtered.filter((p) => norm(p.name).includes(q) || norm(p.city).includes(q));
  }, [filtered, query]);

  const navIdx = sel ? filtered.findIndex((p) => p.id === sel.id) : -1;
  function navBy(delta) {
    if (navIdx < 0) return;
    const j = navIdx + delta;
    if (j < 0 || j >= filtered.length) return;
    pick(filtered[j]);
  }

  const snap = useMemo(() => {
    if (!units) return null;
    const by = (s) => units.filter((u) => u.stav === s).length;
    const cenas = units.map((u) => fin(u.cena)).filter((n) => n != null);
    return {
      total: units.length, v: by("V"), p: by("P"), r: by("R"), pr: by("PR"),
      avgPsm: avgFin(units, (u) => u.eur_m2),
      minP: cenas.length ? cenas.reduce((m, n) => Math.min(m, n), Infinity) : null,
      maxP: cenas.length ? cenas.reduce((m, n) => Math.max(m, n), -Infinity) : null,
    };
  }, [units]);

  // Units ticked in this snapshot, regardless of the current status filter.
  const selCount = useMemo(
    () => (units ? units.reduce((n, u) => n + (checked[u.unit_id] ? 1 : 0), 0) : 0),
    [units, checked]
  );

  const rows = useMemo(() => {
    if (!units) return [];
    let r = units;
    if (stav !== "all") r = r.filter((u) => u.stav === stav);
    const q = norm(dSearch);
    if (q) r = r.filter((u) => norm(u.unit_id).includes(q));
    const c = sortCol, dir = sortDir;
    const numeric = COL_MAP[c]?.type === "n";
    return [...r].sort((a, b) => {
      if (numeric) {
        const x = fin(a[c]), y = fin(b[c]);
        if (x == null && y == null) return 0;
        if (x == null) return 1; if (y == null) return -1;
        return (x - y) * dir;
      }
      return String(a[c] ?? "").localeCompare(String(b[c] ?? ""), "sk") * dir;
    });
  }, [units, stav, dSearch, sortCol, sortDir]);

  const selRows = rows.filter((r) => checked[r.unit_id]);
  const aggRows = selRows.length ? selRows : rows;
  const cenaSum = aggRows.map((r) => fin(r.cena)).filter((n) => n != null);
  const allChecked = rows.length > 0 && rows.every((r) => checked[r.unit_id]);
  function toggleAll() {
    setChecked((c) => { const n = { ...c }; if (allChecked) rows.forEach((r) => delete n[r.unit_id]); else rows.forEach((r) => { n[r.unit_id] = true; }); return n; });
  }

  function csvCell(v) {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function exportCsv() {
    if (!units) return;
    const cols = visibleCols.length ? visibleCols : ALL_COLS;
    const head = ["Projekt", "Dátum", ...cols.map((c) => t(c.en, c.sk))];
    const lines = [head.map(csvCell).join(";")];
    rows.forEach((u) => {
      const vals = cols.map((c) => csvValue(u, c.key));
      lines.push([sel.name, date, ...vals].map(csvCell).join(";"));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${norm(sel.name).replace(/\s+/g, "-") || sel.id}_${date || "current"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const card = { background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 14px" };
  const cardLabel = { fontSize: 11, color: dim, fontFamily: mono, textTransform: "uppercase", letterSpacing: 0.4 };
  const cardVal = { fontSize: 22, fontWeight: 600, color: textLight, marginTop: 4 };
  const btn = { padding: "8px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textLight, cursor: "pointer", fontSize: 13 };
  const navBtn = (enabled) => ({ padding: "7px 11px", borderRadius: 8, border: `1px solid ${border}`, background: bg2, color: enabled ? textLight : dim, cursor: enabled ? "pointer" : "not-allowed", fontSize: 14, lineHeight: 1 });
  const miniBtn = (enabled) => ({ padding: "1px 6px", borderRadius: 5, border: `1px solid ${border}`, background: "transparent", color: enabled ? textLight : dim, cursor: enabled ? "pointer" : "not-allowed", fontSize: 12, lineHeight: 1.4 });

  return (
    <div style={{ minHeight: "100vh", background: bg, color: textLight, padding: "1.5rem 1.75rem" }}>
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, border: "1px solid var(--border)", padding: "1.4rem 1.6rem 1.5rem", marginBottom: "1.5rem", background: "radial-gradient(120% 140% at 2% -20%, rgba(18,185,129,0.13) 0%, transparent 46%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--surface)) 0%, var(--bg) 75%)" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3, background: "linear-gradient(90deg, var(--accent), #3b74e8 55%, #8b5cf6)" }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{t("Data control", "Kontrola dát")}</h1>
        <p style={{ margin: "4px 0 0", color: dim, fontSize: 13 }}>
          {t("Pick a project + date, compare our data against the developer's website.",
             "Vyber projekt + dátum, porovnaj naše dáta s webom developera.")}
        </p>
      </div>

      {/* Tab: browse data snapshots (default) vs edit project config */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: `1px solid ${border}` }}>
        {[["snapshots", t("Data snapshots", "Snímky dát")], ["edit", t("Edit projects", "Upraviť projekty")]].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            style={{
              background: "transparent", border: "none",
              borderBottom: `2px solid ${view === k ? green : "transparent"}`,
              color: view === k ? textLight : dim, padding: "8px 12px", fontSize: 14,
              fontWeight: 600, cursor: "pointer", marginBottom: -1,
            }}>{label}</button>
        ))}
      </div>

      {view === "edit" && <ProjectsEditor lang={lang} />}

      {err && view === "snapshots" && <div style={{ ...card, borderColor: amber, color: amber, marginBottom: 14 }}>{mapErr(err)}</div>}
      {view === "snapshots" && !projects && !err && <div style={{ color: dim, fontFamily: mono, fontSize: 13 }}>{t("Loading projects…", "Načítavam projekty…")}</div>}

      {view === "snapshots" && projects && (
        <>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div style={{ minWidth: 140 }}>
            <label style={cardLabel}>{eyebrowBar}{t("Country", "Krajina")}</label>
            <Picker value={fCountry} onChange={(v) => { setFCountry(v); setFRegion(""); setFCity(""); }} ariaLabel={t("Country", "Krajina")}
              options={[{ value: "", label: t("All", "Všetky") }, ...opts.countries.map((c) => ({ value: c, label: COUNTRIES[c] || c }))]} />
          </div>
          <div style={{ minWidth: 170 }}>
            <label style={cardLabel}>{eyebrowBar}{t("Region", "Kraj")}</label>
            <Picker value={fRegion} onChange={(v) => { setFRegion(v); setFCity(""); }} searchable ariaLabel={t("Region", "Kraj")}
              options={[{ value: "", label: t("All", "Všetky") }, ...opts.regions.map((r) => ({ value: r, label: r }))]} />
          </div>
          <div style={{ minWidth: 150 }}>
            <label style={cardLabel}>{eyebrowBar}{t("City", "Mesto")}</label>
            <Picker value={fCity} onChange={(v) => setFCity(v)} searchable ariaLabel={t("City", "Mesto")}
              options={[{ value: "", label: t("All", "Všetky") }, ...opts.cities.map((c) => ({ value: c, label: c }))]} />
          </div>
          {(fCountry || fRegion || fCity) && (
            <button onClick={() => { setFCountry(""); setFRegion(""); setFCity(""); }} style={{ ...btn, padding: "8px 12px", fontSize: 12 }}>{t("Clear", "Zrušiť filtre")}</button>
          )}
          <span style={{ fontSize: 12, color: dim, fontFamily: mono, paddingBottom: 9 }}>{filtered.length} {t("projects", "projektov")}</span>

          {/* Project pager — steps through the filtered list (top-right). */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, paddingBottom: 2 }}>
            <button onClick={() => navBy(-1)} disabled={navIdx <= 0} style={navBtn(navIdx > 0)}
              title={t("Previous project", "Predošlý projekt")} aria-label={t("Previous project", "Predošlý projekt")}>◀</button>
            <span style={{ fontSize: 12, color: dim, fontFamily: mono, minWidth: 56, textAlign: "center" }}>
              {navIdx >= 0 ? `${navIdx + 1} / ${filtered.length}` : `— / ${filtered.length}`}
            </span>
            <button onClick={() => navBy(1)} disabled={navIdx < 0 || navIdx >= filtered.length - 1} style={navBtn(navIdx >= 0 && navIdx < filtered.length - 1)}
              title={t("Next project", "Ďalší projekt")} aria-label={t("Next project", "Ďalší projekt")}>▶</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
          <div ref={boxRef} style={{ position: "relative", flex: "1 1 280px", minWidth: 240 }}>
            <label style={cardLabel}>{eyebrowBar}{t("Project", "Projekt")}</label>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
              role="combobox" aria-expanded={open} aria-autocomplete="list"
              placeholder={t("type to search…", "píš pre hľadanie…")}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 5, padding: "9px 12px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 14, outline: "none" }} />
            {open && matches.length > 0 && (
              <div role="listbox" style={{ position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, marginTop: 4, maxHeight: 320, overflowY: "auto", background: bg2, border: `1px solid ${border}`, borderRadius: 8 }}>
                {matches.map((p) => (
                  <div key={p.id} role="option" aria-selected={sel?.id === p.id} onClick={() => pick(p)}
                    style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", gap: 10 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = bg)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ fontSize: 13 }}>{p.name}</span>
                    <span style={{ fontSize: 12, color: dim, fontFamily: mono }}>{p.city} · {p.total_units ?? 0}{t(" units", " bytov")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ minWidth: 170 }}>
            <label style={cardLabel}>{eyebrowBar}{t("Date (snapshot)", "Dátum (snapshot)")}</label>
            <Picker value={date} onChange={(v) => changeDate(v)} ariaLabel={t("Date (snapshot)", "Dátum (snapshot)")}
              options={dates.length === 0 ? [{ value: "", label: "—" }] : dates.map((d, i) => ({ value: d.scrape_date, label: `${d.scrape_date}${i === 0 ? t(" (latest)", " (najnovšie)") : ""} · ${d.units}` }))} />
          </div>

          {sel && sel.project_url && (
            <a href={sel.project_url} target="_blank" rel="noopener noreferrer"
              style={{ ...btn, borderColor: green, color: greenInk, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }}>
              {t("Open developer site", "Otvoriť web developera")} ↗
            </a>
          )}
        </div>
        </>
      )}

      {sel && (
        <>
          <div style={{ fontSize: 12, color: dim, fontFamily: mono, marginBottom: 8 }}>
            {t("Snapshot of", "Snapshot k")} <span style={{ color: textLight }}>{date || "—"}</span> · {fmt(snap?.total)}{t(" units", " bytov")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(118px,1fr))", gap: 10, marginBottom: 16 }}>
            <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_SLATE) }}>{cardBar(C_SLATE)}<div style={cardLabel}>{t("Units total", "Bytov spolu")}</div><div style={cardVal}>{fmt(snap?.total)}</div></div>
            <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_GREEN), borderColor: selCount ? green : border }}>
              {cardBar(C_GREEN)}
              <div style={cardLabel}>{t("Selected", "Vybrané")}</div>
              <div style={{ ...cardVal, color: selCount ? green : textLight }}>
                {fmt(selCount)}<span style={{ fontSize: 13, color: dim, fontWeight: 400 }}> / {fmt(snap?.total)}</span>
              </div>
            </div>
            <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_GREEN) }}>{cardBar(C_GREEN)}<div style={cardLabel}>{t("Available", "Voľných")}</div><div style={{ ...cardVal, color: greenInk }}>{fmt(snap?.v)}</div></div>
            <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_SLATE) }}>{cardBar(C_SLATE)}<div style={cardLabel}>{t("Sold", "Predaných")}</div><div style={cardVal}>{fmt(snap?.p)}</div></div>
            <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_AMBER) }}>{cardBar(C_AMBER)}<div style={cardLabel}>{t("Reserved", "Rezervované")}</div><div style={cardVal}>{fmt(snap?.r)}</div></div>
            <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_BLUE) }}>{cardBar(C_BLUE)}<div style={cardLabel}>{t("Pre-reserved", "Predrezerv.")}</div><div style={cardVal}>{fmt(snap?.pr)}</div></div>
            <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_SLATE) }}>{cardBar(C_SLATE)}<div style={cardLabel}>{t("Avg €/m²", "Priemer €/m²")}</div><div style={cardVal}>{fmt(snap?.avgPsm)}</div></div>
            <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_SLATE) }}>{cardBar(C_SLATE)}<div style={cardLabel}>{t("Price from–to", "Cena od–do")}</div><div style={{ ...cardVal, fontSize: 15 }}>{fmt(snap?.minP)} – {fmt(snap?.maxP)} €</div></div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            {STAVY.map((s) => {
              const on = stav === s[0];
              return <button key={s[0]} onClick={() => setStav(s[0])}
                style={{ ...btn, padding: "6px 12px", fontSize: 12, borderColor: on ? green : border, color: on ? green : textLight, background: on ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent" }}>{t(s[2], s[1])}</button>;
            })}
            <input value={uSearch} onChange={(e) => setUSearch(e.target.value)} placeholder={t("search unit…", "hľadať byt…")}
              style={{ marginLeft: "auto", padding: "7px 11px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 13, outline: "none", width: 150 }} />
            <button onClick={() => setColPanel((v) => !v)} style={{ ...btn, padding: "7px 12px", fontSize: 12, borderColor: colPanel ? green : border, color: colPanel ? green : textLight }}
              title={t("Show / hide / reorder columns", "Zobraziť / skryť / presúvať stĺpce")}>
              ⚙ {t("Columns", "Stĺpce")} {visibleCols.length}/{ALL_COLS.length}
            </button>
            <button onClick={exportCsv} style={{ ...btn, padding: "7px 12px", fontSize: 12 }} title={t("Export shown rows to CSV", "Stiahnuť zobrazené riadky do CSV")}>CSV ↓</button>
          </div>

          {colPanel && (
            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ ...cardLabel, fontSize: 12 }}>
                  {eyebrowBar}{t("Columns", "Stĺpce")} — {visibleCols.length}/{ALL_COLS.length} {t("shown", "zobrazených")}{hiddenCount ? `, ${hiddenCount} ${t("hidden", "skrytých")}` : ""}
                </span>
                <button onClick={showAllCols} style={{ ...btn, padding: "5px 10px", fontSize: 12, marginLeft: "auto" }}>{t("Show all", "Zobraziť všetky")}</button>
                <button onClick={resetCols} style={{ ...btn, padding: "5px 10px", fontSize: 12, borderColor: amber, color: amber }}
                  title={t("Reset to original order + show all", "Obnoviť pôvodné poradie + zobraziť všetky")}>{t("Reset", "Reset")}</button>
              </div>
              <p style={{ margin: "0 0 10px", color: dim, fontSize: 12 }}>
                {t("Tip: drag a column header to reorder. Layout is remembered across projects until you press Reset.",
                   "Tip: poradie zmeníš aj ťahaním hlavičky stĺpca. Rozloženie sa pamätá naprieč projektmi, kým nedáš Reset.")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 6 }}>
                {colCfg.order.map((k, i) => {
                  const c = COL_MAP[k];
                  if (!c) return null;
                  const shown = !colCfg.hidden[k];
                  return (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: bg, border: `1px solid ${border}`, borderRadius: 7 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, cursor: "pointer", fontSize: 13, color: shown ? textLight : dim }}>
                        <input type="checkbox" checked={shown} onChange={() => toggleColHidden(k)} />
                        {t(c.en, c.sk)}
                      </label>
                      <button onClick={() => moveCol(k, -1)} disabled={i === 0} style={miniBtn(i > 0)} title={t("Move up", "Vyššie")} aria-label={t("Move up", "Vyššie")}>↑</button>
                      <button onClick={() => moveCol(k, 1)} disabled={i === colCfg.order.length - 1} style={miniBtn(i < colCfg.order.length - 1)} title={t("Move down", "Nižšie")} aria-label={t("Move down", "Nižšie")}>↓</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {uErr && <div style={{ ...card, borderColor: amber, color: amber }}>{mapErr(uErr)}</div>}
          {!units && !uErr && <div style={{ color: dim, fontFamily: mono, fontSize: 13, padding: "1rem 0" }}>{t("Loading units…", "Načítavam byty…")}</div>}

          {units && (
            <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: bg2 }}>
                      <th style={{ padding: "9px 11px", width: 34 }}>
                        <input type="checkbox" checked={allChecked} onChange={toggleAll}
                          aria-label={t("Select all shown", "Vybrať všetky zobrazené")} title={t("Select all shown", "Vybrať všetky zobrazené")} />
                      </th>
                      {visibleCols.map((c) => (
                        <th key={c.key} style={thStyle(c.type)} aria-sort={sortCol === c.key ? (sortDir > 0 ? "ascending" : "descending") : "none"}
                          draggable
                          onDragStart={() => { dragKey.current = c.key; }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => dropCol(c.key)}
                          onClick={() => { if (sortCol === c.key) setSortDir(-sortDir); else { setSortCol(c.key); setSortDir(1); } }}>
                          {t(c.en, c.sk)}{sortCol === c.key ? (sortDir > 0 ? " ↑" : " ↓") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => <Row key={u.unit_id} u={u} cols={visibleCols} isChecked={!!checked[u.unit_id]} onToggle={onToggle} lang={lang} />)}
                    {rows.length === 0 && <tr><td colSpan={visibleCols.length + 1} style={{ padding: "1.2rem", color: dim, fontSize: 13, textAlign: "center" }}>{t("No units for this filter.", "Žiadne byty pre tento filter.")}</td></tr>}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "11px 14px", background: bg2, borderTop: `1px solid ${border}`, fontSize: 13, color: textLight }}>
                <span style={{ color: dim, fontFamily: mono, fontSize: 12 }}>
                  {selRows.length ? t(`${selRows.length} selected`, `vybrané: ${selRows.length}`) : t(`${rows.length} shown`, `zobrazené: ${rows.length}`)}
                </span>
                <span>{t("Σ price", "Σ cena")}: <b>{cenaSum.length ? fmt(cenaSum.reduce((s, n) => s + n, 0)) + " €" : "—"}</b></span>
                <span>{t("avg price", "Ø cena")}: <b>{cenaSum.length ? fmt(avgFin(aggRows, (r) => r.cena)) + " €" : "—"}</b></span>
                <span>{t("avg €/m²", "Ø €/m²")}: <b>{fmt(avgFin(aggRows, (r) => r.eur_m2))}</b></span>
                <span>{t("avg area", "Ø plocha")}: <b>{fmt1(avgFin(aggRows, (r) => r.obytna))}{avgFin(aggRows, (r) => r.obytna) != null ? " m²" : ""}</b></span>
              </div>
            </div>
          )}
        </>
      )}

      {!sel && projects && (
        <div style={{ ...card, color: dim, fontSize: 13 }}>
          {t("Pick a project above to see its units and compare to the developer's site.",
             "Vyber projekt hore a uvidíš jeho byty + porovnáš s webom developera.")}
        </div>
      )}
    </div>
  );
}
