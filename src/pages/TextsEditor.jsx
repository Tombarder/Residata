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
 * EDIT-IN-PLACE: each field is pre-filled with the text that's live right now
 * (override if set, else the code default) so you tweak it in place — never
 * retype from a blank box. Save appears only when the text differs from the code
 * default; if you edit a saved override back to exactly the default, the tool
 * offers Reset (remove the row) instead of saving a redundant copy.
 *
 * NO LOST EDITS: typed-but-unsaved text lives in the PARENT (`drafts`), keyed by
 * key. Filtering/searching unmounts rows, but the draft survives — switching
 * language or reloading is the only thing that discards (with a confirm).
 *
 * STRUCTURED BLOCKS: composite copy (arrays-of-arrays / arrays-of-objects, e.g.
 * deliveryItems, useCases, tiers) is edited by StructuredRow — a recursive
 * editor with repeatable rows + the right sub-fields. It serializes back to the
 * SAME JSON shape, so the overlay merges it by key like any other value; its
 * working value is held in `drafts` as JSON text, so the same no-lost-edits and
 * unsaved-guard behavior applies.
 *
 * LANGUAGES: SK + EN + CZ are all live on the public switcher (CZ launched
 * 2026-06-30). Untranslated Czech keys fall back to EN, so it's safe to leave
 * any cs cell blank — the public site shows English there, never blank.
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
  { code: "cs", label: "CZ" },
];
const FILL_LANGS = ["sk", "en", "cs"];

// ── Value helpers (string | list shared between parent + Row) ────────────────
function classify(v) {
  if (typeof v === "string") return "string";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return "list";
  return "structured"; // arrays of arrays/objects, nested objects — StructuredRow editor
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
// value (string | string[]) -> textarea text
function toText(v, type) {
  if (type === "list") return Array.isArray(v) ? v.join("\n") : "";
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
// textarea text -> value (string | string[])
function parseDraft(text, type) {
  return type === "list" ? text.split("\n").map((s) => s.trim()).filter(Boolean) : text;
}
const sameVal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// {token} placeholders present in `a` but dropped from `b`
function missingTokens(a, b) {
  const re = /\{[a-zA-Z_]\w*\}/g;
  const inA = a.match(re);
  if (!inA || !inA.length) return [];
  const inB = new Set(b.match(re) || []);
  return [...new Set(inA)].filter((tok) => !inB.has(tok));
}

const SOURCES = [
  { ns: "mk", dict: marketingDict, label: "Marketing site", hint: "Home, hero, value props, use cases, pricing, contact" },
  { ns: "lv", dict: liveT,         label: "Platform & app", hint: "Dashboard, project detail, login, profile, gates, ticker" },
];

// Build the editable key universe — UNION of all languages' keys, so a key that
// exists in only one language is still editable (never silently missing).
function buildRows() {
  return SOURCES.map(({ ns, dict, label, hint }) => {
    const keys = [...new Set([
      ...Object.keys(dict.en || {}),
      ...Object.keys(dict.sk || {}),
      ...Object.keys(dict.cs || {}),
    ])];
    const items = keys.map((key) => {
      const def = dict.en?.[key] ?? dict.sk?.[key] ?? dict.cs?.[key];
      return { ns, key, type: classify(def), def: { sk: dict.sk?.[key], en: dict.en?.[key], cs: dict.cs?.[key] } };
    });
    return { ns, label, hint, items };
  });
}

function defaultFor(item, lang) {
  // cs has no code default → fall back to EN so the row shows something useful.
  if (lang === "cs") return item.def.cs ?? item.def.en;
  return item.def[lang] ?? item.def.en;
}
function previewText(v, max = 90) {
  let s = typeof v === "string" ? v : Array.isArray(v) ? v.join(" · ") : JSON.stringify(v);
  s = (s || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export default function TextsEditor({ lang = "en" }) {
  const uiSK = lang === "sk";
  const sections = useMemo(() => buildRows(), []);
  const itemByKey = useMemo(() => {
    const m = {};
    for (const sec of sections) for (const it of sec.items) m[`${it.ns}:${it.key}`] = it;
    return m;
  }, [sections]);

  const [activeLang, setActiveLang] = useState("sk");
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState("all"); // all | edited | untranslated
  const [overrides, setOverrides] = useState({});       // `${lang}|${ns}:${key}` -> value
  const [drafts, setDrafts] = useState({});             // `${ns}:${key}` -> textarea text (active lang)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The effective live value for a row in the active language (override or default).
  const effectiveOf = useCallback((it) => {
    const ov = overrides[`${activeLang}|${it.ns}:${it.key}`];
    return ov !== undefined ? ov : defaultFor(it, activeLang);
  }, [overrides, activeLang]);

  // A row is pending if it has a draft that differs from the effective live value.
  const pendingKeys = useMemo(() => Object.keys(drafts).filter((rk) => {
    const it = itemByKey[rk];
    if (!it) return false;
    const live = effectiveOf(it);
    if (it.type === "structured") {
      const parsed = safeParse(drafts[rk]); // structured drafts are stored as JSON text
      return parsed !== undefined && !sameVal(parsed, live);
    }
    return !sameVal(parseDraft(drafts[rk], it.type), live);
  }), [drafts, itemByKey, effectiveOf]);
  const dirtyCount = pendingKeys.length;

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

  const setDraft = useCallback((rk, text) => {
    setDrafts((d) => ({ ...d, [rk]: text }));
  }, []);
  const clearDraft = useCallback((rk) => {
    setDrafts((d) => { if (!(rk in d)) return d; const n = { ...d }; delete n[rk]; return n; });
  }, []);

  const saveOverride = useCallback(async (ns, key, value) => {
    const storedKey = `${ns}:${key}`;
    await rpcDirect("admin_upsert_site_content", { p_key: storedKey, p_lang: activeLang, p_value: value });
    setOverrides((m) => ({ ...m, [`${activeLang}|${storedKey}`]: value }));
    clearDraft(storedKey);
    refreshOverrides(); // push the change to the live overlay immediately
  }, [activeLang, clearDraft]);

  const resetOverride = useCallback(async (ns, key) => {
    const storedKey = `${ns}:${key}`;
    await rpcDirect("admin_delete_site_content", { p_key: storedKey, p_lang: activeLang });
    setOverrides((m) => { const n = { ...m }; delete n[`${activeLang}|${storedKey}`]; return n; });
    clearDraft(storedKey);
    refreshOverrides();
  }, [activeLang, clearDraft]);

  function switchLang(code) {
    if (code === activeLang) return;
    if (dirtyCount > 0 && !window.confirm(uiSK
      ? `Máš ${dirtyCount} neuložených úprav. Prepnutím jazyka sa zahodia. Pokračovať?`
      : `You have ${dirtyCount} unsaved edit(s). Switching language discards them. Continue?`)) return;
    setDrafts({});
    setActiveLang(code);
  }

  const q = search.trim().toLowerCase();
  const hasOv = (langCode, ns, key) => overrides[`${langCode}|${ns}:${key}`] !== undefined;
  const editedInLang = (langCode) => Object.keys(overrides).filter((k) => k.startsWith(langCode + "|")).length;

  const FILTERS = [
    { id: "all", label: uiSK ? "Všetky" : "All" },
    { id: "edited", label: uiSK ? "Upravené" : "Edited" },
    { id: "untranslated", label: activeLang === "cs" ? (uiSK ? "Nepreložené" : "Untranslated") : (uiSK ? "Neupravené" : "Default") },
  ];

  return (
    <div style={{ padding: "1.5rem 1.25rem", maxWidth: 1000, margin: "0 auto", color: textLight, fontFamily: mono }}>
      <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 0.3rem" }}>
        {uiSK ? "Texty na webe" : "Website texts"}
      </h1>
      <p style={{ color: dim, fontSize: "0.78rem", lineHeight: 1.5, margin: "0 0 1rem", maxWidth: 720 }}>
        {uiSK
          ? "Uprav ľubovoľný text priamo v poli. Ulož → ihneď naživo, bez nasadenia. „Reset“ vráti pôvodný text (default v kóde). Každý jazyk je samostatný — nie preklad."
          : "Edit any text right in the field. Save → live instantly, no deploy. “Reset” restores the original (code default). Each language is independent — not a translation."}
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
          return previewText(defaultFor(it, activeLang), 99999).toLowerCase().includes(q);
        });
        if (!visible.length) return null;
        return (
          <section key={sec.ns} style={{ marginBottom: "1.6rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: "0.6rem", borderBottom: `1px solid ${border}`, paddingBottom: "0.35rem" }}>
              <h2 style={{ fontSize: "0.82rem", fontWeight: 700, margin: 0 }}>{sec.label}</h2>
              <span style={{ fontSize: "0.64rem", color: faint }}>{sec.hint}</span>
              <span style={{ marginLeft: "auto", fontSize: "0.64rem", color: faint }}>{visible.length}</span>
            </div>
            {visible.map((it) => {
              const rk = `${it.ns}:${it.key}`;
              const RowComp = it.type === "structured" ? StructuredRow : Row;
              return (
                <RowComp
                  key={`${rk}:${activeLang}`}
                  item={it} lang={activeLang} uiSK={uiSK}
                  stored={overrides[`${activeLang}|${rk}`]}
                  draft={drafts[rk]}
                  fill={FILL_LANGS.reduce((a, lc) => (a[lc] = hasOv(lc, it.ns, it.key), a), {})}
                  onDraft={(text) => setDraft(rk, text)}
                  onClearDraft={() => clearDraft(rk)}
                  onSave={(val) => saveOverride(it.ns, it.key, val)}
                  onReset={() => resetOverride(it.ns, it.key)}
                />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

// ── One editable copy row ────────────────────────────────────────────────────
function Row({ item, lang, uiSK, stored, draft, fill, onDraft, onClearDraft, onSave, onReset }) {
  const def = defaultFor(item, lang);
  const hasOverride = stored !== undefined && stored !== null;
  const csFallback = lang === "cs" && item.def.cs == null;

  // The live value for this language (override if set, else default), as text.
  const effective = hasOverride ? stored : def;
  const liveText = toText(effective, item.type);
  // Edit-in-place: show the draft if the user has typed, otherwise the live text.
  const val = draft !== undefined ? draft : liveText;

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  const parsed = parseDraft(val, item.type);
  const isEmpty = item.type === "list" ? parsed.length === 0 : val.trim() === "";
  const equalsDefault = sameVal(parsed, def);
  const changedFromLive = draft !== undefined && !sameVal(parsed, effective);
  const canSave = changedFromLive && !equalsDefault && !isEmpty;
  const dropped = !isEmpty ? missingTokens(toText(def, item.type), val) : [];

  async function doSave() {
    setBusy(true); setErr(null); setSaved(false);
    try {
      await onSave(item.type === "list" ? parsed : val);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }
  async function doReset() {
    setBusy(true); setErr(null);
    try { await onReset(); } catch (e) { setErr(e.message || String(e)); }
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
          onChange={(e) => onDraft(e.target.value)}
          placeholder={toText(def, item.type)}
          rows={item.type === "list" ? Math.min(8, Math.max(2, (Array.isArray(def) ? def.length : 1))) : (liveText.length > 70 ? 3 : 1)}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical",
            background: bg, border: `1px solid ${changedFromLive ? green : border}`, borderRadius: 6,
            color: textLight, fontFamily: mono, fontSize: "0.76rem", lineHeight: 1.5, padding: "0.45rem 0.6rem",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, minHeight: 20, flexWrap: "wrap" }}>
          {canSave && (
            <button onClick={doSave} disabled={busy} style={btn(green, "#06140f")}>
              {busy ? (uiSK ? "Ukladám…" : "Saving…") : (uiSK ? "Uložiť" : "Save")}
            </button>
          )}
          {/* Reverted a saved override back to the default → offer Reset, not a redundant Save */}
          {!canSave && changedFromLive && equalsDefault && hasOverride && (
            <span style={{ fontSize: "0.6rem", color: faint }}>{uiSK ? "= default, použi Reset" : "= default, use Reset"}</span>
          )}
          {hasOverride && (
            <button onClick={doReset} disabled={busy} style={btn("transparent", dim, border)}>
              {uiSK ? "Reset na default" : "Reset to default"}
            </button>
          )}
          {draft !== undefined && !changedFromLive && (
            <button onClick={onClearDraft} disabled={busy} style={btn("transparent", faint, border)}>
              {uiSK ? "Zahodiť zmenu" : "Discard"}
            </button>
          )}
          {item.type === "list" && (
            <span style={{ fontSize: "0.58rem", color: faint }}>{uiSK ? "jeden riadok = jedna položka" : "one line = one item"}</span>
          )}
          {dropped.length > 0 && (
            <span style={{ fontSize: "0.6rem", color: amber }}>
              {uiSK ? "chýba zástupný symbol " : "missing placeholder "}{dropped.join(" ")}
            </span>
          )}
          {saved && <span style={{ fontSize: "0.62rem", color: green }}>✓ {uiSK ? "uložené — naživo" : "saved — live"}</span>}
          {err && <span style={{ fontSize: "0.62rem", color: amber }}>{err}</span>}
        </div>
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

// ── Structured (composite) block editor ──────────────────────────────────────
// A structured value is an array-of-arrays or array-of-objects (optionally
// nested, e.g. useCases[].benefits[]). We infer the shape from the code default
// and render a recursive editor that serializes back to the SAME JSON shape, so
// the overlay (copyOverrides.applyOverrides) merges it by key with no change.
// The working value is driven by the parent draft (JSON text), exactly like a
// Row's textarea — so unsaved structured edits count toward the page guards.

const isScalar = (x) => x === null || typeof x !== "object";

// A blank value matching the SHAPE of `sample` — used to add a fresh row.
function blankLike(sample) {
  if (typeof sample === "boolean") return false;
  if (typeof sample === "number") return 0;
  if (typeof sample === "string") return "";
  if (Array.isArray(sample)) {
    if (sample.every(isScalar)) return sample.map(blankLike); // scalar tuple → keep width
    return [blankLike(sample[0] ?? "")];                       // list of composites → one blank
  }
  if (sample && typeof sample === "object") {
    const o = {};
    for (const k of Object.keys(sample)) o[k] = blankLike(sample[k]);
    return o;
  }
  return "";
}

// Recursive value editor. `value` is the live working copy; `sample` is the code
// default at the same path (drives placeholders, blank-row templates, and the
// scalar-tuple vs repeatable-list decision when `value` is empty).
function ValueEditor({ value, sample, onChange, uiSK, depth = 0 }) {
  if (typeof value === "boolean") {
    return (
      <button type="button" onClick={() => onChange(!value)} style={toggleBtn(value)}>
        {value ? (uiSK ? "áno" : "yes") : (uiSK ? "nie" : "no")}
      </button>
    );
  }

  if (typeof value === "string" || typeof value === "number") {
    const s = String(value);
    const ph = sample != null && isScalar(sample) ? String(sample) : "";
    const long = s.length > 48 || ph.length > 48;
    const shared = { value: s, onChange: (e) => onChange(e.target.value), placeholder: ph };
    return long
      ? <textarea {...shared} rows={Math.min(6, Math.max(2, Math.ceil((s.length || ph.length) / 64)))} style={{ ...leafInput, resize: "vertical" }} />
      : <input {...shared} style={leafInput} />;
  }

  if (Array.isArray(value)) {
    const repElem = value.length ? value[0] : (Array.isArray(sample) && sample.length ? sample[0] : "");
    const isTuple = isScalar(repElem);

    if (isTuple) {
      // Fixed-width row of scalars (e.g. [title, desc], [bool, text]) — edit in place.
      const cells = value.length ? value : (Array.isArray(sample) ? sample.map(blankLike) : []);
      return (
        <div style={tupleRow}>
          {cells.map((cell, i) => (
            <div key={i} style={{ flex: 1, minWidth: 0 }}>
              <ValueEditor
                value={cell}
                sample={Array.isArray(sample) ? sample[i] : undefined}
                onChange={(nv) => { const c = cells.slice(); c[i] = nv; onChange(c); }}
                uiSK={uiSK} depth={depth + 1}
              />
            </div>
          ))}
        </div>
      );
    }

    // Repeatable list of composites (objects / nested arrays / strings).
    const template = value[0] ?? (Array.isArray(sample) ? sample[0] : "") ?? "";
    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= value.length) return;
      const c = value.slice();
      [c[i], c[j]] = [c[j], c[i]];
      onChange(c);
    };
    return (
      <div style={listWrap}>
        {value.map((el, i) => (
          <div key={i} style={listRow}>
            <span style={rowIdx}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ValueEditor
                value={el}
                sample={Array.isArray(sample) ? (sample[i] ?? sample[0]) : undefined}
                onChange={(nv) => { const c = value.slice(); c[i] = nv; onChange(c); }}
                uiSK={uiSK} depth={depth + 1}
              />
            </div>
            <div style={rowCtrls}>
              <button type="button" title={uiSK ? "Hore" : "Move up"} disabled={i === 0} onClick={() => move(i, -1)} style={iconBtn(i === 0)}>↑</button>
              <button type="button" title={uiSK ? "Dole" : "Move down"} disabled={i === value.length - 1} onClick={() => move(i, 1)} style={iconBtn(i === value.length - 1)}>↓</button>
              <button type="button" title={uiSK ? "Odstrániť" : "Remove"} onClick={() => onChange(value.filter((_, j) => j !== i))} style={iconBtn(false, amber)}>×</button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...value, blankLike(template)])} style={addBtn}>
          + {uiSK ? "pridať položku" : "add item"}
        </button>
      </div>
    );
  }

  // Object → labeled fields (preserve the keys the value actually has).
  const keys = Object.keys(value || {});
  return (
    <div style={objWrap(depth)}>
      {keys.map((k) => (
        <div key={k} style={fieldRow}>
          <span style={fieldLabel}>{k}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ValueEditor
              value={value[k]}
              sample={sample ? sample[k] : undefined}
              onChange={(nv) => onChange({ ...value, [k]: nv })}
              uiSK={uiSK} depth={depth + 1}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Structured-block row — mirrors Row's draft/save/reset semantics, but the
// "draft" is the JSON-serialized working value held in the parent `drafts` map.
function StructuredRow({ item, lang, uiSK, stored, draft, fill, onDraft, onClearDraft, onSave, onReset }) {
  const def = defaultFor(item, lang);
  const hasOverride = stored !== undefined && stored !== null;
  const csFallback = lang === "cs" && item.def.cs == null;
  const effective = hasOverride ? stored : def;

  const working = draft !== undefined ? (safeParse(draft) ?? effective) : effective;
  const changedFromLive = draft !== undefined && !sameVal(working, effective);
  const equalsDefault = sameVal(working, def);
  const canSave = changedFromLive && !equalsDefault;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  const update = (next) => onDraft(JSON.stringify(next));

  async function doSave() {
    setBusy(true); setErr(null); setSaved(false);
    try { await onSave(working); setSaved(true); setTimeout(() => setSaved(false), 1800); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }
  async function doReset() {
    setBusy(true); setErr(null);
    try { await onReset(); } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={rowWrap}>
      <div style={keyCol}>
        <span style={keyLabel}>{item.key}</span>
        <FillDots fill={fill} />
        <span style={{ fontSize: "0.55rem", color: dim }}>{uiSK ? "štruktúrovaný" : "structured"}</span>
        {hasOverride && <span style={{ fontSize: "0.55rem", color: green }}>{uiSK ? "upravené" : "edited"}</span>}
        {csFallback && <span style={{ fontSize: "0.55rem", color: faint }}>EN fallback</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!open ? (
          <>
            <div style={{ fontSize: "0.68rem", color: changedFromLive ? green : faint, lineHeight: 1.5, marginBottom: 6 }}>{previewText(working, 170)}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => setOpen(true)} style={btn(green, "#06140f")}>{uiSK ? "Upraviť blok" : "Edit block"}</button>
              {changedFromLive && <span style={{ fontSize: "0.6rem", color: green }}>{uiSK ? "neuložené zmeny" : "unsaved changes"}</span>}
              {hasOverride && (
                <button onClick={doReset} disabled={busy} style={btn("transparent", dim, border)}>
                  {uiSK ? "Reset na default" : "Reset to default"}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {lang !== "en" && item.def.en != null && (
              <details style={{ marginBottom: 8 }}>
                <summary style={{ fontSize: "0.6rem", color: dim, cursor: "pointer" }}>{uiSK ? "EN referencia" : "EN reference"}</summary>
                <pre style={enRefPre}>{JSON.stringify(item.def.en, null, 2)}</pre>
              </details>
            )}
            <ValueEditor value={working} sample={def} onChange={update} uiSK={uiSK} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {canSave && (
                <button onClick={doSave} disabled={busy} style={btn(green, "#06140f")}>
                  {busy ? (uiSK ? "Ukladám…" : "Saving…") : (uiSK ? "Uložiť" : "Save")}
                </button>
              )}
              {changedFromLive && equalsDefault && hasOverride && (
                <span style={{ fontSize: "0.6rem", color: faint }}>{uiSK ? "= default, použi Reset" : "= default, use Reset"}</span>
              )}
              {hasOverride && (
                <button onClick={doReset} disabled={busy} style={btn("transparent", dim, border)}>
                  {uiSK ? "Reset na default" : "Reset to default"}
                </button>
              )}
              {changedFromLive && (
                <button onClick={onClearDraft} disabled={busy} style={btn("transparent", faint, border)}>
                  {uiSK ? "Zahodiť zmenu" : "Discard"}
                </button>
              )}
              <button onClick={() => setOpen(false)} style={btn("transparent", dim, border)}>
                {uiSK ? "Zbaliť" : "Collapse"}
              </button>
              {saved && <span style={{ fontSize: "0.62rem", color: green }}>✓ {uiSK ? "uložené — naživo" : "saved — live"}</span>}
              {err && <span style={{ fontSize: "0.62rem", color: amber }}>{err}</span>}
            </div>
          </>
        )}
      </div>
    </div>
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

// ── Structured-editor styles ─────────────────────────────────────────────────
const leafInput = {
  width: "100%", boxSizing: "border-box",
  background: bg, border: `1px solid ${border}`, borderRadius: 5,
  color: textLight, fontFamily: mono, fontSize: "0.74rem", lineHeight: 1.5, padding: "0.35rem 0.5rem",
};
const tupleRow = { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" };
const listWrap = { display: "flex", flexDirection: "column", gap: 6 };
const listRow = {
  display: "flex", gap: 6, alignItems: "flex-start",
  background: bg2, border: `1px solid ${border}`, borderRadius: 6, padding: "0.4rem 0.45rem",
};
const rowIdx = { fontSize: "0.56rem", color: faint, fontWeight: 700, paddingTop: 6, minWidth: 14, textAlign: "right" };
const rowCtrls = { display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 };
function iconBtn(disabled, color) {
  return {
    width: 20, height: 18, lineHeight: 1, padding: 0, borderRadius: 4,
    border: `1px solid ${border}`, background: "transparent",
    color: disabled ? faint : (color || dim), cursor: disabled ? "default" : "pointer",
    fontFamily: mono, fontSize: "0.7rem", opacity: disabled ? 0.4 : 1,
  };
}
const addBtn = {
  alignSelf: "flex-start", marginTop: 2, padding: "0.25rem 0.6rem", borderRadius: 6,
  border: `1px dashed ${border}`, background: "transparent", color: green,
  cursor: "pointer", fontFamily: mono, fontSize: "0.64rem", fontWeight: 600,
};
function objWrap(depth) {
  return {
    display: "flex", flexDirection: "column", gap: 6,
    borderLeft: depth ? `2px solid ${border}` : "none", paddingLeft: depth ? 8 : 0,
  };
}
const fieldRow = { display: "flex", gap: 8, alignItems: "flex-start" };
const fieldLabel = { width: 78, flexShrink: 0, fontSize: "0.58rem", color: faint, paddingTop: 7, textAlign: "right", wordBreak: "break-word" };
function toggleBtn(on) {
  return {
    padding: "0.3rem 0.7rem", borderRadius: 5, cursor: "pointer", fontFamily: mono, fontSize: "0.66rem", fontWeight: 700,
    border: `1px solid ${on ? green : border}`, background: on ? green : "transparent", color: on ? "#06140f" : dim,
  };
}
const enRefPre = {
  whiteSpace: "pre-wrap", wordBreak: "break-word", background: bg, border: `1px solid ${border}`,
  borderRadius: 6, padding: "0.5rem 0.6rem", marginTop: 4, color: dim, fontSize: "0.62rem", lineHeight: 1.5, maxHeight: 220, overflow: "auto",
};
