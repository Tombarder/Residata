/**
 * TextsEditor — admin-only "Texts / Texty" tool to edit website copy live.
 *
 * THE MODEL (see lib/copyOverrides.js): the in-code dictionaries are the
 * permanent DEFAULTS. This tool writes per-(key,lang) OVERRIDES into
 * public.site_content; an override WINS over the default on the live site the
 * moment it's saved (no deploy). Reset deletes the override → the code default
 * renders again. The site can never go blank — an empty table = today's copy.
 *
 * TWO dictionaries share the table, namespaced so identical bare keys can't
 * collide: "mk" = marketing copy (`t` in lib/marketingCopy.js), "lv" = the
 * live/app + login + admin copy (`liveT` in liveLang.js). Stored key =
 * `${ns}:${bareKey}`.
 *
 * LANGUAGES: SK + EN are live on the public switcher. CZ ('cs') is editable here
 * already (so the copy can be written ahead of time) but stays hidden from public
 * visitors until it's turned on — until then untranslated Czech falls back to EN.
 *
 * COVERAGE: this edits the centralized copy dictionaries — all the marketing
 * pages + the live/app/login copy. A small set of UI-chrome micro-labels (menu
 * items, some buttons) still live inline in code; ask to have any specific text
 * lifted in if you want to edit it.
 *
 * SECURITY mirrors LocationManager: writes go through admin-gated SECURITY
 * DEFINER RPCs (admin_*_site_content), called via a direct PostgREST fetch that
 * reads the stored access token synchronously (supabase.rpc()'s internal
 * getSession() can hang under auth-lock contention).
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { t as marketingDict } from "../lib/marketingCopy";
import { liveT } from "../lib/liveLang";
import { refreshOverrides } from "../lib/copyOverrides";
import {
  accent as green, orange as amber, text as textLight, dim, faint,
  border, bg, surfaceDark as bg2, mono,
} from "../lib/theme";

// ── Direct PostgREST RPC (same rationale as LocationManager) ─────────────────
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
async function rpcDirect(fn, body, { timeoutMs = 20000 } = {}) {
  const token = storedAccessToken();
  if (!token) throw new Error("Couldn't read your session — reload the page and sign in again.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPA_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* */ }
      throw new Error(msg);
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Languages ────────────────────────────────────────────────────────────────
const LANGS = [
  { code: "sk", label: "SK" },
  { code: "en", label: "EN" },
  { code: "cs", label: "CZ", note: "not yet public" },
];
const FILL_LANGS = ["sk", "en", "cs"];

// ── Classify a default value into how we edit it ─────────────────────────────
function classify(v) {
  if (typeof v === "string") return "string";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return "list";
  return "structured"; // arrays of arrays/objects, nested objects — Phase 2 UI
}

const SOURCES = [
  { ns: "mk", dict: marketingDict, label: "Marketing site", hint: "Home, hero, value props, use cases, pricing, contact" },
  { ns: "lv", dict: liveT,         label: "Platform & app", hint: "Dashboard, project detail, login, profile, gates, ticker" },
];

// Build the editable key universe from the code dicts (EN is the canonical key set).
function buildRows() {
  const rows = [];
  for (const { ns, dict, label, hint } of SOURCES) {
    const keys = Object.keys(dict.en || {});
    const items = keys.map((key) => {
      const def = dict.en?.[key];
      return {
        ns, key, type: classify(def),
        def: { sk: dict.sk?.[key], en: dict.en?.[key], cs: dict.cs?.[key] },
      };
    });
    rows.push({ ns, label, hint, items });
  }
  return rows;
}

function defaultFor(item, lang) {
  // cs has no code default → fall back to EN so the row shows something useful.
  if (lang === "cs") return item.def.cs ?? item.def.en;
  return item.def[lang];
}
function previewText(v, max = 90) {
  let s = "";
  if (typeof v === "string") s = v;
  else if (Array.isArray(v)) s = v.join(" · ");
  else s = JSON.stringify(v);
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export default function TextsEditor({ lang = "en" }) {
  const uiSK = lang === "sk";
  const sections = useMemo(() => buildRows(), []);
  const [activeLang, setActiveLang] = useState("sk");
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState("all"); // all | edited | untranslated
  const [overrides, setOverrides] = useState({}); // `${lang}|${ns}:${key}` -> value
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState({}); // rowId -> true (unsaved typed edits)

  const setRowDirty = useCallback((id, isDirty) => {
    setDirty((d) => {
      if (isDirty === !!d[id]) return d;
      const n = { ...d };
      if (isDirty) n[id] = true; else delete n[id];
      return n;
    });
  }, []);
  const dirtyCount = Object.keys(dirty).length;

  // Guard against losing typed-but-unsaved edits on a hard navigation / reload.
  useEffect(() => {
    if (!dirtyCount) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirtyCount]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const rows = await rpcDirect("admin_list_site_content", {});
      const map = {};
      for (const r of rows || []) map[`${r.lang}|${r.key}`] = r.value;
      setOverrides(map);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function saveOverride(ns, key, value) {
    const storedKey = `${ns}:${key}`;
    await rpcDirect("admin_upsert_site_content", { p_key: storedKey, p_lang: activeLang, p_value: value });
    setOverrides((m) => ({ ...m, [`${activeLang}|${storedKey}`]: value }));
    refreshOverrides(); // push the change to the live overlay immediately
  }
  async function resetOverride(ns, key) {
    const storedKey = `${ns}:${key}`;
    await rpcDirect("admin_delete_site_content", { p_key: storedKey, p_lang: activeLang });
    setOverrides((m) => { const n = { ...m }; delete n[`${activeLang}|${storedKey}`]; return n; });
    refreshOverrides();
  }

  function switchLang(code) {
    if (code === activeLang) return;
    if (dirtyCount > 0 && !window.confirm(uiSK
      ? `Máš ${dirtyCount} neuložených úprav. Prepnutím jazyka sa zahodia. Pokračovať?`
      : `You have ${dirtyCount} unsaved edit(s). Switching language discards them. Continue?`)) return;
    setDirty({});
    setActiveLang(code);
  }

  const q = search.trim().toLowerCase();
  const hasOv = (langCode, ns, key) => overrides[`${langCode}|${ns}:${key}`] !== undefined;
  const editedInLang = (langCode) =>
    Object.keys(overrides).filter((k) => k.startsWith(langCode + "|")).length;

  const FILTERS = [
    { id: "all", label: uiSK ? "Všetky" : "All" },
    { id: "edited", label: uiSK ? "Upravené" : "Edited" },
    { id: "untranslated", label: activeLang === "cs" ? (uiSK ? "Nepreložené" : "Untranslated") : (uiSK ? "Neupravené" : "Default" ) },
  ];

  return (
    <div style={{ padding: "1.5rem 1.25rem", maxWidth: 1000, margin: "0 auto", color: textLight, fontFamily: mono }}>
      <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 0.3rem" }}>
        {uiSK ? "Texty na webe" : "Website texts"}
      </h1>
      <p style={{ color: dim, fontSize: "0.78rem", lineHeight: 1.5, margin: "0 0 1rem", maxWidth: 720 }}>
        {uiSK
          ? "Uprav ľubovoľný text na webe. Ulož → ihneď naživo, bez nasadenia. Prázdne pole = pôvodný text (default v kóde). „Reset“ vráti default. Každý jazyk je samostatný — nie preklad."
          : "Edit any text on the site. Save → live instantly, no deploy. An empty field = the original (code default). “Reset” restores the default. Each language is independent — not a translation."}
      </p>

      {/* Language tabs */}
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.6rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", color: faint, marginRight: 4 }}>
          {uiSK ? "Jazyk" : "Language"}
        </span>
        {LANGS.map((L) => {
          const active = L.code === activeLang;
          const n = editedInLang(L.code);
          return (
            <button key={L.code} onClick={() => switchLang(L.code)} title={L.note || ""}
              style={{
                padding: "0.35rem 0.7rem", borderRadius: 7, cursor: "pointer",
                border: `1px solid ${active ? green : border}`,
                background: active ? green : "transparent",
                color: active ? "#06140f" : dim, fontWeight: active ? 700 : 500,
                fontFamily: mono, fontSize: "0.74rem", display: "flex", alignItems: "center", gap: 6,
              }}>
              {L.label}
              {n > 0 && <span style={{ fontSize: "0.58rem", background: active ? "#06140f" : border, color: active ? green : dim, borderRadius: 6, padding: "0 5px", fontWeight: 700 }}>{n}</span>}
              {L.note && <span style={{ fontSize: "0.56rem", opacity: 0.8, fontWeight: 500 }}>· {L.note}</span>}
            </button>
          );
        })}
        {dirtyCount > 0 && (
          <span style={{ marginLeft: "auto", fontSize: "0.66rem", color: amber, fontWeight: 600 }}>
            {uiSK ? `${dirtyCount} neuložených` : `${dirtyCount} unsaved`}
          </span>
        )}
      </div>

      {/* Filter + search */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2, background: bg2, border: `1px solid ${border}`, borderRadius: 7, padding: 2 }}>
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilterMode(f.id)}
              style={{
                padding: "0.3rem 0.6rem", borderRadius: 5, cursor: "pointer", border: "none",
                background: filterMode === f.id ? border : "transparent",
                color: filterMode === f.id ? textLight : dim, fontFamily: mono, fontSize: "0.68rem", fontWeight: 600,
              }}>{f.label}</button>
          ))}
        </div>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={uiSK ? "Hľadať v textoch alebo kľúčoch…" : "Search text or key…"}
          style={{
            flex: 1, minWidth: 200, padding: "0.5rem 0.7rem", boxSizing: "border-box",
            background: bg2, border: `1px solid ${border}`, borderRadius: 7, color: textLight,
            fontFamily: mono, fontSize: "0.78rem",
          }}
        />
      </div>

      {loading && <div style={{ color: dim, fontSize: "0.8rem", padding: "1rem 0" }}>{uiSK ? "Načítavam…" : "Loading…"}</div>}
      {error && (
        <div style={{ color: amber, fontSize: "0.78rem", padding: "0.6rem 0.8rem", border: `1px solid ${amber}`, borderRadius: 7, marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {!loading && sections.map((sec) => {
        const visible = sec.items.filter((it) => {
          const edited = hasOv(activeLang, it.ns, it.key);
          if (filterMode === "edited" && !edited) return false;
          if (filterMode === "untranslated" && edited) return false;
          if (!q) return true;
          if (it.key.toLowerCase().includes(q)) return true;
          const d = defaultFor(it, activeLang);
          return previewText(d, 99999).toLowerCase().includes(q);
        });
        if (!visible.length) return null;
        return (
          <section key={sec.ns} style={{ marginBottom: "1.6rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: "0.6rem", borderBottom: `1px solid ${border}`, paddingBottom: "0.35rem" }}>
              <h2 style={{ fontSize: "0.82rem", fontWeight: 700, margin: 0 }}>{sec.label}</h2>
              <span style={{ fontSize: "0.64rem", color: faint }}>{sec.hint}</span>
              <span style={{ marginLeft: "auto", fontSize: "0.64rem", color: faint }}>{visible.length}</span>
            </div>
            {visible.map((it) => (
              <Row
                key={`${it.ns}:${it.key}:${activeLang}`}
                item={it} lang={activeLang} uiSK={uiSK}
                stored={overrides[`${activeLang}|${it.ns}:${it.key}`]}
                fill={FILL_LANGS.reduce((a, lc) => (a[lc] = hasOv(lc, it.ns, it.key), a), {})}
                onSave={(val) => saveOverride(it.ns, it.key, val)}
                onReset={() => resetOverride(it.ns, it.key)}
                onDirty={(d) => setRowDirty(`${it.ns}:${it.key}`, d)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ── One editable copy row ────────────────────────────────────────────────────
function Row({ item, lang, uiSK, stored, fill, onSave, onReset, onDirty }) {
  const def = defaultFor(item, lang);
  const hasOverride = stored !== undefined && stored !== null;
  const csFallback = lang === "cs" && item.def.cs == null;

  const toText = (v) => (item.type === "list" ? (Array.isArray(v) ? v.join("\n") : "") : (typeof v === "string" ? v : ""));
  const initial = hasOverride ? toText(stored) : "";
  const [val, setVal] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  const isStructured = item.type === "structured";
  const dirty = isStructured ? false : (item.type === "list"
    ? JSON.stringify(val.split("\n").map((s) => s.trim()).filter(Boolean)) !== JSON.stringify(Array.isArray(stored) ? stored : [])
    : val !== (hasOverride ? stored : ""));
  const isEmpty = val.trim() === "";

  // Hooks run unconditionally (rules-of-hooks) — declared BEFORE any early return.
  // Report unsaved state up so the page can guard language switch / reload.
  useEffect(() => { onDirty(dirty && !isEmpty && !isStructured); }, [dirty, isEmpty, isStructured, onDirty]);
  // On unmount (lang switch / filter change), clear our dirty flag.
  useEffect(() => () => onDirty(false), [onDirty]);

  if (isStructured) {
    return (
      <div style={rowWrap}>
        <div style={keyCol}>
          <span style={keyLabel}>{item.key}</span>
          <FillDots fill={fill} />
          <span style={{ fontSize: "0.56rem", color: amber }}>{uiSK ? "štruktúrovaný blok" : "structured block"}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.68rem", color: faint, lineHeight: 1.5 }}>{previewText(def, 160)}</div>
          <div style={{ fontSize: "0.6rem", color: amber, marginTop: 4 }}>
            {uiSK ? "Zložený blok (zoznam/objekt) — editor príde vo Fáze 2." : "Composite block (list/object) — editor coming in Phase 2."}
          </div>
        </div>
      </div>
    );
  }

  async function doSave() {
    setBusy(true); setErr(null); setSaved(false);
    try {
      const value = item.type === "list" ? val.split("\n").map((s) => s.trim()).filter(Boolean) : val;
      await onSave(value);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }
  async function doReset() {
    setBusy(true); setErr(null);
    try { await onReset(); setVal(""); } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={rowWrap}>
      <div style={keyCol}>
        <span style={keyLabel}>{item.key}</span>
        <FillDots fill={fill} />
        {hasOverride && <span style={{ fontSize: "0.55rem", color: green }}>{uiSK ? "upravené" : "edited"}</span>}
        {csFallback && <span style={{ fontSize: "0.55rem", color: faint }}>EN fallback</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* EN reference when authoring SK/CZ — so each language is written naturally, not blind */}
        {lang !== "en" && item.def.en != null && (
          <div style={{ fontSize: "0.6rem", color: faint, marginBottom: 3, lineHeight: 1.4 }}>
            <span style={{ color: dim }}>EN:</span> {previewText(item.def.en, 140)}
          </div>
        )}
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={item.type === "list" ? (Array.isArray(def) ? def.join("\n") : "") : (def || "")}
          rows={item.type === "list" ? Math.min(8, Math.max(2, (Array.isArray(def) ? def.length : 1))) : (def && def.length > 70 ? 3 : 1)}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical",
            background: bg, border: `1px solid ${dirty ? green : border}`, borderRadius: 6,
            color: textLight, fontFamily: mono, fontSize: "0.76rem", lineHeight: 1.5, padding: "0.45rem 0.6rem",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, minHeight: 20, flexWrap: "wrap" }}>
          {dirty && !isEmpty && (
            <button onClick={doSave} disabled={busy} style={btn(green, "#06140f")}>
              {busy ? (uiSK ? "Ukladám…" : "Saving…") : (uiSK ? "Uložiť" : "Save")}
            </button>
          )}
          {hasOverride && (
            <button onClick={doReset} disabled={busy} style={btn("transparent", dim, border)}>
              {uiSK ? "Reset na default" : "Reset to default"}
            </button>
          )}
          {item.type === "list" && (
            <span style={{ fontSize: "0.58rem", color: faint }}>{uiSK ? "jeden riadok = jedna položka" : "one line = one item"}</span>
          )}
          {saved && <span style={{ fontSize: "0.62rem", color: green }}>✓ {uiSK ? "uložené — naživo" : "saved — live"}</span>}
          {err && <span style={{ fontSize: "0.62rem", color: amber }}>{err}</span>}
        </div>
        {!hasOverride && (
          <div style={{ fontSize: "0.6rem", color: faint, marginTop: 3 }}>
            {uiSK ? "Default: " : "Default: "}{previewText(def, 120) || (uiSK ? "(prázdne)" : "(empty)")}
          </div>
        )}
      </div>
    </div>
  );
}

// Per-key fill indicator: which languages already have an override.
function FillDots({ fill }) {
  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {FILL_LANGS.map((lc) => (
        <span key={lc} title={`${lc.toUpperCase()}: ${fill[lc] ? "edited" : "default"}`}
          style={{
            fontSize: "0.5rem", letterSpacing: "0.04em", fontWeight: 700,
            color: fill[lc] ? green : faint, opacity: fill[lc] ? 1 : 0.5,
          }}>{lc.toUpperCase()}</span>
      ))}
    </span>
  );
}

const rowWrap = { display: "flex", gap: "0.9rem", padding: "0.7rem 0", borderBottom: `1px solid ${border}`, alignItems: "flex-start" };
const keyCol = { width: 190, flexShrink: 0, display: "flex", flexDirection: "column", gap: 3, paddingTop: 4 };
const keyLabel = { fontSize: "0.66rem", color: dim, wordBreak: "break-word" };
function btn(bgc, color, bd) {
  return {
    padding: "0.28rem 0.6rem", borderRadius: 6, cursor: "pointer", fontFamily: mono, fontSize: "0.66rem",
    fontWeight: 600, border: `1px solid ${bd || bgc}`, background: bgc, color,
  };
}
