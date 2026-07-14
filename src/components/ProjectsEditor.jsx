/**
 * ProjectsEditor — editable mirror of "01 Vsetky projekty" inside Data Control.
 *
 * Edits the project CONFIG (name, status, city, district, sub-district, address,
 * developer) straight in reference.projects via the admin_update_project RPC,
 * which also propagates the change so it's live on the website + analytics
 * IMMEDIATELY (re-stamps the frozen analytics copies + rebuilds the list/cube) —
 * not next snapshot. Admin-gated server-side (fails closed). Counts are read-only
 * (they come from scrapes).
 */
import { useEffect, useMemo, useState } from "react";

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
  if (!token) throw new Error("Couldn't read your session — reload and sign in again.");
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

const STATUSES = [
  { v: "active", sk: "Aktívny", en: "Active" },
  { v: "paused", sk: "Pozastavený", en: "Paused" },
  { v: "sold_out", sk: "Vypredaný", en: "Sold out" },
];

const GREEN = "#00e5a0", BORDER = "var(--border)", BG = "var(--surface-2)", FG = "var(--text)", MUTED = "var(--text-dim)";
const inputStyle = {
  width: "100%", background: "#16181d", color: FG, border: `1px solid ${BORDER}`,
  borderRadius: 6, padding: "5px 7px", fontSize: "0.8rem", boxSizing: "border-box",
};
const th = { textAlign: "left", padding: "8px 10px", fontSize: "0.7rem", textTransform: "uppercase",
  letterSpacing: "0.05em", color: MUTED, borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, background: BG, whiteSpace: "nowrap" };
const td = { padding: "5px 6px", borderBottom: `1px solid ${BORDER}`, verticalAlign: "middle" };

export default function ProjectsEditor({ lang = "sk" }) {
  const sk = lang === "sk";
  const [rows, setRows] = useState(null);
  const [cities, setCities] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState("");
  const [fCountry, setFCountry] = useState("");
  const [edits, setEdits] = useState({});        // { id: { field: value } }
  const [savingId, setSavingId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      rpcDirect("admin_list_projects", {}),
      rpcDirect("admin_list_cities", {}),
      rpcDirect("admin_list_developers", {}),
    ]).then(([p, c, d]) => {
      if (!alive) return;
      setRows(p || []); setCities(c || []); setDevelopers(d || []);
    }).catch((e) => alive && setErr(e.message || String(e)));
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); }, [toast]);

  const setField = (id, field, value) => setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), [field]: value } }));
  const valueOf = (row, field) => { const e = edits[row.id]; return e && field in e ? e[field] : (row[field] ?? ""); };
  const isDirty = (row) => {
    const e = edits[row.id]; if (!e) return false;
    return Object.entries(e).some(([k, v]) => (v ?? "") !== (row[k] ?? ""));
  };

  async function save(row) {
    setSavingId(row.id);
    try {
      const out = await rpcDirect("admin_update_project", {
        p_id: row.id,
        p_name: valueOf(row, "name"),
        p_status: valueOf(row, "status"),
        p_city_id: valueOf(row, "city_id") || null,
        p_district: valueOf(row, "district") || null,
        p_sub_district: valueOf(row, "sub_district") || null,
        p_address: valueOf(row, "address") || null,
        p_developer_id: valueOf(row, "developer_id") || null,
      });
      const u = Array.isArray(out) ? out[0] : out;
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...u } : r)));
      setEdits((e) => { const n = { ...e }; delete n[row.id]; return n; });
      setToast({ ok: true, msg: sk ? "Uložené — naživo na webe aj v analytike" : "Saved — live on the site + analytics" });
    } catch (e) {
      setToast({ ok: false, msg: (e.message || String(e)).slice(0, 140) });
    } finally { setSavingId(null); }
  }

  const countries = useMemo(() => [...new Set((rows || []).map((r) => r.country_code).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (!fCountry || r.country_code === fCountry) &&
      (!q || (r.name || "").toLowerCase().includes(q) || (r.city_name || "").toLowerCase().includes(q) || (r.developer_name || "").toLowerCase().includes(q)));
  }, [rows, search, fCountry]);

  if (err) return <div style={{ color: "#f85149", padding: "1rem" }}>{sk ? "Chyba" : "Error"}: {err}</div>;
  if (!rows) return <div style={{ color: MUTED, padding: "1rem" }}>{sk ? "Načítavam projekty…" : "Loading projects…"}</div>;

  return (
    <div style={{ padding: "0.5rem 0.25rem", color: FG }}>
      <div style={{ fontSize: "0.8rem", color: MUTED, marginBottom: "0.7rem", lineHeight: 1.5 }}>
        {sk
          ? "Uprav konfiguráciu projektu priamo tu. Zmena sa uloží do databázy a okamžite sa prejaví na webe aj v analytike (nečaká na ďalší scrape). Počty bytov sú len na čítanie — tie prichádzajú zo scrapov."
          : "Edit project config directly here. A change saves to the database and is live on the website + analytics immediately (not next scrape). Unit counts are read-only — they come from scrapes."}
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={sk ? "Hľadať projekt / mesto / developera…" : "Search project / city / developer…"}
          style={{ ...inputStyle, width: 320, maxWidth: "70vw" }} />
        {countries.length > 1 && (
          <select value={fCountry} onChange={(e) => setFCountry(e.target.value)} style={{ ...inputStyle, width: 130 }}>
            <option value="">{sk ? "Všetky krajiny" : "All countries"}</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <span style={{ alignSelf: "center", color: MUTED, fontSize: "0.78rem" }}>{filtered.length} / {rows.length}</span>
      </div>

      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 230px)", border: `1px solid ${BORDER}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1050, fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ ...th, minWidth: 180 }}>{sk ? "Projekt" : "Project"}</th>
              <th style={{ ...th, minWidth: 120 }}>{sk ? "Stav" : "Status"}</th>
              <th style={{ ...th, minWidth: 150 }}>{sk ? "Mesto" : "City"}</th>
              <th style={{ ...th, minWidth: 140 }}>{sk ? "Mestská časť" : "District"}</th>
              <th style={{ ...th, minWidth: 130 }}>{sk ? "Sub-časť" : "Sub-district"}</th>
              <th style={{ ...th, minWidth: 170 }}>{sk ? "Adresa" : "Address"}</th>
              <th style={{ ...th, minWidth: 160 }}>{sk ? "Developer" : "Developer"}</th>
              <th style={{ ...th, width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const dirty = isDirty(row);
              return (
                <tr key={row.id} style={{ background: dirty ? "#16210f" : "transparent" }}>
                  <td style={td}><input value={valueOf(row, "name")} onChange={(e) => setField(row.id, "name", e.target.value)} style={inputStyle} /></td>
                  <td style={td}>
                    <select value={valueOf(row, "status")} onChange={(e) => setField(row.id, "status", e.target.value)} style={inputStyle}>
                      {STATUSES.map((s) => <option key={s.v} value={s.v}>{sk ? s.sk : s.en}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <select value={valueOf(row, "city_id") || ""} onChange={(e) => setField(row.id, "city_id", e.target.value)} style={inputStyle}>
                      {/* city is required (NOT NULL) — no empty option */}
                      {!valueOf(row, "city_id") && <option value="">—</option>}
                      {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td style={td}><input value={valueOf(row, "district")} onChange={(e) => setField(row.id, "district", e.target.value)} style={inputStyle} /></td>
                  <td style={td}><input value={valueOf(row, "sub_district")} onChange={(e) => setField(row.id, "sub_district", e.target.value)} style={inputStyle} /></td>
                  <td style={td}><input value={valueOf(row, "address")} onChange={(e) => setField(row.id, "address", e.target.value)} style={inputStyle} /></td>
                  <td style={td}>
                    <select value={valueOf(row, "developer_id") || ""} onChange={(e) => setField(row.id, "developer_id", e.target.value)} style={inputStyle}>
                      <option value="">—</option>
                      {developers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button disabled={!dirty || savingId === row.id} onClick={() => save(row)}
                      style={{
                        background: dirty ? GREEN : "#2a2d34", color: dirty ? "#0b0b0b" : MUTED,
                        border: "none", borderRadius: 6, padding: "5px 10px", fontSize: "0.78rem",
                        fontWeight: 700, cursor: dirty ? "pointer" : "default", whiteSpace: "nowrap",
                      }}>
                      {savingId === row.id ? "…" : (sk ? "Uložiť" : "Save")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: toast.ok ? "#15331b" : "#3a1416", color: toast.ok ? GREEN : "#f85149",
          border: `1px solid ${toast.ok ? GREEN : "#f85149"}55`, padding: "10px 16px",
          borderRadius: 8, fontSize: "0.82rem", zIndex: 100, maxWidth: "90vw",
        }}>{toast.msg}</div>
      )}
    </div>
  );
}
