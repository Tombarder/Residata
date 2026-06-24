/**
 * DataQA — admin-only "Kontrola dát" tool.
 *
 * Lets an admin browse exactly what we scraped, per project and per scrape DATE
 * (snapshot), and eyeball-compare it against the developer's own website (one-click
 * open). Good overview: summary cards, sortable/filterable units table, and Excel-style
 * row-select aggregation (count / sum / average) for quick control.
 *
 * Data comes from three admin-gated RPCs (public._require_admin):
 *   admin_qa_projects()                 → project list + live counts + source URL
 *   admin_qa_dates(p_project_id)        → available snapshot dates for a project
 *   admin_qa_units(p_project_id, p_date)→ that project's units on that date
 * Read-only by design — this is for control, not editing.
 */
import { useEffect, useMemo, useRef, useState } from "react";

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
async function rpcDirect(fn, body, { timeoutMs = 30000 } = {}) {
  const token = storedAccessToken();
  if (!token) throw new Error("Couldn't read your session — reload the page and sign in again.");
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    if (r.status === 401) throw new Error("session-expired");
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => "")).slice(0, 160)}`);
    return await r.json();
  } finally { clearTimeout(killer); }
}

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const fmt = (n) => (n == null || n === "" ? "—" : Math.round(Number(n)).toLocaleString("sk-SK"));
const fmt1 = (n) => (n == null || n === "" ? "—" : Number(n).toFixed(1));
const izbyTxt = (s) => (s == null ? "—" : String(s).replace(/\.0$/, ""));

const STAVY = [["all", "Všetky", "All"], ["V", "Voľné", "Available"], ["P", "Predané", "Sold"], ["R", "Rezervované", "Reserved"], ["PR", "Predrezerv.", "Pre-reserved"]];
const stavColor = (s) => (s === "V" ? green : s === "P" ? dim : s === "R" ? amber : s === "PR" ? blue : textLight);

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

export default function DataQA({ lang = "sk" }) {
  const t = (en, sk) => (lang === "sk" ? sk : en);

  const [projects, setProjects] = useState(null);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);

  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [units, setUnits] = useState(null);
  const [uErr, setUErr] = useState(null);

  const [stav, setStav] = useState("all");
  const [uSearch, setUSearch] = useState("");
  const [sortCol, setSortCol] = useState("unit_id");
  const [sortDir, setSortDir] = useState(1);
  const [checked, setChecked] = useState({});
  const boxRef = useRef(null);

  useEffect(() => {
    rpcDirect("admin_qa_projects", {}).then(setProjects).catch((e) => setErr(e.message));
  }, []);

  function pick(p) {
    setSel(p); setQuery(p.name); setOpen(false);
    setUnits(null); setUErr(null); setChecked({}); setStav("all"); setUSearch("");
    rpcDirect("admin_qa_dates", { p_project_id: p.id }).then((d) => {
      setDates(d || []);
      const first = d && d.length ? d[0].scrape_date : null;
      setDate(first || "");
      loadUnits(p.id, first);
    }).catch((e) => setUErr(e.message));
  }
  function loadUnits(pid, d) {
    setUnits(null); setUErr(null); setChecked({});
    rpcDirect("admin_qa_units", { p_project_id: pid, p_date: d || null })
      .then(setUnits).catch((e) => setUErr(e.message));
  }
  function changeDate(d) { setDate(d); loadUnits(sel.id, d); }

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const matches = useMemo(() => {
    if (!projects) return [];
    const q = norm(query);
    const list = q ? projects.filter((p) => norm(p.name).includes(q) || norm(p.city).includes(q)) : projects;
    return list.slice(0, 60);
  }, [projects, query]);

  const rows = useMemo(() => {
    if (!units) return [];
    let r = units;
    if (stav !== "all") r = r.filter((u) => u.stav === stav);
    if (uSearch) { const q = norm(uSearch); r = r.filter((u) => norm(u.unit_id).includes(q)); }
    const c = sortCol, dir = sortDir;
    const numeric = COLS.find((x) => x[0] === c)?.[3] === "n";
    return [...r].sort((a, b) => {
      let x = a[c], y = b[c];
      if (numeric) { x = x == null ? -Infinity : Number(x); y = y == null ? -Infinity : Number(y); }
      else { x = x || ""; y = y || ""; }
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [units, stav, uSearch, sortCol, sortDir]);

  const selRows = rows.filter((r) => checked[r.unit_id]);
  const aggBase = selRows.length ? selRows : null;
  const priced = (aggBase || rows).filter((r) => r.cena != null);
  const avg = (arr, f) => (arr.length ? arr.reduce((s, r) => s + Number(f(r)), 0) / arr.length : null);

  const card = { background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 14px" };
  const cardLabel = { fontSize: 11, color: dim, fontFamily: mono, textTransform: "uppercase", letterSpacing: 0.4 };
  const cardVal = { fontSize: 22, fontWeight: 600, color: textLight, marginTop: 4 };
  const btn = { padding: "8px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textLight, cursor: "pointer", fontSize: 13 };
  const th = (c) => ({ padding: "9px 11px", textAlign: c[3] === "n" ? "right" : "left", color: dim, fontFamily: mono, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", borderBottom: `1px solid ${border}` });
  const td = (c) => ({ padding: "8px 11px", textAlign: c[3] === "n" ? "right" : "left", color: textLight, fontSize: 13, whiteSpace: "nowrap" });

  return (
    <div style={{ minHeight: "100vh", background: bg, color: textLight, padding: "1.5rem 1.75rem" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{t("Data control", "Kontrola dát")}</h1>
        <p style={{ margin: "4px 0 0", color: dim, fontSize: 13 }}>
          {t("Pick a project + date, compare our data against the developer's website.",
             "Vyber projekt + dátum, porovnaj naše dáta s webom developera.")}
        </p>
      </div>

      {err && <div style={{ ...card, borderColor: amber, color: amber, marginBottom: 14 }}>{err}</div>}
      {!projects && !err && <div style={{ color: dim, fontFamily: mono, fontSize: 13 }}>{t("Loading projects…", "Načítavam projekty…")}</div>}

      {projects && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
          <div ref={boxRef} style={{ position: "relative", flex: "1 1 280px", minWidth: 240 }}>
            <label style={cardLabel}>{t("Project", "Projekt")} ({projects.length})</label>
            <input
              value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
              placeholder={t("type to search…", "píš pre hľadanie…")}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 5, padding: "9px 12px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 14, outline: "none" }}
            />
            {open && matches.length > 0 && (
              <div style={{ position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, marginTop: 4, maxHeight: 320, overflowY: "auto", background: bg2, border: `1px solid ${border}`, borderRadius: 8 }}>
                {matches.map((p) => (
                  <div key={p.id} onClick={() => pick(p)}
                    style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${border}`, display: "flex", justifyContent: "space-between", gap: 10 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = bg)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ fontSize: 13 }}>{p.name}</span>
                    <span style={{ fontSize: 12, color: dim, fontFamily: mono }}>{p.city} · {p.total_units}{t(" units", " bytov")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ minWidth: 170 }}>
            <label style={cardLabel}>{t("Date (snapshot)", "Dátum (snapshot)")}</label>
            <select value={date} onChange={(e) => changeDate(e.target.value)} disabled={!sel}
              style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, padding: "9px 12px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 14, outline: "none" }}>
              {dates.length === 0 && <option>—</option>}
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
      )}

      {sel && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 16 }}>
            <div style={card}><div style={cardLabel}>{t("Units total", "Bytov spolu")}</div><div style={cardVal}>{fmt(sel.total_units)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Available", "Voľných")}</div><div style={{ ...cardVal, color: green }}>{fmt(sel.available_units)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Sold", "Predaných")}</div><div style={cardVal}>{fmt(sel.sold_units)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Reserved", "Rezervovaných")}</div><div style={cardVal}>{fmt(sel.reserved_units)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Avg €/m²", "Priemer €/m²")}</div><div style={cardVal}>{fmt(sel.avg_eur_m2)}</div></div>
            <div style={card}><div style={cardLabel}>{t("Price from–to", "Cena od–do")}</div><div style={{ ...cardVal, fontSize: 15 }}>{fmt(sel.min_price)} – {fmt(sel.max_price)} €</div></div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            {STAVY.map((s) => {
              const on = stav === s[0];
              return <button key={s[0]} onClick={() => { setStav(s[0]); setChecked({}); }}
                style={{ ...btn, padding: "6px 12px", fontSize: 12, borderColor: on ? green : border, color: on ? green : textLight, background: on ? "rgba(0,229,160,0.08)" : "transparent" }}>{t(s[2], s[1])}</button>;
            })}
            <input value={uSearch} onChange={(e) => setUSearch(e.target.value)} placeholder={t("search unit…", "hľadať byt…")}
              style={{ marginLeft: "auto", padding: "7px 11px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 13, outline: "none", width: 160 }} />
          </div>

          {uErr && <div style={{ ...card, borderColor: amber, color: amber }}>{uErr}</div>}
          {!units && !uErr && <div style={{ color: dim, fontFamily: mono, fontSize: 13, padding: "1rem 0" }}>{t("Loading units…", "Načítavam byty…")}</div>}

          {units && (
            <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: bg2 }}>
                      <th style={{ ...th(["", "", "", "t"]), width: 34 }}></th>
                      {COLS.map((c) => (
                        <th key={c[0]} style={th(c)} onClick={() => { if (sortCol === c[0]) setSortDir(-sortDir); else { setSortCol(c[0]); setSortDir(1); } }}>
                          {t(c[2], c[1])}{sortCol === c[0] ? (sortDir > 0 ? " ↑" : " ↓") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => (
                      <tr key={u.unit_id} style={{ borderBottom: `1px solid ${border}`, background: checked[u.unit_id] ? "rgba(0,229,160,0.06)" : "transparent" }}>
                        <td style={{ padding: "8px 11px" }}>
                          <input type="checkbox" checked={!!checked[u.unit_id]} onChange={(e) => setChecked((c) => ({ ...c, [u.unit_id]: e.target.checked }))} />
                        </td>
                        {COLS.map((c) => {
                          let v;
                          if (c[0] === "stav") v = <span style={{ color: stavColor(u.stav), fontWeight: 600 }}>{u.stav}</span>;
                          else if (c[0] === "izby") v = izbyTxt(u.izby);
                          else if (c[0] === "obytna" || c[0] === "celkova") v = fmt1(u[c[0]]);
                          else if (c[0] === "cena" || c[0] === "eur_m2") v = fmt(u[c[0]]);
                          else v = u[c[0]] == null ? "—" : u[c[0]];
                          return <td key={c[0]} style={td(c)}>{v}</td>;
                        })}
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={COLS.length + 1} style={{ padding: "1.2rem", color: dim, fontSize: 13, textAlign: "center" }}>{t("No units for this filter.", "Žiadne byty pre tento filter.")}</td></tr>}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "11px 14px", background: bg2, borderTop: `1px solid ${border}`, fontSize: 13, color: textLight }}>
                <span style={{ color: dim, fontFamily: mono, fontSize: 12 }}>
                  {aggBase ? t(`${selRows.length} selected`, `vybrané: ${selRows.length}`) : t(`${rows.length} shown`, `zobrazené: ${rows.length}`)}
                </span>
                <span>{t("Σ price", "Σ cena")}: <b>{priced.length ? fmt(priced.reduce((s, r) => s + Number(r.cena), 0)) + " €" : "—"}</b></span>
                <span>{t("avg price", "Ø cena")}: <b>{priced.length ? fmt(avg(priced, (r) => r.cena)) + " €" : "—"}</b></span>
                <span>{t("avg €/m²", "Ø €/m²")}: <b>{(() => { const a = (aggBase || rows).filter((r) => r.eur_m2 != null); return a.length ? fmt(avg(a, (r) => r.eur_m2)) : "—"; })()}</b></span>
                <span>{t("avg area", "Ø plocha")}: <b>{(() => { const a = (aggBase || rows).filter((r) => r.obytna != null); return a.length ? fmt1(avg(a, (r) => r.obytna)) + " m²" : "—"; })()}</b></span>
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
