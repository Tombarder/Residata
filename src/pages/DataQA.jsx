/**
 * DataQA — admin-only "Kontrola dát" tool.
 *
 * Pick a project (searchable, optionally pre-filtered by Country / Region / City),
 * pick a snapshot DATE, and see that project's units for that day — sortable,
 * status-filterable, with Excel-style row-select aggregation and a one-click open
 * of the developer's site for side-by-side comparison. Read-only (control, not edit).
 *
 * Data: 3 admin-gated RPCs (public._require_admin), all returning jsonb (no row cap):
 *   admin_qa_projects()                  → projects + counts + country/region/city + url
 *   admin_qa_dates(p_project_id)         → available snapshot dates (newest first)
 *   admin_qa_units(p_project_id, p_date) → that snapshot's units
 *
 * Hardened (2026-06-24 audit): request-sequencing guard against out-of-order responses,
 * NaN-safe aggregates, "Na vyžiadanie" sentinel shown, CSV escaped + injection-safe,
 * memoised rows + deferred search for big projects, localized errors, select-all.
 */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

const green = "#00e5a0";
const amber = "#f5a623";
const blue = "#4a9eff";
const textLight = "#e8e8ed";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#0a0a0b";
const bg2 = "#0e0e10";
const mono = "'JetBrains Mono', monospace";

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
const fin = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmt = (n) => { const x = fin(n); return x == null ? "—" : Math.round(x).toLocaleString("sk-SK"); };
const fmt1 = (n) => { const x = fin(n); return x == null ? "—" : x.toFixed(1); };
const izbyTxt = (s) => (s == null ? "—" : String(s).replace(/\.0$/, ""));
const avgFin = (arr, f) => { const v = arr.map((r) => fin(f(r))).filter((n) => n != null); return v.length ? v.reduce((a, n) => a + n, 0) / v.length : null; };

const STAVY = [["all", "Všetky", "All"], ["V", "Voľné", "Available"], ["P", "Predané", "Sold"], ["R", "Rezervované", "Reserved"], ["PR", "Predrezerv.", "Pre-reserved"]];
const stavColor = (s) => (s === "V" ? green : s === "P" ? dim : s === "R" ? amber : s === "PR" ? blue : textLight);
const COUNTRIES = { SK: "Slovensko", CZ: "Česko" };

const COLS = [
  ["unit_id", "Byt", "Unit", "t"],
  ["poschodie", "Posch.", "Floor", "n"],
  ["izby", "Izby", "Rooms", "n"],
  ["obytna", "Obytná m²", "Living m²", "n"],
  ["celkova", "Celková m²", "Total m²", "n"],
  ["cena", "Cena €", "Price €", "n"],
  ["eur_m2", "€/m²", "€/m²", "n"],
  ["orientacia", "Orient.", "Orient.", "t"],
  ["stav", "Stav", "Status", "t"],
];
const TD = COLS.map((c) => ({ padding: "8px 11px", textAlign: c[3] === "n" ? "right" : "left", color: textLight, fontSize: 13, whiteSpace: "nowrap" }));
const TH = COLS.map((c) => ({ padding: "9px 11px", textAlign: c[3] === "n" ? "right" : "left", color: dim, fontFamily: mono, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", borderBottom: `1px solid ${border}` }));
const selStyle = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, padding: "9px 12px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 14, outline: "none" };

function cellNode(u, key) {
  if (key === "stav") return <span style={{ color: stavColor(u.stav), fontWeight: 600 }}>{u.stav}</span>;
  if (key === "izby") return izbyTxt(u.izby);
  if (key === "obytna" || key === "celkova") return fmt1(u[key]);
  if (key === "cena") return u.cena != null ? fmt(u.cena) : (u.cena_text || "—");
  if (key === "eur_m2") return fmt(u.eur_m2);
  return u[key] == null ? "—" : u[key];
}
const Row = memo(function Row({ u, isChecked, onToggle, lang }) {
  return (
    <tr style={{ borderBottom: `1px solid ${border}`, background: isChecked ? "rgba(0,229,160,0.06)" : "transparent" }}>
      <td style={{ padding: "8px 11px" }}>
        <input type="checkbox" checked={isChecked} onChange={() => onToggle(u.unit_id)}
          aria-label={(lang === "sk" ? "Vybrať byt " : "Select unit ") + u.unit_id} />
      </td>
      {COLS.map((c, i) => <td key={c[0]} style={TD[i]}>{cellNode(u, c[0])}</td>)}
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
        const sorted = [...(Array.isArray(d) ? d : [])].sort((a, b) => (a.scrape_date < b.scrape_date ? 1 : -1));
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

  const matches = useMemo(() => {
    if (!projects) return [];
    const q = norm(query);
    return projects.filter((p) =>
      (!fCountry || p.country === fCountry) &&
      (!fRegion || p.region === fRegion) &&
      (!fCity || p.city === fCity) &&
      (!q || norm(p.name).includes(q) || norm(p.city).includes(q))
    );
  }, [projects, query, fCountry, fRegion, fCity]);

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

  const rows = useMemo(() => {
    if (!units) return [];
    let r = units;
    if (stav !== "all") r = r.filter((u) => u.stav === stav);
    const q = norm(dSearch);
    if (q) r = r.filter((u) => norm(u.unit_id).includes(q));
    const c = sortCol, dir = sortDir;
    const numeric = COLS.find((x) => x[0] === c)?.[3] === "n";
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
    const head = ["Projekt", "Dátum", ...COLS.map((c) => c[1])];
    const lines = [head.map(csvCell).join(";")];
    rows.forEach((u) => {
      const vals = COLS.map((c) => c[0] === "izby" ? izbyTxt(u.izby)
        : c[0] === "cena" ? (u.cena != null ? u.cena : (u.cena_text || ""))
        : (u[c[0]] == null ? "" : u[c[0]]));
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

  return (
    <div style={{ minHeight: "100vh", background: bg, color: textLight, padding: "1.5rem 1.75rem" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{t("Data control", "Kontrola dát")}</h1>
        <p style={{ margin: "4px 0 0", color: dim, fontSize: 13 }}>
          {t("Pick a project + date, compare our data against the developer's website.",
             "Vyber projekt + dátum, porovnaj naše dáta s webom developera.")}
        </p>
      </div>

      {err && <div style={{ ...card, borderColor: amber, color: amber, marginBottom: 14 }}>{mapErr(err)}</div>}
      {!projects && !err && <div style={{ color: dim, fontFamily: mono, fontSize: 13 }}>{t("Loading projects…", "Načítavam projekty…")}</div>}

      {projects && (
        <>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div style={{ minWidth: 140 }}>
            <label style={cardLabel}>{t("Country", "Krajina")}</label>
            <select value={fCountry} onChange={(e) => { setFCountry(e.target.value); setFRegion(""); setFCity(""); }} style={selStyle}>
              <option value="">{t("All", "Všetky")}</option>
              {opts.countries.map((c) => <option key={c} value={c}>{COUNTRIES[c] || c}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 170 }}>
            <label style={cardLabel}>{t("Region", "Kraj")}</label>
            <select value={fRegion} onChange={(e) => { setFRegion(e.target.value); setFCity(""); }} style={selStyle}>
              <option value="">{t("All", "Všetky")}</option>
              {opts.regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label style={cardLabel}>{t("City", "Mesto")}</label>
            <select value={fCity} onChange={(e) => setFCity(e.target.value)} style={selStyle}>
              <option value="">{t("All", "Všetky")}</option>
              {opts.cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {(fCountry || fRegion || fCity) && (
            <button onClick={() => { setFCountry(""); setFRegion(""); setFCity(""); }} style={{ ...btn, padding: "8px 12px", fontSize: 12 }}>{t("Clear", "Zrušiť filtre")}</button>
          )}
          <span style={{ fontSize: 12, color: dim, fontFamily: mono, paddingBottom: 9 }}>{matches.length} {t("projects", "projektov")}</span>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
          <div ref={boxRef} style={{ position: "relative", flex: "1 1 280px", minWidth: 240 }}>
            <label style={cardLabel}>{t("Project", "Projekt")}</label>
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
            <label style={cardLabel}>{t("Date (snapshot)", "Dátum (snapshot)")}</label>
            <select value={date} onChange={(e) => changeDate(e.target.value)} disabled={!sel} style={selStyle}>
              {dates.length === 0 && <option value="">—</option>}
              {dates.map((d, i) => (
                <option key={d.scrape_date} value={d.scrape_date}>{d.scrape_date}{i === 0 ? t(" (latest)", " (najnovšie)") : ""} · {d.units}</option>
              ))}
            </select>
          </div>

          {sel && sel.project_url && (
            <a href={sel.project_url} target="_blank" rel="noopener noreferrer"
              style={{ ...btn, borderColor: green, color: green, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }}>
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
            <div style={card}><div style={cardLabel}>{t("Units total", "Bytov spolu")}</div><div style={cardVal}>{fmt(snap?.total)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Available", "Voľných")}</div><div style={{ ...cardVal, color: green }}>{fmt(snap?.v)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Sold", "Predaných")}</div><div style={cardVal}>{fmt(snap?.p)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Reserved", "Rezervované")}</div><div style={cardVal}>{fmt(snap?.r)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Pre-reserved", "Predrezerv.")}</div><div style={cardVal}>{fmt(snap?.pr)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Avg €/m²", "Priemer €/m²")}</div><div style={cardVal}>{fmt(snap?.avgPsm)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Price from–to", "Cena od–do")}</div><div style={{ ...cardVal, fontSize: 15 }}>{fmt(snap?.minP)} – {fmt(snap?.maxP)} €</div></div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            {STAVY.map((s) => {
              const on = stav === s[0];
              return <button key={s[0]} onClick={() => { setStav(s[0]); setChecked({}); }}
                style={{ ...btn, padding: "6px 12px", fontSize: 12, borderColor: on ? green : border, color: on ? green : textLight, background: on ? "rgba(0,229,160,0.08)" : "transparent" }}>{t(s[2], s[1])}</button>;
            })}
            <input value={uSearch} onChange={(e) => setUSearch(e.target.value)} placeholder={t("search unit…", "hľadať byt…")}
              style={{ marginLeft: "auto", padding: "7px 11px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 13, outline: "none", width: 150 }} />
            <button onClick={exportCsv} style={{ ...btn, padding: "7px 12px", fontSize: 12 }} title={t("Export shown rows to CSV", "Stiahnuť zobrazené riadky do CSV")}>CSV ↓</button>
          </div>

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
                      {COLS.map((c, i) => (
                        <th key={c[0]} style={TH[i]} aria-sort={sortCol === c[0] ? (sortDir > 0 ? "ascending" : "descending") : "none"}
                          onClick={() => { if (sortCol === c[0]) setSortDir(-sortDir); else { setSortCol(c[0]); setSortDir(1); } }}>
                          {t(c[2], c[1])}{sortCol === c[0] ? (sortDir > 0 ? " ↑" : " ↓") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => <Row key={u.unit_id} u={u} isChecked={!!checked[u.unit_id]} onToggle={onToggle} lang={lang} />)}
                    {rows.length === 0 && <tr><td colSpan={COLS.length + 1} style={{ padding: "1.2rem", color: dim, fontSize: 13, textAlign: "center" }}>{t("No units for this filter.", "Žiadne byty pre tento filter.")}</td></tr>}
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
