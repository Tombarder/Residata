/**
 * TextsEditor — admin-only "Texts / Texty" tool to edit website copy live.
 *
 * THE MODEL (see lib/copyOverrides.js): the in-code dictionaries are the
 * permanent DEFAULTS. This tool writes per-(key,lang) OVERRIDES into
 * public.site_content; an override WINS over the default on the live site the
 * moment it's saved (no deploy). Reset deletes the override → the code default
 * renders again. The site can never go blank — an empty table = today's copy.
 *
 * ORIENTATION (lib/copyGroups.js): keys are organized the way the site is — by
 * PAGE and SECTION (Home ▸ Hero, Pricing ▸ Plans, Login modal…). A left-hand
 * navigator picks the page; the main area shows that page's sections. Search
 * spans everything. Every key shows a readable label + the raw key underneath.
 *
 * TWO dictionaries share the table, namespaced so identical bare keys can't
 * collide: "mk" = marketing copy (`t` in lib/marketingCopy.js), "lv" = the
 * live/app + login + admin copy (`liveT` in liveLang.js). Stored key =
 * `${ns}:${bareKey}`.
 *
 * EDIT-IN-PLACE: each field is pre-filled with the text that's live right now
 * (override if set, else the code default). Save appears only when the text
 * differs from the default; editing a saved override back to the default offers
 * Reset instead of a redundant copy.
 *
 * NO LOST EDITS: typed-but-unsaved text lives in the PARENT (`drafts`), keyed by
 * key, so switching page / filtering / searching never drops an edit. Only a
 * language switch or reload discards (with a confirm / browser guard).
 *
 * STRUCTURED BLOCKS: composite copy (arrays-of-arrays / arrays-of-objects, e.g.
 * deliveryItems, useCases, tiers) is edited by StructuredRow — a recursive editor
 * that serializes back to the SAME JSON shape; its working value lives in `drafts`
 * as JSON text, so the same no-lost-edits behavior applies.
 *
 * LANGUAGES: SK + EN + CZ are all live on the public switcher. Untranslated Czech
 * falls back to EN, so a blank cs cell is safe (English shows there, never blank).
 *
 * SECURITY mirrors LocationManager: writes go through admin-gated SECURITY
 * DEFINER RPCs (admin_*_site_content), called via a direct PostgREST fetch that
 * reads the stored access token synchronously.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { t as marketingDict } from "../lib/marketingCopy";
import { liveT } from "../lib/liveLang";
import { refreshOverrides } from "../lib/copyOverrides";
import { usePricingConfig, refreshPricing, formatEurCents } from "../lib/pricing";
import { PAGES, humanizeKey } from "../lib/copyGroups";
import {
  accent as green, accentInk, orange as amber, text as textLight, dim, faint,
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
  { ns: "mk", dict: marketingDict, label: "Marketing site" },
  { ns: "lv", dict: liveT,         label: "Platform & app" },
];

// Build the editable key universe — UNION of all languages' keys, so a key that
// exists in only one language is still editable (never silently missing).
function buildSources() {
  return SOURCES.map(({ ns, dict, label }) => {
    const keys = [...new Set([
      ...Object.keys(dict.en || {}),
      ...Object.keys(dict.sk || {}),
      ...Object.keys(dict.cs || {}),
    ])];
    const items = keys.map((key) => {
      const def = dict.en?.[key] ?? dict.sk?.[key] ?? dict.cs?.[key];
      return { ns, key, type: classify(def), def: { sk: dict.sk?.[key], en: dict.en?.[key], cs: dict.cs?.[key] } };
    });
    return { ns, label, items };
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

// ── Pricing panel ────────────────────────────────────────────────────────────
// The Boss's one-click price control. Shows the current + crossed price, and on
// Save writes public.pricing_config via the admin-gated api/stripe?action=set-price.
// That ONE value then drives BOTH the website pricing card AND the live Stripe
// charge (no code edit, no deploy).
function PricingPanel({ uiSK }) {
  const cfg = usePricingConfig();
  const [priceEur, setPriceEur] = useState("");
  const [anchorEur, setAnchorEur] = useState("");
  const [noteEn, setNoteEn] = useState("");
  const [noteSk, setNoteSk] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (cfg && !seeded) {
      setPriceEur(cfg.monthly_price_cents != null ? String(cfg.monthly_price_cents / 100) : "");
      setAnchorEur(cfg.anchor_price_cents != null ? String(cfg.anchor_price_cents / 100) : "");
      setNoteEn(cfg.discount_note_en || "");
      setNoteSk(cfg.discount_note_sk || "");
      setSeeded(true);
    }
  }, [cfg, seeded]);

  const toCents = (s) => {
    // Tolerate a typed € sign, spaces, and comma decimals ("€ 79,99" → 7999).
    const cleaned = String(s).replace(/[€\s]/g, "").replace(",", ".");
    if (cleaned === "") return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const priceCents = toCents(priceEur);
  const anchorCents = anchorEur.trim() === "" ? null : toCents(anchorEur);
  const priceValid = Number.isInteger(priceCents) && priceCents >= 100 && priceCents <= 1000000;
  // Anchor (the struck-through "regular" price) is optional, but when present it
  // must be in range AND strictly ABOVE the real price — a crossed price at or
  // below the actual price is a nonsensical anti-discount.
  const anchorValid = anchorCents === null || (
    Number.isInteger(anchorCents) && anchorCents >= 100 && anchorCents <= 2000000 &&
    (!priceValid || anchorCents > priceCents)
  );
  const canSave = seeded && !busy && priceValid && anchorValid;
  // Clear a stale "saved"/error message the moment the Boss edits again.
  const edit = (setter) => (e) => { setter(e.target.value); if (msg) setMsg(null); };

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const token = storedAccessToken();
      if (!token) throw new Error(uiSK ? "Relácia vypršala — obnov stránku a prihlás sa." : "Session expired — reload and sign in.");
      const res = await fetch("/api/stripe?action=set-price", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          monthly_price_cents: priceCents,
          anchor_price_cents: anchorCents,
          discount_note_en: noteEn,
          discount_note_sk: noteSk,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await refreshPricing();
      // Reflect the NORMALISED stored value back into the inputs (e.g. "79.999"
      // was rounded+stored as €80) so what you see matches what's charged.
      const c = j.config;
      if (c) {
        setPriceEur(c.monthly_price_cents != null ? String(c.monthly_price_cents / 100) : "");
        setAnchorEur(c.anchor_price_cents != null ? String(c.anchor_price_cents / 100) : "");
        setNoteEn(c.discount_note_en || "");
        setNoteSk(c.discount_note_sk || "");
      }
      setMsg({ ok: true, text: uiSK ? "✓ Uložené — naživo na webe aj v Stripe" : "✓ Saved — live on the website and in Stripe" });
    } catch (e) {
      setMsg({ ok: false, text: String(e.message || e) });
    } finally { setBusy(false); }
  }

  const inputStyle = {
    background: bg, border: `1px solid ${border}`, borderRadius: 6, color: textLight,
    fontFamily: mono, fontSize: "0.85rem", padding: "0.5rem 0.6rem", width: "100%", boxSizing: "border-box",
  };
  const lbl = { fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", color: faint, display: "block", marginBottom: 4 };

  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 10, background: bg2, padding: "1.1rem 1.2rem", marginBottom: "1.4rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.9rem" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, color: textLight }}>
          {uiSK ? "Cena predplatného" : "Subscription price"}
        </h2>
        {/* Live preview of the current price */}
        <div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: textLight }}>
          {cfg?.anchor_price_cents != null && (
            <span style={{ fontSize: "0.8rem", fontWeight: 400, color: faint, textDecoration: "line-through", marginRight: 8 }}>
              {formatEurCents(cfg.anchor_price_cents)}
            </span>
          )}
          <span style={{ color: accentInk }}>{cfg ? formatEurCents(cfg.monthly_price_cents) : "…"}</span>
          <span style={{ fontSize: "0.7rem", fontWeight: 400, color: faint }}>{uiSK ? "/mes" : "/mo"}</span>
        </div>
      </div>

      <p style={{ color: dim, fontSize: "0.72rem", lineHeight: 1.5, margin: "0 0 0.9rem", maxWidth: 720 }}>
        {uiSK
          ? "Zmena tu sa okamžite prejaví na cenníku webu AJ na sume, ktorú platí zákazník cez Stripe. Bez nasadenia. „Prečiarknutá cena“ je len vizuálna kotva — Stripe účtuje len skutočnú cenu."
          : "A change here goes live instantly on the website pricing card AND on the amount customers pay via Stripe. No deploy. The “crossed-out price” is a visual anchor only — Stripe charges just the real price."}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.8rem", marginBottom: "0.8rem" }}>
        <div>
          <label style={lbl}>{uiSK ? "Cena / mesiac (€)" : "Price / month (€)"}</label>
          <input value={priceEur} onChange={edit(setPriceEur)} inputMode="decimal"
            style={{ ...inputStyle, borderColor: priceValid ? border : "#f85149" }} placeholder="79.99" />
        </div>
        <div>
          <label style={lbl}>{uiSK ? "Prečiarknutá cena (€) — voliteľné" : "Crossed-out price (€) — optional"}</label>
          <input value={anchorEur} onChange={edit(setAnchorEur)} inputMode="decimal"
            style={{ ...inputStyle, borderColor: anchorValid ? border : "#f85149" }} placeholder="349.99" />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.7rem", marginBottom: "0.9rem" }}>
        <div>
          <label style={lbl}>{uiSK ? "Text pod cenou — EN" : "Note under price — EN"}</label>
          <input value={noteEn} onChange={edit(setNoteEn)} maxLength={400} style={inputStyle} />
        </div>
        <div>
          <label style={lbl}>{uiSK ? "Text pod cenou — SK" : "Note under price — SK"}</label>
          <input value={noteSk} onChange={edit(setNoteSk)} maxLength={400} style={inputStyle} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <button onClick={save} disabled={!canSave}
          style={{
            background: canSave ? green : border,
            color: canSave ? "#06140f" : faint,
            border: "none", borderRadius: 6, padding: "0.55rem 1.1rem", fontFamily: mono,
            fontSize: "0.8rem", fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed",
          }}>
          {busy ? (uiSK ? "Ukladám…" : "Saving…") : (uiSK ? "Uložiť cenu" : "Save price")}
        </button>
        {!seeded && <span style={{ fontSize: "0.62rem", color: faint }}>{uiSK ? "načítavam aktuálnu cenu…" : "loading current price…"}</span>}
        {seeded && !priceValid && <span style={{ fontSize: "0.62rem", color: "#f85149" }}>{uiSK ? "cena musí byť € 1–10 000" : "price must be € 1–10 000"}</span>}
        {seeded && priceValid && !anchorValid && <span style={{ fontSize: "0.62rem", color: "#f85149" }}>{uiSK ? "prečiarknutá cena musí byť vyššia než cena" : "crossed-out price must be higher than the price"}</span>}
        {msg && <span style={{ fontSize: "0.68rem", color: msg.ok ? green : "#f85149" }}>{msg.text}</span>}
      </div>
    </div>
  );
}

export default function TextsEditor({ lang = "en" }) {
  const uiSK = lang === "sk";
  const sources = useMemo(() => buildSources(), []);
  const itemByKey = useMemo(() => {
    const m = {};
    for (const sec of sources) for (const it of sec.items) m[`${it.ns}:${it.key}`] = it;
    return m;
  }, [sources]);

  // Page model: each PAGES entry resolved to real items, + an "Other" page per ns
  // for any key not mapped in copyGroups (so nothing is ever hidden).
  const pages = useMemo(() => {
    const used = new Set();
    const out = [];
    for (const p of PAGES) {
      const secs = [];
      for (const s of p.sections) {
        const items = s.keys.map((k) => itemByKey[`${p.ns}:${k}`]).filter(Boolean);
        s.keys.forEach((k) => used.add(`${p.ns}:${k}`));
        if (items.length) secs.push({ label: s.label, items });
      }
      if (secs.length) out.push({ ns: p.ns, group: p.group, id: p.id, label: p.label, blurb: p.blurb, secs });
    }
    for (const src of sources) {
      const leftover = src.items.filter((it) => !used.has(`${it.ns}:${it.key}`));
      if (leftover.length) out.push({
        ns: src.ns, group: src.label, id: `other-${src.ns}`,
        label: uiSK ? "Ostatné" : "Other", blurb: uiSK ? "Nezaradené kľúče" : "Unmapped keys",
        secs: [{ label: uiSK ? "Ostatné" : "Other", items: leftover }],
      });
    }
    return out;
  }, [itemByKey, sources, uiSK]);

  const [activeLang, setActiveLang] = useState("sk");
  const [activePageId, setActivePageId] = useState(pages[0]?.id);
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
      const parsed = safeParse(drafts[rk]);
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
  const editedInPage = (page) => {
    let n = 0;
    for (const s of page.secs) for (const it of s.items) if (hasOv(activeLang, it.ns, it.key)) n++;
    return n;
  };

  const matches = (it) => {
    const edited = hasOv(activeLang, it.ns, it.key);
    if (filterMode === "edited" && !edited) return false;
    if (filterMode === "untranslated" && edited) return false;
    if (!q) return true;
    return it.key.toLowerCase().includes(q)
      || humanizeKey(it.key).toLowerCase().includes(q)
      || previewText(defaultFor(it, activeLang), 99999).toLowerCase().includes(q);
  };

  const renderRow = (it) => {
    const rk = `${it.ns}:${it.key}`;
    const RowComp = it.type === "structured" ? StructuredRow : Row;
    return (
      <RowComp
        key={`${rk}:${activeLang}`}
        item={it} label={humanizeKey(it.key)} lang={activeLang} uiSK={uiSK}
        stored={overrides[`${activeLang}|${rk}`]}
        draft={drafts[rk]}
        fill={FILL_LANGS.reduce((a, lc) => (a[lc] = hasOv(lc, it.ns, it.key), a), {})}
        onDraft={(text) => setDraft(rk, text)}
        onClearDraft={() => clearDraft(rk)}
        onSave={(val) => saveOverride(it.ns, it.key, val)}
        onReset={() => resetOverride(it.ns, it.key)}
      />
    );
  };

  const FILTERS = [
    { id: "all", label: uiSK ? "Všetky" : "All" },
    { id: "edited", label: uiSK ? "Upravené" : "Edited" },
    { id: "untranslated", label: activeLang === "cs" ? (uiSK ? "Nepreložené" : "Untranslated") : (uiSK ? "Neupravené" : "Default") },
  ];

  const activePage = pages.find((p) => p.id === activePageId) || pages[0];
  const navGroups = [];
  for (const p of pages) {
    let g = navGroups.find((x) => x.group === p.group);
    if (!g) { g = { group: p.group, pages: [] }; navGroups.push(g); }
    g.pages.push(p);
  }
  const emptyMsg = uiSK ? "Žiadne texty pre tento filter." : "No texts for this filter.";

  return (
    <div style={{ padding: "1.5rem 1.25rem", maxWidth: 1140, margin: "0 auto", color: textLight, fontFamily: mono }}>
      <h1 style={{ fontSize: "1.15rem", fontWeight: 700, margin: "0 0 0.3rem" }}>
        {uiSK ? "Texty na webe" : "Website texts"}
      </h1>
      <p style={{ color: dim, fontSize: "0.78rem", lineHeight: 1.5, margin: "0 0 1rem", maxWidth: 760 }}>
        {uiSK
          ? "Vľavo vyber stránku, vpravo uprav text priamo v poli. Ulož → ihneď naživo, bez nasadenia. „Reset“ vráti pôvodný text. Každý jazyk je samostatný — nie preklad."
          : "Pick a page on the left, edit the text in place on the right. Save → live instantly, no deploy. “Reset” restores the original. Each language is independent — not a translation."}
      </p>

      <PricingPanel uiSK={uiSK} />

      {/* Language tabs */}
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.6rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.1em", color: faint, marginRight: 4 }}>
          {uiSK ? "Jazyk" : "Language"}
        </span>
        {LANGS.map((L) => {
          const active = L.code === activeLang;
          const n = editedInLang(L.code);
          return (
            <button key={L.code} onClick={() => switchLang(L.code)}
              style={{
                padding: "0.35rem 0.7rem", borderRadius: 7, cursor: "pointer",
                border: `1px solid ${active ? green : border}`,
                background: active ? green : "transparent",
                color: active ? "#06140f" : dim, fontWeight: active ? 700 : 500,
                fontFamily: mono, fontSize: "0.74rem", display: "flex", alignItems: "center", gap: 6,
              }}>
              {L.label}
              {n > 0 && <span style={{ fontSize: "0.58rem", background: active ? "#06140f" : border, color: active ? green : dim, borderRadius: 6, padding: "0 5px", fontWeight: 700 }}>{n}</span>}
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
          placeholder={uiSK ? "Hľadať vo všetkých textoch…" : "Search all texts…"}
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

      {!loading && (
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* ── Page navigator ── */}
          <nav style={navCol}>
            {q && <div style={{ fontSize: "0.62rem", color: amber, marginBottom: 10 }}>{uiSK ? "Hľadanie naprieč stránkami" : "Searching across pages"}</div>}
            {navGroups.map((g) => (
              <div key={g.group} style={{ marginBottom: 14 }}>
                <div style={navGroupLabel}>{g.group}</div>
                {g.pages.map((p) => {
                  const active = !q && p.id === activePage?.id;
                  const ed = editedInPage(p);
                  return (
                    <button key={p.id} onClick={() => { setSearch(""); setActivePageId(p.id); }} style={navItem(active)}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
                      {ed > 0 && <span style={navBadge(active)}>{ed}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* ── Main editing area ── */}
          <div style={{ flex: "999 1 440px", minWidth: 0 }}>
            {q ? (
              (() => {
                const groups = pages
                  .map((p) => ({ p, items: p.secs.flatMap((s) => s.items).filter(matches) }))
                  .filter((x) => x.items.length);
                if (!groups.length) return <div style={emptyBox}>{emptyMsg}</div>;
                return groups.map(({ p, items }) => (
                  <section key={p.id} style={{ marginBottom: 20 }}>
                    <div style={pageHead}>
                      <span style={{ fontSize: "0.58rem", color: faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>{p.group}</span>
                      <h2 style={{ margin: "1px 0 0", fontSize: "0.9rem", fontWeight: 700 }}>{p.label} <span style={{ color: faint, fontWeight: 400, fontSize: "0.7rem" }}>· {items.length}</span></h2>
                    </div>
                    {items.map(renderRow)}
                  </section>
                ));
              })()
            ) : activePage ? (
              <>
                <div style={pageHead}>
                  <span style={{ fontSize: "0.58rem", color: faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>{activePage.group}</span>
                  <h2 style={{ margin: "1px 0 1px", fontSize: "1rem", fontWeight: 700 }}>{activePage.label}</h2>
                  <div style={{ fontSize: "0.66rem", color: dim }}>{activePage.blurb}</div>
                </div>
                {(() => {
                  const blocks = activePage.secs.map((s) => {
                    const items = s.items.filter(matches);
                    if (!items.length) return null;
                    return (
                      <section key={s.label} style={{ marginBottom: 18 }}>
                        <div style={secHead}>{s.label} <span style={{ color: faint, fontWeight: 400 }}>· {items.length}</span></div>
                        {items.map(renderRow)}
                      </section>
                    );
                  }).filter(Boolean);
                  return blocks.length ? blocks : <div style={emptyBox}>{emptyMsg}</div>;
                })()}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── One editable copy row ────────────────────────────────────────────────────
function Row({ item, label, lang, uiSK, stored, draft, fill, onDraft, onClearDraft, onSave, onReset }) {
  const def = defaultFor(item, lang);
  const hasOverride = stored !== undefined && stored !== null;
  const csFallback = lang === "cs" && item.def.cs == null;

  const effective = hasOverride ? stored : def;
  const liveText = toText(effective, item.type);
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
        <span style={fieldName}>{label || humanizeKey(item.key)}</span>
        <span style={keyTag}>{item.key}{item.type === "list" ? " · list" : ""}</span>
        <FillDots fill={fill} />
        {hasOverride && <span style={editedTag}>{uiSK ? "upravené" : "edited"}</span>}
        {csFallback && <span style={{ fontSize: "0.55rem", color: faint }}>EN fallback</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
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
          {saved && <span style={{ fontSize: "0.62rem", color: accentInk }}>✓ {uiSK ? "uložené — naživo" : "saved — live"}</span>}
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
const isScalar = (x) => x === null || typeof x !== "object";

function blankLike(sample) {
  if (typeof sample === "boolean") return false;
  if (typeof sample === "number") return 0;
  if (typeof sample === "string") return "";
  if (Array.isArray(sample)) {
    if (sample.every(isScalar)) return sample.map(blankLike);
    return [blankLike(sample[0] ?? "")];
  }
  if (sample && typeof sample === "object") {
    const o = {};
    for (const k of Object.keys(sample)) o[k] = blankLike(sample[k]);
    return o;
  }
  return "";
}

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

function StructuredRow({ item, label, lang, uiSK, stored, draft, fill, onDraft, onClearDraft, onSave, onReset }) {
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
        <span style={fieldName}>{label || humanizeKey(item.key)}</span>
        <span style={keyTag}>{item.key} · {uiSK ? "blok" : "block"}</span>
        <FillDots fill={fill} />
        {hasOverride && <span style={editedTag}>{uiSK ? "upravené" : "edited"}</span>}
        {csFallback && <span style={{ fontSize: "0.55rem", color: faint }}>EN fallback</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!open ? (
          <>
            <div style={{ fontSize: "0.68rem", color: changedFromLive ? green : faint, lineHeight: 1.5, marginBottom: 6 }}>{previewText(working, 170)}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => setOpen(true)} style={btn(green, "#06140f")}>{uiSK ? "Upraviť blok" : "Edit block"}</button>
              {changedFromLive && <span style={{ fontSize: "0.6rem", color: accentInk }}>{uiSK ? "neuložené zmeny" : "unsaved changes"}</span>}
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
              {saved && <span style={{ fontSize: "0.62rem", color: accentInk }}>✓ {uiSK ? "uložené — naživo" : "saved — live"}</span>}
              {err && <span style={{ fontSize: "0.62rem", color: amber }}>{err}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Layout styles ────────────────────────────────────────────────────────────
const navCol = {
  flex: "1 1 180px", maxWidth: 226, minWidth: 168, position: "sticky", top: 8,
  alignSelf: "flex-start", display: "flex", flexDirection: "column",
  maxHeight: "calc(100vh - 90px)", overflowY: "auto",
  background: bg2, border: `1px solid ${border}`, borderRadius: 9, padding: "0.7rem 0.6rem",
};
const navGroupLabel = { fontSize: "0.56rem", textTransform: "uppercase", letterSpacing: "0.08em", color: faint, fontWeight: 700, margin: "0 0 5px 4px" };
function navItem(active) {
  return {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, width: "100%",
    textAlign: "left", padding: "0.34rem 0.5rem", marginBottom: 2, borderRadius: 6, cursor: "pointer",
    border: "1px solid transparent", background: active ? green : "transparent",
    color: active ? "#06140f" : dim, fontWeight: active ? 700 : 500, fontFamily: mono, fontSize: "0.72rem",
  };
}
function navBadge(active) {
  return {
    fontSize: "0.55rem", fontWeight: 700, borderRadius: 6, padding: "0 5px", flexShrink: 0,
    background: active ? "#06140f" : border, color: active ? green : dim,
  };
}
const pageHead = { marginBottom: "0.9rem", paddingBottom: "0.4rem", borderBottom: `1px solid ${border}` };
const secHead = { fontSize: "0.74rem", fontWeight: 700, color: textLight, margin: "0 0 0.3rem", padding: "0.2rem 0", letterSpacing: "0.01em" };
const emptyBox = { color: faint, fontSize: "0.74rem", padding: "1.2rem 0" };

// ── Row styles ───────────────────────────────────────────────────────────────
const rowWrap = { display: "flex", gap: "0.9rem", padding: "0.7rem 0", borderBottom: `1px solid ${border}`, alignItems: "flex-start" };
const keyCol = { width: 196, flexShrink: 0, display: "flex", flexDirection: "column", gap: 3, paddingTop: 2 };
const fieldName = { fontSize: "0.72rem", color: textLight, fontWeight: 600, lineHeight: 1.3 };
const keyTag = { fontSize: "0.54rem", color: faint, fontFamily: mono, wordBreak: "break-word" };
const editedTag = { fontSize: "0.55rem", color: accentInk, fontWeight: 600 };
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
  border: `1px dashed ${border}`, background: "transparent", color: accentInk,
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
