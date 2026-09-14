/* filterModel — what a filter IS, independent of how it is drawn.
 *
 * The Unit database used to have NINE hard-coded filter controls (project, city,
 * district, developer, status, price from/to, €/m² from/to) and a cramped "+ filter"
 * for everything else, while the whole right-hand panel — the obvious place to build
 * a query — picked COLUMNS. Boss, 2026-09-14: he wants to build the filters he wants
 * and choose the columns he wants, as two separate things, with every field available
 * on both — "like the analytics platform subpage".
 *
 * So the shapes live here, once, as plain data with no React in sight:
 *
 *     { id, key, mode, values: string[], min, max }
 *
 * and the five modes are the pivot's, because the serving engine behind both pages
 * (public.analytics_units / analytics_pivot) speaks exactly these four buckets:
 *
 *     in         → spec.filters[key]      = values
 *     not_in     → spec.filters_not[key]  = values
 *     between    → spec.ranges[key]       = {min, max}
 *     empty      → spec.nulls[key]        = 'empty'
 *     not_empty  → spec.nulls[key]        = 'not_empty'
 *
 * 🔴 WHICH MODES A FIELD ALLOWS IS READ FROM THE REGISTRY, NEVER TYPED OUT. The engine
 * resolves `filters` through the DIMENSION registry and `ranges` through the MEASURE
 * registry (plus date dimensions), and raises "unknown filter field" for a mismatch.
 * A hand-kept list of "numeric fields you may range on" would be wrong the first time
 * someone adds a measure. capabilitiesOf() derives it from the same registry rows the
 * palette is built from, so a new field is filterable the day it exists.
 */

/** Stands in for "no value" so an empty string can be chosen like any other value. */
export const EMPTY_SENTINEL = "__EMPTY__";

export const FILTER_MODES = Object.freeze(["in", "not_in", "between", "empty", "not_empty"]);
const MODE_SET = new Set(FILTER_MODES);

export const MODE_LABEL = {
  sk: { in: "je", not_in: "nie je", between: "rozsah", empty: "prázdne", not_empty: "vyplnené" },
  en: { in: "is", not_in: "is not", between: "range", empty: "empty", not_empty: "has a value" },
};

/**
 * What can this field actually be filtered by?
 *
 * @param key           field key
 * @param dimensionKeys Set of dim_registry keys
 * @param measureKeys   Set of measure_registry keys
 * @param dateKeys      Set of dimension keys whose data_type is 'date'
 * @returns {{modes: string[], valued: boolean, ranged: boolean}}
 */
export function capabilitiesOf(key, { dimensionKeys, measureKeys, dateKeys }) {
  const isDim = dimensionKeys.has(key);
  const isMeasure = measureKeys.has(key);
  const isDate = dateKeys.has(key);
  const modes = [];
  // A value list needs the dimension registry — that is what the engine looks in.
  if (isDim) modes.push("in", "not_in");
  // A range needs a measure, or a DATE dimension (the engine allows those too).
  if (isMeasure || isDate) modes.push("between");
  // Presence works for anything the engine can name at all.
  if (isDim || isMeasure) modes.push("empty", "not_empty");
  return { modes, valued: isDim, ranged: isMeasure || isDate, isDate };
}

/** A fresh filter for a field, opened on the most useful mode it supports. */
export function newFilter(key, caps, id) {
  /* A date dimension can do both, and "between 1 March and today" is the question people
     have about a date — offering it a value list of every distinct day first is useless. */
  const prefer = caps.isDate ? ["between", "in"] : ["in", "between"];
  const mode = prefer.find((m) => caps.modes.includes(m)) || caps.modes[0] || "in";
  return { id, key, mode, values: [], min: "", max: "" };
}

/**
 * Coerce anything that claims to be a filter into a valid one, or null.
 * Saved preferences are USER-WRITABLE (localStorage, and a JSON column), so nothing
 * here may trust its input — a bad mode must not reach the engine as SQL it cannot
 * parse, and must not throw on the way to the screen either.
 */
export function sanitizeFilter(f, id) {
  if (!f || typeof f !== "object") return null;
  const key = typeof f.key === "string" ? f.key : null;
  if (!key) return null;
  const mode = MODE_SET.has(f.mode) ? f.mode : "in";
  const values = Array.isArray(f.values) ? f.values.filter((v) => typeof v === "string" || typeof v === "number").map(String) : [];
  const num = (v) => (v === 0 ? "0" : (v ? String(v) : ""));
  return { id: f.id ?? id, key, mode, values, min: num(f.min), max: num(f.max) };
}

/** Does this filter actually narrow anything? An empty one must never reach the engine. */
export function isFilterActive(f) {
  if (!f || !f.key) return false;
  if (f.mode === "empty" || f.mode === "not_empty") return true;
  if (f.mode === "between") return f.min !== "" || f.max !== "";
  return Array.isArray(f.values) && f.values.length > 0;
}

/** One short human line for a chip or a title. */
export function summariseFilter(f, lang = "sk") {
  const L = MODE_LABEL[lang === "sk" ? "sk" : "en"];
  if (!f) return "";
  if (f.mode === "empty" || f.mode === "not_empty") return L[f.mode];
  if (f.mode === "between") {
    const lo = f.min !== "" ? f.min : "…";
    const hi = f.max !== "" ? f.max : "…";
    return `${lo} – ${hi}`;
  }
  const vals = f.values || [];
  if (!vals.length) return lang === "sk" ? "(bez hodnoty)" : "(no value)";
  const shown = vals.slice(0, 2).map((v) => (v === EMPTY_SENTINEL ? (lang === "sk" ? "(prázdne)" : "(empty)") : v)).join(", ");
  const rest = vals.length > 2 ? ` +${vals.length - 2}` : "";
  return `${L[f.mode]} ${shown}${rest}`;
}

/**
 * Filters → the four buckets analytics_units understands.
 *
 * `toEur` converts a money field's typed value from the DISPLAY currency back to EUR:
 * the engine stores money in EUR, so in CZK mode a typed CZK band would otherwise be
 * compared against EUR values and return nonsense. Same conversion the pivot does.
 */
/**
 * A typed number, the way people actually type one.
 * "50,5" is how a decimal is written in Slovak and Czech, and Number() makes NaN of it,
 * which JSON turns into null — so the bound silently disappears rather than failing.
 */
export function parseNumeric(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function filtersToSpec(filters, { isMoneyKey = () => false, isDateKey = () => false, toEur = (v) => v } = {}) {
  const out = { filters: {}, filters_not: {}, ranges: {}, nulls: {} };
  for (const f of filters || []) {
    if (!isFilterActive(f)) continue;
    if (f.mode === "empty" || f.mode === "not_empty") { out.nulls[f.key] = f.mode; continue; }
    if (f.mode === "between") {
      /* 🔴 A DATE IS NOT A NUMBER. The engine casts date-dimension bounds itself and wants
         the string; Number("2026-01-01") is NaN, JSON writes NaN as null, and the filter
         then does NOTHING while looking perfectly set on screen. That is exactly the shape
         of bug this page is supposed to stop producing. */
      if (isDateKey(f.key)) {
        out.ranges[f.key] = { min: f.min || null, max: f.max || null };
        continue;
      }
      const money = isMoneyKey(f.key);
      const n = (v) => { const x = parseNumeric(v); return x === null ? null : (money ? toEur(x) : x); };
      out.ranges[f.key] = { min: n(f.min), max: n(f.max) };
      continue;
    }
    // A chosen "(empty)" is a null test, not a value — the engine has no way to
    // compare against the sentinel, and silently sending it would filter to nothing.
    const vals = (f.values || []).filter((v) => v !== EMPTY_SENTINEL);
    const wantsEmpty = (f.values || []).includes(EMPTY_SENTINEL);
    if (vals.length) {
      const bucket = f.mode === "not_in" ? out.filters_not : out.filters;
      bucket[f.key] = (bucket[f.key] || []).concat(vals);
      /* "is not P and not blank" is two conditions ANDed, which the spec CAN say — and
         dropping the second half answered a narrower question than the one asked.
         ("is V or blank" is an OR and the spec cannot say it at all, so the editor stops
          that combination from being built rather than quietly answering something else.) */
      if (wantsEmpty && f.mode === "not_in") out.nulls[f.key] = "not_empty";
    } else if (wantsEmpty) {
      out.nulls[f.key] = f.mode === "not_in" ? "not_empty" : "empty";
    }
  }
  // Hand back only the buckets that carry something; an empty object is noise in the spec.
  const spec = {};
  for (const k of ["filters", "filters_not", "ranges", "nulls"]) {
    if (Object.keys(out[k]).length) spec[k] = out[k];
  }
  return spec;
}

/**
 * Old Unit-database preferences → the new filter list.
 *
 * The previous page kept its filters as nine named fields plus an `xf` array. Those are
 * saved per account and Boss has his own set in there; dropping them on the floor would
 * mean he opens the rebuilt page and silently sees the whole market. Every legacy shape
 * maps onto exactly one filter, so the migration is total rather than best-effort.
 */
export function migrateLegacyFilters(saved, startId = 1) {
  if (!saved || typeof saved !== "object") return [];
  let id = startId;
  const out = [];
  const add = (key, mode, extra) => out.push({ id: id++, key, mode, values: [], min: "", max: "", ...extra });

  for (const [prop, key] of [["fProject", "project_name"], ["fCity", "city"], ["fCast", "cast"], ["fDev", "developer"], ["fStav", "stav"]]) {
    const v = saved[prop];
    if (typeof v === "string" && v !== "") add(key, "in", { values: [v] });
  }
  for (const [loProp, hiProp, key] of [["pMin", "pMax", "cena_s_dph"], ["m2Min", "m2Max", "price_per_m2"]]) {
    const lo = saved[loProp], hi = saved[hiProp];
    if ((lo !== undefined && lo !== "") || (hi !== undefined && hi !== "")) {
      add(key, "between", { min: lo === undefined ? "" : String(lo), max: hi === undefined ? "" : String(hi) });
    }
  }
  for (const r of Array.isArray(saved.xf) ? saved.xf : []) {
    if (!r || !r.key) continue;
    const hasVals = Array.isArray(r.vals) && r.vals.length;
    const hasRange = (r.min !== undefined && r.min !== "") || (r.max !== undefined && r.max !== "");
    if (hasVals) add(r.key, r.op === "not_in" ? "not_in" : "in", { values: r.vals.map(String) });
    else if (hasRange) add(r.key, "between", { min: r.min === undefined ? "" : String(r.min), max: r.max === undefined ? "" : String(r.max) });
  }
  return out;
}
