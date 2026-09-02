import { useState, useMemo, useEffect, useRef, useLayoutEffect, Fragment } from "react";
import { createPortal } from "react-dom";
import { useSpecifics, SpecificsMark } from "../lib/projectSpecifics";
import { useProjects, useFlatsArchive, useFlatsCurrent, useArchiveMonths, useArchiveDays, usePivotGrain, usePivotDistinct, usePivotFieldStats, fetchFlatsForProjects } from "../lib/useData";
import { useCountry, isAllCountries } from "../lib/useCountry";
import { useCapabilities } from "../lib/useCapabilities";
import { useAuth } from "../lib/useAuth";
import { useAccountPrefState } from "../lib/useAccountUiPref";
import { PIVOT_KEY as PIVOT_PREF_KEY } from "../lib/accountPrefs";
import { moneyFromEur, moneySymbol } from "../lib/money";
import Picker from "../components/Picker";
import { localeTag } from "../lib/locale";
import { useCurrency } from "../lib/useCurrency";
import { orderPivotColKeys } from "../lib/pivotColOrder";
import { toCSV, copyTable } from "../lib/tableClipboard";
import { insertAt, moveToIndex, keyOfString, keyOfObject, dropIndexFor } from "../lib/zoneOrder";
import useDismiss from "../lib/useDismiss";

/* ═══════════════════════════════════════════════════════════════════
   Pivot v2 — Excel-style drag-and-drop pivot

   Layout mirrors Google Sheets / Excel mental model:
     · Right: palette of every Clean Master field (grouped, searchable).
     · Left:  three zones — Riadky (Rows), Hodnoty (Values), Filtre.
              Rows nest into a hierarchy (max 6 levels). Values render
              as aggregated columns per row group.
     · Bottom: result — a pivot tree table. Each parent row carries a
              rollup computed from ITS OWN records (not a sum of
              sub-buckets), so avg / min / max / median stay correct.

   Data source: every unit (flat) from Supabase, enriched client-side
   with the parent project's metadata (developer, district, status,
   user-entered enrichment cols) so the pivot can group by them without
   any join query.
*/

const mono    = "'JetBrains Mono', ui-monospace, Menlo, monospace";
import { accent as green, accentInk, orange, dim, border, bg, surfacePanel as panelHi, text , orangeInk, dangerInk } from "../lib/theme";
const panel   = "var(--surface-2)";

/* ─── Field registry ─────────────────────────────────────────────
   Single source of truth for which fields exist, what type they are,
   how to read them from an enriched flat row, and which group they
   belong to in the palette. Adding a field = one entry here.                 */
const FIELDS = {
  // Meta
  // `datum` = scrape day (YYYY-MM-DD) — derived from `batch_timestamp`, the
  // canonical Variant-X time axis. We deliberately truncate the full ISO
  // timestamp to a calendar day so grouping / filtering buckets cleanly
  // by day instead of by millisecond. (A previous version pointed at
  // `r.last_seen` which never existed on flats_archive — every record
  // returned undefined → "no values" / unfilterable Datum chip.)
  datum:             { label: "Datum",                      group: "meta",     type: "date",   accessor: (r) => {
                        const ts = r.batch_timestamp || r.created_at;
                        if (!ts) return null;
                        // ISO timestamp → 'YYYY-MM-DD'. Tolerates both
                        // 'YYYY-MM-DDTHH:MM:SS+00:00' and just 'YYYY-MM-DD'.
                        const s = String(ts);
                        return s.length >= 10 ? s.slice(0, 10) : s;
                      }},
  batch_timestamp:   { label: "Batch (presný čas)",         group: "meta",     type: "text",   accessor: (r) => r.batch_timestamp || null },
  snapshot_month:    { label: "Mesiac",                     group: "meta",     type: "text",   accessor: (r) => r.snapshot_month },
  import_status:     { label: "Import status",              group: "meta",     type: "text",   accessor: (r) => r.project_status || "active" },

  // Identity
  project_name:      { label: "Project name",               group: "identity", type: "text",   accessor: (r) => r.project_name },
  unit_id:           { label: "Unit ID",                    group: "identity", type: "text",   accessor: (r) => r.unit_id },
  typ:               { label: "Typ",                        group: "identity", type: "text",   accessor: (r) => r.typ },
  etapa:             { label: "Etapa",                      group: "identity", type: "text",   accessor: (r) => r.etapa },
  budova:            { label: "Budova",                     group: "identity", type: "text",   accessor: (r) => r.budova },
  developer:         { label: "Developer",                  group: "identity", type: "text",   accessor: (r) => r.developer },

  // Unit spec
  poschodie:         { label: "Poschodie",                  group: "spec",     type: "number",               accessor: (r) => num(r.poschodie) },
  izby:              { label: "#izieb",                     group: "spec",     type: "number",               accessor: (r) => num(r.izby) },
  obytna_plocha:     { label: "Obytna plocha",              group: "spec",     type: "number", unit: "m²",   accessor: (r) => num(r.obytna_plocha) },
  balkon:            { label: "Balkon",                     group: "spec",     type: "number", unit: "m²",   accessor: (r) => num(r.balkon_plocha) },
  loggia:            { label: "Loggia",                     group: "spec",     type: "number", unit: "m²",   accessor: (r) => num(r.loggia_plocha) },
  terasa:            { label: "Terasa",                     group: "spec",     type: "number", unit: "m²",   accessor: (r) => num(r.terasa_plocha) },
  zahrada:           { label: "Zahrada",                    group: "spec",     type: "number", unit: "m²",   accessor: (r) => num(r.zahrada_plocha) },
  exterier:          { label: "Exterier",                   group: "spec",     type: "number", unit: "m²",   accessor: (r) => num(r.exterier_plocha) },
  kobka:             { label: "Kobka",                      group: "spec",     type: "number", unit: "m²",   accessor: (r) => num(r.kobka_plocha) },
  celkova_plocha:    { label: "Celkova plocha",             group: "spec",     type: "number", unit: "m²",   accessor: (r) => num(r.celkova_plocha) },

  // Price — DPH (price-without-VAT delta), Zlava (discount vs. list
  // price) and Cennikova cena (original list price BEFORE discount)
  // were dropped from the palette per QA. The current price (whether
  // s_dph or bez_dph) is always THE price the buyer pays, and we now
  // enforce the invariant in sync (derive_dph_pair) that every priced
  // flat has BOTH cena_s_dph AND cena_bez_dph populated at 23 % VAT.
  // cennikova_cena still lives in flats_archive — only meaningful when
  // it differs from cena_s_dph (i.e. there's an active discount), and
  // surfacing it in the palette mostly just confused users.
  cena_bez_dph:      { label: "Cena bez DPH",               group: "price",    type: "number", unit: "€",    accessor: (r) => num(r.cena_bez_dph) },
  cena_s_dph:        { label: "Cena s DPH",                 group: "price",    type: "number", unit: "€",    accessor: (r) => num(r.cena_s_dph) },

  // Status / attrs
  stav:              { label: "Stav",                       group: "status",   type: "text",   accessor: (r) => r.stav },
  kolaudacia:        { label: "Kolaudacia",                 group: "status",   type: "text",   accessor: (r) => r.kolaudacia },
  orientacia:        { label: "Orientacia",                 group: "status",   type: "text",   accessor: (r) => r.orientacia },

  // Location — uses enriched projects-table metadata.
  // CastMesta(kod) and InternaKlasifikacia(zona) — internal
  // enrichment columns admin only fills sometimes — are kept out of the
  // palette: most rows are null. The values still live in projects.* and
  // can be exposed again later if a use case emerges.
  //
  // 2026-08-26: `batch_id` RETIRED for the same reason, found by the field sweep.
  // It stopped being written on 2026-07-01 (final.units has no such column) — 0 of
  // 42 126 current rows carried one — so "Batch ID" was a palette entry that could
  // never show a value, and picking it forced a full-archive scan to return nothing.
  // `batch_timestamp` already identifies every scrape run uniquely (16 runs, 16
  // distinct timestamps, 100% populated), so nothing is lost.
  // 2026-06-29 cleanup: `ulica_detail` / `budova_stav` / `standard` were
  // REMOVED — those columns don't exist on reference.projects (nor on the
  // flats views), so their accessors returned null for EVERY row: dead
  // palette entries that could never filter/group/render. (Verified against
  // information_schema: no such columns anywhere.) Every field in the palette
  // now maps to a real, populated data source backed by analytics.dim_registry.
  //
  // Mesto (city) — sourced directly from flats_archive.city (populated for
  // every market). Essential once Slovakia is unified: district alone is
  // ambiguous (e.g. "Staré Mesto" exists in Bratislava AND Košice), so the
  // city dimension is what makes a national pivot/export legible.
  // Krajina (country) — top of the location hierarchy, above Mesto. Sourced
  // from flats_archive.country (SK/CZ); shown as readable "Slovensko"/"Česko"
  // so the client accessor and the server grain (pivot_grain CASE) agree.
  // Podčasť (sub_district) — finer than district (a project's micro-location,
  // e.g. "Nový downtown"); backed by analytics.dim_registry.sub_district.
  country:           { label: "Krajina",                     group: "location", type: "text",   accessor: (r) => r.country === "SK" ? "Slovensko" : r.country === "CZ" ? "Česko" : (r.country || null) },
  city:              { label: "Mesto",                       group: "location", type: "text",   accessor: (r) => r.city || null },
  cast:              { label: "Mestská časť",                group: "location", type: "text",   accessor: (r) => r.district },
  sub_district:      { label: "Podčasť",                     group: "location", type: "text",   accessor: (r) => r.sub_district },

  // Derived metric
  cena_na_m2_obytnej:{ label: "Cena na m2 obytnej",         group: "derived",  type: "number", unit: "€/m²", derived: true, accessor: (r) => {
                        const p = num(r.cena_s_dph), m = num(r.obytna_plocha);
                        return (p != null && m != null && m > 0) ? p / m : null;
                      }},

  /* ─ Special MEASURES ─
     These aren't per-record values but group-level calculations.
     `type: "measure"` → only valid in Values zone, single fixed agg.
     `measureCompute(records)` runs on the group's record set. */
  /* ── WHAT "SOLD" MEANS HERE, AND WHY IT IS LABELLED ──────────────────────
     The Pivot is a cube of what the developers' price lists SAY, flat by flat.
     117 active projects delete a flat from their list when it sells, so those
     flats have no row here at all and never will — "sold" in this tool can only
     ever mean "currently carries a Predané label". That is a legitimate thing to
     count, and it is not the same thing as a sale.

     Actual sales — including every flat that simply vanished — live on
     Analytics → Predaje, which reads the durable sale fact (analytics.sale_events).
     So both measures below say ON THE LABEL that they count the price list, and
     the two tools stop looking like they disagree with each other.
     (integrity_check._LISTING_SOLD_IS_INTENDED records the same reasoning for the
     views underneath.) */
  abs_rate: {
    label: "Miera absorpcie (v cenníku)", label_en: "Absorption rate (on the price list)",
    group: "measure", type: "measure", unit: "%", derived: true,
    // Accessor unused for measure types but kept for parity
    accessor: () => null,
    measureCompute: (records) => {
      // Absorption = sold / (sold + available) — ignore R/PR/other noise.
      // Sold ~ "P", Available ~ "V". Keeps the denominator meaningful.
      let sold = 0, denom = 0;
      for (const r of records) {
        const s = (r.stav || "").trim().toUpperCase();
        if (s === "P") { sold++; denom++; }
        else if (s === "V") { denom++; }
      }
      if (denom === 0) return null;
      return (sold / denom) * 100;
    },
  },
  wavg_m2_price: {
    label: "Priem. (vážené)", label_en: "Avg (weighted)",
    group: "measure", type: "measure", unit: "€/m²", derived: true,
    accessor: () => null,
    measureCompute: (records) => {
      // Weighted by m² — each € of price contributes proportionally to
      // the m² it covers. Σ price / Σ plocha. Far more meaningful than
      // simple mean(price/m²), which would double-count small units.
      // num() guards null/"" (Number(null)===0 would otherwise add a unit's m²
      // with a €0 price — an unpriced unit deflates the weighted €/m²). Require
      // a real positive price, matching the server path (s_pw/s_lw, price>0).
      let sumPrice = 0, sumPlocha = 0;
      for (const r of records) {
        const p = num(r.cena_s_dph);
        const m = num(r.obytna_plocha);
        if (p == null || p <= 0 || m == null || m <= 0) continue;
        sumPrice  += p;
        sumPlocha += m;
      }
      return sumPlocha > 0 ? sumPrice / sumPlocha : null;
    },
  },
  sold_count: {
    label: "Predaných (v cenníku)", label_en: "Sold (on the price list)",
    group: "measure", type: "measure", unit: "", derived: true,
    accessor: () => null,
    measureCompute: (records) => {
      let n = 0;
      for (const r of records) {
        if ((r.stav || "").trim().toUpperCase() === "P") n++;
      }
      return n;
    },
  },
  available_count: {
    label: "Voľných",
    group: "measure", type: "measure", unit: "", derived: true,
    accessor: () => null,
    measureCompute: (records) => {
      let n = 0;
      for (const r of records) {
        if ((r.stav || "").trim().toUpperCase() === "V") n++;
      }
      return n;
    },
  },
};

/* English labels for the (Slovak-primary) FIELDS registry. Resolved via
   fieldLabel() at every render site (palette, zone chips, result-table column
   headers, CSV export) so EN users don't see Slovak field names. Keys not listed
   here are already English (project_name, unit_id, developer, …) or
   carry an inline label_en (wavg_m2_price) → both fall back to .label. */
const FIELD_LABEL_EN = {
  datum: "Date", batch_timestamp: "Batch (exact time)", snapshot_month: "Month",
  typ: "Type", etapa: "Phase", budova: "Building",
  poschodie: "Floor", izby: "Rooms", obytna_plocha: "Living area",
  balkon: "Balcony", terasa: "Terrace", zahrada: "Garden", exterier: "Exterior",
  kobka: "Storage", celkova_plocha: "Total area",
  cena_bez_dph: "Price excl. VAT", cena_s_dph: "Price incl. VAT",
  stav: "Status", kolaudacia: "Handover", orientacia: "Orientation",
  country: "Country", city: "City", cast: "District", sub_district: "Sub-district",
  import_status: "Project status",
  cena_na_m2_obytnej: "Price per m² (living)",
  sold_count: "Sold (on the price list)", available_count: "Available",
};

/** Field label in the active UI language. EN prefers an inline `label_en`, then
    the FIELD_LABEL_EN map, else falls back to the (Slovak-primary) `.label`. */
function fieldLabel(fieldKey, lang) {
  const f = FIELDS[fieldKey];
  if (!f) return fieldKey;
  if (lang === "sk") return f.label;
  return f.label_en || FIELD_LABEL_EN[fieldKey] || f.label;
}

/* Order of fields in the palette. Mirrors Clean Master column order so the
   user's mental model stays intact when they switch between Residata and
   their Excel pivot. */
const FIELD_ORDER = [
  "datum", "snapshot_month", "batch_timestamp", "import_status",
  "project_name", "developer", "unit_id", "typ", "etapa", "budova",
  "poschodie", "izby", "obytna_plocha", "balkon", "loggia", "terasa",
  "zahrada", "exterier", "kobka", "celkova_plocha",
  "cena_bez_dph", "cena_s_dph",
  "stav", "kolaudacia", "orientacia",
  "country", "city", "cast", "sub_district",
  "cena_na_m2_obytnej",
  // Measures — group-level calculations, Values zone only
  "abs_rate", "wavg_m2_price", "sold_count", "available_count",
];

/* Which aggregations are valid per field type. Numbers get the full numeric
   suite; text columns only count / count_distinct. */
const AGGS_TEXT    = ["count", "count_distinct"];
const AGGS_NUMBER  = ["count", "count_distinct", "sum", "avg", "min", "max", "median"];
// Additive measures — the only ones for which "% of total / % of parent" is a real share.
// avg/min/max/median/measure are non-additive: a row ÷ grand value isn't a share (>100%).
const SHAREABLE_AGGS = new Set(["count", "count_distinct", "sum"]);
const AGGS_MEASURE = ["measure"];
const AGG_LABEL = {
  count:          "count",
  count_distinct: "count distinct",
  sum:            "sum",
  avg:            "avg",
  min:            "min",
  max:            "max",
  median:         "median",
  measure:        "computed",
};

/* Max row hierarchy depth — Excel lets you go deep but the UI breaks
   down quickly past 6 columns in the result table. */
const MAX_ROWS = 6;
const MAX_VALUES = 4;
const MAX_COLS = 1;    // cross-tab: 1 column field for now (keeps header legible)
const MAX_COL_VALUES = 12; // cap distinct column values so table stays readable

/* Column dimensions with a meaningful non-alphabetical order. Values not listed
   fall back after the known ones (locale-sorted). Everything else orders by type
   (numeric asc / chronological / locale) — see orderPivotColKeys. */
const COL_ORDINAL_ORDER = {
  stav: ["V", "R", "PR", "P", "Ešte nie v ponuke", "ERROR"], // canonical funnel order (matches the platform)
};

/* Pick which distinct column values survive the MAX_COL_VALUES cap (most-populated
   first, so the visible columns carry the most data), THEN order those for display
   in a logical left→right order (rooms 1<2<3<4, handover chronological, stav funnel,
   names natural, blanks last) — reliable for any dimension / filter / dataset. */
function orderCappedColKeys(countEntries, colField) {
  const topN = [...countEntries]
    .sort((a, b) => b[1] - a[1])        // frequency desc → selection
    .slice(0, MAX_COL_VALUES)
    .map(([k]) => k);
  return orderPivotColKeys(topN, {
    isNumber: FIELDS[colField]?.type === "number",
    ordinal: COL_ORDINAL_ORDER[colField],
  });
}

/* Path separator: unicode char unlikely to appear in any real value. */
const SEP = "\u2016";

/* Sentinel used in `filter.values` to mean "the (prázdne) / null bucket".
   Lets the user include or exclude records with missing values explicitly. */
const EMPTY_SENTINEL = "__EMPTY__";

/* ─── Default layout + persisted state ───────────────────────────
   The pivot opens on this layout (Krajina + Project name in Rows, avg €/m² as
   the value, on-market-only filter). Extracted as constants so the "Predvolené /
   Default" button can restore them and so the persistence layer has a baseline. */
const DEFAULT_ROWS    = ["country", "project_name"];
const DEFAULT_COLS    = [];
const DEFAULT_VALUES  = [{ key: "cena_na_m2_obytnej", field: "cena_na_m2_obytnej", agg: "avg" }];
// V/R/PR — the same "on offer" set the homepage, the reports and every district
// average use. It used to be V+PR, which silently dropped reserved units and made
// the pivot disagree with the headline number for no reason a customer could see;
// the page carried a standing paragraph explaining the discrepancy instead of not
// having one. (That paragraph was also wrong on its own terms: it claimed the
// pivot included sold units, past months and any project status, when the default
// is this filter, the current snapshot, and active projects only.) A saved pivot
// keeps whatever the user chose — this is only the starting point.
const DEFAULT_FILTERS = [{ key: "stav", mode: "in", values: ["V", "R", "PR"] }];
const DEFAULT_VALUE_MODE = "raw";
const DEFAULT_DATA_BARS  = true;
const DEFAULT_SORT       = { col: "count", dir: "desc" };

/* The default bundle the "Predvolené" button + a fresh start fall back to. */
const DEFAULT_BUNDLE = {
  rows: DEFAULT_ROWS, cols: DEFAULT_COLS, values: DEFAULT_VALUES, filters: DEFAULT_FILTERS,
  valueMode: DEFAULT_VALUE_MODE, dataBars: DEFAULT_DATA_BARS, sort: DEFAULT_SORT,
};

/* The canonical shape of a saved setup — used BOTH to build the snapshot that gets
   persisted and to apply one back onto the live state, so the two can never drift
   apart (a key present in one and missing from the other would read as a change on
   every mount and re-save the same content forever). */
function normalizeBundle(p) {
  return {
    rows: p.rows ?? DEFAULT_ROWS,
    cols: p.cols ?? DEFAULT_COLS,
    values: p.values ?? DEFAULT_VALUES,
    filters: p.filters ?? DEFAULT_FILTERS,
    valueMode: p.valueMode ?? DEFAULT_VALUE_MODE,
    dataBars: typeof p.dataBars === "boolean" ? p.dataBars : DEFAULT_DATA_BARS,
    sort: p.sort ?? DEFAULT_SORT,
  };
}

/* Persist the pivot setup (rows/cols/values/filters + display options) to localStorage
   so it SURVIVES navigating away (to Reports, etc.) and back + refreshes.
   ── ACCOUNT-SCOPED (2026-06-29) ──
   The key is namespaced by the logged-in user's id (or "anon"), so the setup sticks to
   the ACCOUNT — not the browser. This fixes the cross-account leak: logging in with a
   different account on the same browser previously showed the PREVIOUS account's setup
   (single shared key). Now each account reads only its own key; a new account starts
   clean. (For a logged-in user the DB copy in user_profiles.pivot_prefs is still the
   cross-device source of truth — this keyed localStorage is just an instant per-account
   cache + the anon fallback.) */
const PIVOT_KEY_PREFIX = "residata.pivotV2.state.v2.";
function pivotStateKey(scope) { return PIVOT_KEY_PREFIX + (scope || "anon"); }

/* Restored configs are SANITISED against the current FIELDS registry: a saved key
   for a field that no longer exists (e.g. a retired palette entry) is dropped, so a
   stale blob can never wedge the pivot. */
function _knownDim(k) { return !!FIELDS[k]; }
// Allow-lists + bounds for the validator. A persisted blob is UNTRUSTED input
// (localStorage is user-writable; pivot_prefs round-trips through the DB), so we
// validate STRUCTURE, not just field keys — a malformed/oversized filter or sort
// must never reach buildPivotSpec / the SQL engine / the sort logic.
const VALID_FILTER_MODES = new Set(["in", "not_in", "between", "empty", "not_empty"]);
const VALID_AGGS = new Set(["count", "count_distinct", "sum", "avg", "min", "max", "median", "measure"]);
const MAX_FILTERS = 50;          // generous; a real pivot uses a handful
const MAX_FILTER_VALUES = 300;   // e.g. selecting many cities; bounded
const MAX_VALUE_LEN = 120;       // a single filter value (a city/dev name) is short

function _sanFilter(f) {
  if (!f || typeof f !== "object" || !_knownDim(f.key)) return null;
  const out = { key: f.key };
  if (f.mode != null) { if (!VALID_FILTER_MODES.has(f.mode)) return null; out.mode = f.mode; }
  if (Array.isArray(f.values)) {
    out.values = f.values
      .filter(v => v == null || typeof v === "string" || typeof v === "number")
      .slice(0, MAX_FILTER_VALUES)
      .map(v => (v == null ? v : String(v).slice(0, MAX_VALUE_LEN)));
  }
  if (f.min != null && Number.isFinite(Number(f.min))) out.min = Number(f.min);
  if (f.max != null && Number.isFinite(Number(f.max))) out.max = Number(f.max);
  if (typeof f.includeEmpty === "boolean") out.includeEmpty = f.includeEmpty;
  return out;
}
function _sanValue(v) {
  if (!v || typeof v !== "object" || !_knownDim(v.field)) return null;
  if (v.agg != null && !VALID_AGGS.has(v.agg)) return null;
  return { key: typeof v.key === "string" ? v.key : v.field, field: v.field, agg: v.agg };
}
function _sanSort(s) {
  if (!s || typeof s !== "object") return undefined;
  // col is "label" | "count" | a numeric value-index; dir is asc|desc.
  const col = (typeof s.col === "string" || typeof s.col === "number") ? s.col : "count";
  return { col, dir: s.dir === "asc" ? "asc" : "desc" };
}
function sanitizePivotState(s) {
  if (!s || typeof s !== "object") return null;
  const out = {};
  if (Array.isArray(s.rows))    out.rows    = s.rows.filter(_knownDim).slice(0, MAX_ROWS);
  if (Array.isArray(s.cols))    out.cols    = s.cols.filter(_knownDim).slice(0, MAX_COLS);
  if (Array.isArray(s.values))  out.values  = s.values.map(_sanValue).filter(Boolean).slice(0, MAX_VALUES);
  if (Array.isArray(s.filters)) out.filters = s.filters.map(_sanFilter).filter(Boolean).slice(0, MAX_FILTERS);
  if (s.valueMode === "raw" || s.valueMode === "pct_total" || s.valueMode === "pct_parent") out.valueMode = s.valueMode;
  if (typeof s.dataBars === "boolean") out.dataBars = s.dataBars;
  const srt = _sanSort(s.sort); if (srt) out.sort = srt;
  return out;
}
function loadPivotState(scope) {
  try {
    const raw = typeof window !== "undefined" && window.localStorage.getItem(pivotStateKey(scope));
    return raw ? sanitizePivotState(JSON.parse(raw)) : null;
  } catch { return null; }
}
/* One-time cleanup of the pre-2026-06-29 SHARED key (the leak source). */
function purgeLegacyPivotState() {
  try { window.localStorage.removeItem("residata.pivotV2.state.v1"); } catch { /* ignore */ }
}

/* Stable empty array — passed as `records` to FilterPopover on the grain fast-path
   (values come from distinctOverride, not records) so its useMemo never re-runs on a
   fresh [] identity each render. */
const EMPTY_RECORDS = [];

/* ───────────────────────── Helpers ───────────────────────── */
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normKey(v) {
  if (v == null) return "(prázdne)";
  const s = String(v).trim();
  return s === "" ? "(prázdne)" : s;
}

/* Row-field → project attribute, for the targeted drill-down fetch. When a
   pivot row dimension is one of these (project-level), we resolve the clicked
   group to a set of project ids and fetch ONLY those projects' flats instead of
   the whole dataset. Fields not listed here are flat-level (stav, izby, typ,
   poschodie…) and are matched client-side after the fetch. */
const PROJECT_LEVEL_ATTR = {
  project_name: "name",
  developer: "developer",
  cast: "district",
  city: "city",
  import_status: "status",
  sub_district: "sub_district",
};

/* Compute one aggregated value from a set of records. Returns a number
   (or null when the aggregation has no defined value, e.g., avg of empty). */
/* ────────────── Filters ──────────────
   A filter is `{ key, mode, values?, min?, max?, includeEmpty? }`:
     mode === "in"       → include only records where value ∈ values
     mode === "not_in"   → exclude records where value ∈ values
     mode === "between"  → numeric range (min..max)
     mode === "empty"    → only records with null/empty value
     mode === "not_empty"→ only records with a non-empty value
     mode undefined / no values & no range → inactive (pass-through).
                                              Keeps a freshly-dropped
                                              filter chip from nuking the
                                              dataset until user configures.
*/
function isFilterActive(f) {
  if (!f) return false;
  if (f.mode === "empty" || f.mode === "not_empty") return true;
  if (f.mode === "between") return f.min != null || f.max != null;
  return Array.isArray(f.values) && f.values.length > 0;
}

function passesFilter(record, filter) {
  if (!isFilterActive(filter)) return true;
  const field = FIELDS[filter.key];
  if (!field) return true;
  const v = field.accessor(record);
  const isEmpty = v == null || v === "";

  if (filter.mode === "empty")     return isEmpty;
  if (filter.mode === "not_empty") return !isEmpty;

  // Numeric range
  if (filter.mode === "between") {
    if (isEmpty) return !!filter.includeEmpty;
    const n = Number(v);
    if (!Number.isFinite(n)) return false;
    if (filter.min != null && n < Number(filter.min)) return false;
    if (filter.max != null && n > Number(filter.max)) return false;
    return true;
  }

  // Value-set inclusion / exclusion
  const vals = filter.values || [];
  const wantsEmpty = vals.includes(EMPTY_SENTINEL);
  const otherVals = vals.filter(x => x !== EMPTY_SENTINEL);

  let hit;
  if (isEmpty) {
    hit = wantsEmpty;
  } else if (field.type === "number") {
    const n = Number(v);
    hit = otherVals.some(x => {
      const xn = Number(x);
      return Number.isFinite(xn) && xn === n;
    });
  } else {
    const s = String(v).trim().toLowerCase();
    hit = otherVals.some(x => String(x).trim().toLowerCase() === s);
  }
  return filter.mode === "not_in" ? !hit : hit;
}

/* Return sorted distinct values + empty flag + quick stats for a given
   field across a record set. Used by the filter popover to render a
   correctly-sized picker.                                              */
function distinctValuesForField(records, fieldKey) {
  const field = FIELDS[fieldKey];
  if (!field) return { values: [], hasEmpty: false, isNumber: false, stats: null };

  let hasEmpty = false;
  const seen = new Set();
  const nums = [], strs = [];
  for (const r of records) {
    const v = field.accessor(r);
    if (v == null || v === "") { hasEmpty = true; continue; }
    if (field.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || seen.has(n)) continue;
      seen.add(n); nums.push(n);
    } else {
      const s = String(v);
      const key = s.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); strs.push(s);
    }
  }
  let values;
  if (field.type === "number") {
    values = nums.sort((a, b) => a - b).map(String);
  } else {
    values = strs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  // Stats for numeric
  let stats = null;
  if (field.type === "number" && nums.length) {
    const sorted = [...nums].sort((a, b) => a - b);
    const m = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
    stats = {
      min: sorted[0], max: sorted[sorted.length - 1],
      median, distinct: values.length, count: nums.length,
    };
  }

  return { values, hasEmpty, isNumber: field.type === "number", stats };
}

/* Short human summary of a filter's state, for rendering on the chip. */
function summariseFilter(filter, _fieldType, lang) {
  if (!isFilterActive(filter)) return "";
  const en = lang != null && lang !== "sk";   // default to SK when lang is absent (SK is the primary locale)
  if (filter.mode === "empty")     return en ? "is empty" : "je prázdne";
  if (filter.mode === "not_empty") return en ? "has value" : "má hodnotu";
  if (filter.mode === "between") {
    const parts = [];
    if (filter.min != null) parts.push(`≥ ${filter.min}`);
    if (filter.max != null) parts.push(`≤ ${filter.max}`);
    return parts.join(" · ");
  }
  const vals = filter.values || [];
  const n = vals.length;
  const prefix = filter.mode === "not_in" ? "≠" : "=";
  if (n === 0) return "";
  if (n === 1) {
    const v = vals[0] === EMPTY_SENTINEL ? "(prázdne)" : String(vals[0]);
    return `${prefix} ${v}`;
  }
  if (n <= 3) {
    return `${prefix} ${vals.map(v => v === EMPTY_SENTINEL ? "(prázdne)" : v).join(", ")}`;
  }
  return `${prefix} ${n} hodnôt`;
}

function compute(field, agg, records) {
  // count doesn't need a field — it's just the record count. This path
  // also serves the default "__count__" measure (values.length===0) where
  // field is null. Used to return null here, which made the default
  // Count column render as "—" on first drop.
  if (agg === "count") return records.length;
  if (!field) return null;
  // Measure fields carry their own single calculation
  if (field.type === "measure" && typeof field.measureCompute === "function") {
    return field.measureCompute(records);
  }

  // Accessor is needed beyond count — returns field value per record
  const acc = field.accessor;

  if (agg === "count_distinct") {
    const s = new Set();
    for (const r of records) {
      const v = acc(r);
      if (v != null && v !== "") s.add(String(v).trim());
    }
    return s.size;
  }

  const nums = [];
  for (const r of records) {
    const v = acc(r);
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) nums.push(n);
  }
  if (nums.length === 0) return null;

  switch (agg) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return Math.min(...nums);
    case "max": return Math.max(...nums);
    case "median": {
      const s = [...nums].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    default: return null;
  }
}

/* Distinct values of a column field across the dataset. Capped to MAX_COL_VALUES
   (most-populated first) so the header stays legible, then ordered logically for
   display (see orderCappedColKeys). Empty values fold into the (prázdne) bucket. */
function distinctColValues(records, colField) {
  const f = FIELDS[colField];
  if (!f) return [];
  const counts = new Map();
  for (const r of records) {
    const v = normKey(f.accessor(r));
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return orderCappedColKeys(counts.entries(), colField);
}

/* Build the pivot tree. Rolls up rollups[] per node from its own records
   — NOT from children — so every aggregation stays mathematically
   correct (avg of 10k flats ≠ avg of group averages).

   Cross-tab (Columns zone) support:
     If colFields has a field, each node gets `colRollups: { colKey: [values] }`
     in addition to the flat `rollups: [values]` (total across all cols).
     `colKeys` is attached to the root so the header can enumerate
     columns consistently (including the "Σ" grand-col).
*/
function buildTree(records, rowFields, colFields, valueDefs) {
  // Enumerate distinct column values globally — same axis across all rows.
  const colKeys = colFields.length
    ? distinctColValues(records, colFields[0])
    : null;
  const colAcc = colFields.length ? FIELDS[colFields[0]]?.accessor : null;

  const rollupsFor = (recs) =>
    valueDefs.map((v) => compute(FIELDS[v.field], v.agg, recs));

  // Per-column rollups: partition `recs` by col key, compute values for each.
  const colRollupsFor = (recs) => {
    if (!colKeys) return null;
    const byKey = {};
    for (const ck of colKeys) byKey[ck] = [];
    // Other bucket: rows whose col-value isn't in the top-MAX — we ignore
    // them for the per-col cells but they still contribute to totals.
    for (const r of recs) {
      const ck = normKey(colAcc(r));
      if (byKey[ck]) byKey[ck].push(r);
    }
    const out = {};
    for (const ck of colKeys) out[ck] = rollupsFor(byKey[ck]);
    return out;
  };

  if (rowFields.length === 0) {
    return {
      label: "Total", path: [], pathKey: "",
      level: -1, colKeys,
      records, count: records.length,
      rollups: rollupsFor(records),
      colRollups: colRollupsFor(records),
      children: [],
      isLeaf: true,
    };
  }

  const rec = (recs, depth, prefix) => {
    const f = FIELDS[rowFields[depth]];
    const byKey = new Map();
    for (const r of recs) {
      const key = normKey(f.accessor(r));
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }
    const isDeepest = depth === rowFields.length - 1;
    const out = [];
    for (const [key, items] of byKey) {
      const path = [...prefix, key];
      out.push({
        label: key,
        path,
        pathKey: path.join(SEP),
        level: depth,
        records: items,
        count: items.length,
        rollups: rollupsFor(items),
        colRollups: colRollupsFor(items),
        children: isDeepest ? [] : rec(items, depth + 1, path),
        isLeaf: isDeepest,
      });
    }
    return out;
  };

  return {
    label: "Total", path: [], pathKey: "",
    level: -1, colKeys,
    records, count: records.length,
    rollups: rollupsFor(records),
    colRollups: colRollupsFor(records),
    children: rec(records, 0, []),
    isLeaf: false,
  };
}

/* ═══ Server-side aggregation (forever perf fix) ════════════════════════════
   pivot_grain returns one row per group with DECOMPOSABLE measure components,
   so we rebuild the SAME tree shape buildTree produces — but by summing
   components up the hierarchy instead of holding 152k records. Identical math
   for count/sum/avg/min/max + the 4 measures. A config is "server-able" only
   when every value uses those aggs on a supported field, every dim is
   whitelisted, and the only active filters are time (datum / snapshot_month).
   Anything else (median, count_distinct, rare fields, ad-hoc filters) → the
   caller keeps the existing record path. */
// Server-able dimensions. CONTRACT: every key here MUST be an enabled key in
// analytics.dim_registry (the DB single-source-of-truth that the engine resolves
// against). This set is therefore a curated SUBSET of the registry — registry dims
// that are intentionally not surfaced (e.g. all-NULL `lifecycle`, or `market` which
// is redundant with `country` for the two active markets) are simply omitted.
// Self-guarding: if a key here is NOT registered, analytics_pivot RAISEs
// 'unknown dim …' loudly at query time (no silent wrong data). Verified 2026-06-29
// against the live registry (developer / sub_district / batch_timestamp all present).
const SERVERABLE_DIMS = new Set([
  "project_name", "developer", "typ", "etapa", "budova", "unit_id",
  "izby", "poschodie", "stav", "kolaudacia", "orientacia",
  "country", "city", "cast", "sub_district",
  "import_status", "snapshot_month", "datum", "batch_timestamp",
]);
// numeric field key → component prefix in the grain's `m` object
const COMP_FIELD = {
  cena_s_dph: "cs", cena_bez_dph: "cb", obytna_plocha: "ob", celkova_plocha: "ce",
  izby: "iz", poschodie: "po", cena_na_m2_obytnej: "m2",
};
const SERVERABLE_MEASURES = new Set(["abs_rate", "wavg_m2_price", "sold_count", "available_count"]);
// Time-axis dimensions. Using any of these as a Row/Column means "trend over time"
// → the pivot must read the archive, not just the current snapshot (see isCurrent).
const TIME_DIMS = new Set(["datum", "snapshot_month", "batch_timestamp"]);

function isServerable(rowFields, colFields, valueDefs, filters) {
  for (const d of [...rowFields, ...colFields]) if (!SERVERABLE_DIMS.has(d)) return false;
  for (const v of valueDefs) {
    if (v.field == null || v.field === "__count__") { if (v.agg !== "count") return false; continue; }
    const f = FIELDS[v.field];
    if (!f) return false;
    if (f.type === "measure") { if (!SERVERABLE_MEASURES.has(v.field)) return false; continue; }
    if (!COMP_FIELD[v.field]) return false;                       // unsupported numeric field
    if (!["count", "sum", "avg", "min", "max"].includes(v.agg)) return false;  // median/count_distinct
  }
  // Filters are now ALL applied server-side by analytics_pivot (any dim, any mode:
  // in / not_in / between / empty / not_empty — see buildPivotSpec). A filter is
  // server-able when it maps cleanly to the engine: a `between` on a range-able
  // measure, or any other mode on a registered dim. Anything else → record path.
  for (const f of (filters || [])) {
    if (!isFilterActive(f)) continue;
    // Server-able when the field is a registered dim (any mode) OR a range-able measure
    // (between / empty / not_empty / in on price·area·€m² — the engine resolves measures
    // via measure_registry). Anything else → record path.
    if (!SERVERABLE_DIMS.has(f.key) && !SERVER_RANGE_FIELDS.has(f.key)) return false;
  }
  return true;
}

// Numeric fields whose `between` range filter the engine can apply (mapped to a
// measure_registry field in buildPivotSpec). Everything else routes via dims.
const SERVER_RANGE_FIELDS = new Set([
  "cena_s_dph", "cena_bez_dph", "obytna_plocha", "celkova_plocha", "cena_na_m2_obytnej", "izby", "poschodie",
  // area sub-fields the UI also offers a numeric range for (engine measure_registry has them):
  "balkon", "loggia", "terasa", "zahrada", "exterier", "kobka",
]);
// UI field key → engine measure_registry key, where they differ.
const RANGE_MEASURE_KEY = { cena_na_m2_obytnej: "price_per_m2" };

/* Build the analytics_pivot spec from the pivot UI state. Mirrors passesFilter()
   semantics EXACTLY so the server result equals the old client-filtered tree:
     in / not_in → filters / filters_not  ((prázdne) sentinel → JSON null = "or empty")
     between     → ranges {min,max,includeEmpty}   empty/not_empty → nulls
   country comes from the global selector (not a chip); months/dates/stav are just
   ordinary dim filters. mode = latest (current state) | archive (a time filter set). */
function buildPivotSpec({ dims, filters, country, isCurrent }) {
  const spec = { dims, mode: isCurrent ? "latest" : "archive", filters: {}, filters_not: {}, ranges: {}, nulls: {} };
  if (!isAllCountries(country)) spec.filters.country = [country];
  const ek = (k) => RANGE_MEASURE_KEY[k] || k;   // UI field key → engine key (measures; no-op for dims)
  for (const f of (filters || [])) {
    if (!isFilterActive(f)) continue;
    if (f.mode === "empty" || f.mode === "not_empty") { spec.nulls[ek(f.key)] = f.mode; continue; }
    if (f.mode === "between") {
      // between is only meaningful for a range-able numeric field (the UI gates it to
      // isNumber). Guard so a stray non-numeric between can never produce an invalid spec.
      if (SERVER_RANGE_FIELDS.has(f.key)) spec.ranges[ek(f.key)] = { min: f.min ?? null, max: f.max ?? null, includeEmpty: !!f.includeEmpty };
      continue;
    }
    const vals = (f.values || []).map(v => (v === EMPTY_SENTINEL ? null : String(v)));
    if (f.mode === "not_in") spec.filters_not[ek(f.key)] = vals;
    else spec.filters[ek(f.key)] = vals;          // 'in' (default)
  }
  if (!Object.keys(spec.filters_not).length) delete spec.filters_not;
  if (!Object.keys(spec.ranges).length) delete spec.ranges;
  if (!Object.keys(spec.nulls).length) delete spec.nulls;
  return spec;
}

/* A filter field whose distinct values can be fetched server-side via ONE fast
   pivot_grain(p_dims=[field]) call, instead of pulling all ~30k records just to
   list a handful of values. Eligible = a server-able dimension that is categorical
   (NOT a numeric range — those need min/max/median stats computed from records) and
   NOT a time field (datum/snapshot_month synthesize options from the light
   archive_days/archive_months lists). Covers stav, typ, developer, city, district,
   orientation, kolaudácia, etapa, … — the common categorical filters. */
function fieldUsesGrainValues(key) {
  return SERVERABLE_DIMS.has(key)
    && !!FIELDS[key] && FIELDS[key].type !== "number"
    && key !== "datum" && key !== "snapshot_month";
}

/* Continuous numeric fields whose range-filter popover gets its min/max/median from
   the report_field_stats RPC (one fast call on the NATIVE column) instead of a
   ~30k-row pull. (izby/poschodie are low-cardinality discrete dims that keep the
   records path so their value-checkbox "in" mode still works.) */
const STATS_RPC_FIELDS = new Set([
  "cena_s_dph", "cena_bez_dph", "obytna_plocha", "celkova_plocha", "cena_na_m2_obytnej",
]);
function fieldUsesStatsRpc(key) { return STATS_RPC_FIELDS.has(key); }

const _COMP_PREFIXES = ["cs", "cb", "ob", "ce", "iz", "po", "m2"];
function emptyComp() {
  const c = { n: 0, avail: 0, sold: 0, res: 0, prer: 0, s_pw: 0, s_lw: 0 };
  for (const p of _COMP_PREFIXES) { c["s_" + p] = 0; c["n_" + p] = 0; c["mn_" + p] = null; c["mx_" + p] = null; }
  return c;
}
function addComp(acc, m) {
  if (!m) return;
  acc.n += +m.n || 0; acc.avail += +m.avail || 0; acc.sold += +m.sold || 0;
  acc.res += +m.res || 0; acc.prer += +m.prer || 0;
  acc.s_pw += +m.s_pw || 0; acc.s_lw += +m.s_lw || 0;
  for (const p of _COMP_PREFIXES) {
    acc["s_" + p] += +m["s_" + p] || 0;
    acc["n_" + p] += +m["n_" + p] || 0;
    const mn = m["mn_" + p], mx = m["mx_" + p];
    if (mn != null) acc["mn_" + p] = acc["mn_" + p] == null ? +mn : Math.min(acc["mn_" + p], +mn);
    if (mx != null) acc["mx_" + p] = acc["mx_" + p] == null ? +mx : Math.max(acc["mx_" + p], +mx);
  }
}
function computeFromComp(v, c) {
  if (!c) return null;
  if (v.field == null || v.field === "__count__" || v.agg === "count") return c.n;
  const f = FIELDS[v.field];
  if (f && f.type === "measure") {
    switch (v.field) {
      case "abs_rate":      { const d = c.sold + c.avail; return d > 0 ? (c.sold / d) * 100 : null; }
      case "wavg_m2_price": return c.s_lw > 0 ? c.s_pw / c.s_lw : null;
      case "sold_count":    return c.sold;
      case "available_count": return c.avail;
      default: return null;
    }
  }
  const p = COMP_FIELD[v.field];
  if (!p) return null;
  const cnt = c["n_" + p];
  switch (v.agg) {
    case "sum": return cnt > 0 ? c["s_" + p] : null;
    case "avg": return cnt > 0 ? c["s_" + p] / cnt : null;
    case "min": return c["mn_" + p];
    case "max": return c["mx_" + p];
    default: return null;
  }
}

/* Build the same tree buildTree produces, from grain rows [{d:[dimVals], m:{components}}].
   d holds the row dims then the (optional) col dim, in the order they were sent. */
function buildTreeFromGrain(grain, rowFields, colFields, valueDefs) {
  const safe = Array.isArray(grain) ? grain : [];
  const hasCol = colFields.length > 0;
  const colIdx = rowFields.length;
  let colKeys = null;
  let colOverflow = 0;   // # distinct column values beyond MAX_COL_VALUES (folded into Σ only)
  if (hasCol) {
    const counts = new Map();
    for (const g of safe) { const ck = normKey(g.d[colIdx]); counts.set(ck, (counts.get(ck) || 0) + (+g.m.n || 0)); }
    colKeys = orderCappedColKeys(counts.entries(), colFields[0]);
    colOverflow = Math.max(0, counts.size - colKeys.length);
  }
  const rollupsFor = (rows) => { const c = emptyComp(); for (const g of rows) addComp(c, g.m); return valueDefs.map(v => computeFromComp(v, c)); };
  // Per-node stav components (grain rows carry no records) so the table can show
  // the on-offer / sold split on every row, not just the header total.
  const compFor = (rows) => { const c = emptyComp(); for (const g of rows) addComp(c, g.m); return c; };
  const countFor = (rows) => rows.reduce((a, g) => a + (+g.m.n || 0), 0);
  const colRollupsFor = (rows) => {
    if (!colKeys) return null;
    const byKey = {}; for (const ck of colKeys) byKey[ck] = [];
    for (const g of rows) { const ck = normKey(g.d[colIdx]); if (byKey[ck]) byKey[ck].push(g); }
    const out = {}; for (const ck of colKeys) out[ck] = rollupsFor(byKey[ck]); return out;
  };
  if (rowFields.length === 0) {
    return { label: "Total", path: [], pathKey: "", level: -1, colKeys, colOverflow, records: [], count: countFor(safe), rollups: rollupsFor(safe), colRollups: colRollupsFor(safe), children: [], isLeaf: true };
  }
  const rec = (rows, depth, prefix) => {
    const byKey = new Map();
    for (const g of rows) { const key = normKey(g.d[depth]); if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(g); }
    const isDeepest = depth === rowFields.length - 1;
    const out = [];
    for (const [key, items] of byKey) {
      const path = [...prefix, key];
      out.push({ label: key, path, pathKey: path.join(SEP), level: depth, records: [], comp: compFor(items), count: countFor(items), rollups: rollupsFor(items), colRollups: colRollupsFor(items), children: isDeepest ? [] : rec(items, depth + 1, path), isLeaf: isDeepest });
    }
    return out;
  };
  return { label: "Total", path: [], pathKey: "", level: -1, colKeys, colOverflow, records: [], count: countFor(safe), rollups: rollupsFor(safe), colRollups: colRollupsFor(safe), children: rec(safe, 0, []), isLeaf: false };
}

/* Sort the tree in-place by the value at column `sortIdx` (or by label
   when sortIdx === "label") in direction dir. Every subtree sorts
   among its siblings — parent order is preserved. */
function sortTree(nodes, sortIdx, dir) {
  const cmp = (a, b) => {
    let av, bv;
    if (sortIdx === "label") {
      av = a.label; bv = b.label;
      return dir === "desc"
        ? String(bv).localeCompare(String(av), undefined, { numeric: true })
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
    }
    if (sortIdx === "count") {
      av = a.count; bv = b.count;
    } else {
      av = a.rollups[sortIdx]; bv = b.rollups[sortIdx];
    }
    // Nulls AND NaN sort to the end regardless of direction. NaN comes
    // from compute() returning NaN when an aggregate hits invalid input
    // (e.g., avg over rows where every cena is null after filtering).
    // Treating NaN like null avoids unstable sort orders where Array.sort
    // gets a NaN comparator return and shuffles rows non-deterministically.
    const aBad = av == null || (typeof av === "number" && !Number.isFinite(av));
    const bBad = bv == null || (typeof bv === "number" && !Number.isFinite(bv));
    if (aBad && bBad) return 0;
    if (aBad) return 1;
    if (bBad) return -1;
    return dir === "desc" ? bv - av : av - bv;
  };
  const sorted = [...nodes].sort(cmp);
  for (const n of sorted) {
    if (n.children?.length) n.children = sortTree(n.children, sortIdx, dir);
  }
  return sorted;
}

/* Flatten the tree for table rendering. Collapsed nodes emit themselves
   but NOT their children. */
function flattenTree(nodes, collapsed) {
  const out = [];
  const walk = (n) => {
    const isCollapsed = collapsed.has(n.pathKey);
    const hasChildren = n.children.length > 0;
    out.push({ ...n, isCollapsed, hasChildren });
    if (hasChildren && !isCollapsed) for (const c of n.children) walk(c);
  };
  for (const r of nodes) walk(r);
  return out;
}

/* Format a value for display based on the field's unit + aggregation.
   Numbers get locale spacing, integers where appropriate, unit suffix. */
/** True for the two money units in the FIELDS registry ("€", "€/m²"). */
function isMoneyUnit(u) { return u === "€" || u === "€/m²"; }
/** Map a stored (EUR) money unit to the current display-currency unit. */
function displayMoneyUnit(u) { return u === "€" ? moneySymbol() : u === "€/m²" ? `${moneySymbol()}/m²` : u; }

/* Unified number formatting — one consistent rule PER CATEGORY, so a column
   never mixes "1 234.5" and "1 234" or shows cents on a price. Categories:
     · Money (prices, €/m²)        → whole numbers, always       "450 000 €"
     · Percent (%)                 → 1 decimal                   "73.2 %"
     · Counts (count_*, count meas)→ whole                       "4 558"
     · Sum of anything else        → whole (aggregate total)     "123 456 m²"
     · Area / rooms / floor, via
       avg / median / min / max    → 1 decimal                   "65.4 m²", "2.3"
*/
const _fmtWhole = (x) => Math.round(x).toLocaleString("en-US").replace(/,/g, " ");
const _fmtDec1  = (x) => (Math.round(x * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/,/g, " ");

function formatValue(value, fieldKey, agg) {
  if (value == null || !Number.isFinite(value)) return "—";
  // Count aggregations are dimensionless ROW counts — they NEVER carry the
  // field's unit and are NEVER currency-converted, whatever field they sit on
  // (counting non-null prices is still a count, not a price). This MUST come
  // before the money/% branches: otherwise count-of-a-€-field rendered the
  // count as "300 €/m²" and even multiplied it by the FX rate in CZK view.
  // (QA: "price per m2 → count shows 300 eur/m2".)
  if (agg === "count" || agg === "count_distinct") return _fmtWhole(value);

  const f = FIELDS[fieldKey];
  const u = f?.unit;
  // Money fields store EUR — convert to the display currency + swap the unit.
  let v = value;
  if (isMoneyUnit(u)) v = moneyFromEur(v);
  const unit = u ? ` ${isMoneyUnit(u) ? displayMoneyUnit(u) : u}` : "";

  if (isMoneyUnit(u)) return `${_fmtWhole(v)}${unit}`;                 // prices + €/m² → whole
  if (u === "%")      return `${_fmtDec1(v)}${unit}`;                  // percent → 1 decimal
  if (agg === "measure") return `${_fmtWhole(v)}${unit}`;             // sold/available counts → whole
  if (agg === "sum")     return `${_fmtWhole(v)}${unit}`;             // aggregate totals → whole
  return `${_fmtDec1(v)}${unit}`;                                     // area / rooms / floor (avg/min/max/median) → 1 decimal
}

function aggLabel(v) {
  return AGG_LABEL[v.agg] || v.agg;
}

/* Sensible default aggregation for a field just dropped into Values.
   User asked for COUNT default across the board — numbers start there
   too, then the user upgrades to avg/sum when they're ready. Measures
   have their own single fixed "measure" calculation. */
function defaultAggFor(field) {
  if (field && field.type === "measure") return "measure";
  return "count";
}

/* ══════════════════════════ Main component ════════════════════════ */
export default function PivotV2({ lang = "sk", setCurrent }) {
  useCurrency(); // subscribe: re-render pivot tables/charts/drill-down on currency toggle
  const { projects, loading: loadingProjects } = useProjects();
  const { country } = useCountry();   // for targeted drill-down fetch
  const { can } = useCapabilities();
  const canViewAnalytics = can("view_analytics");
  const { user } = useAuth();   // account id → the per-account localStorage cache read below

  // Mesiac/Datum is a regular filterable dimension. The pivot opens pinned to the
  // latest scrape (the seeding effect below), so we drive the archive FETCH off
  // that same Filters state: by default fetch ONLY the latest month (~19k rows,
  // ~2-3s) instead of every month (216k rows / 30-60s). Adding months/dates to
  // the filter refetches them; clearing the filter (after first paint) loads all
  // history. This is the "server-side month filtering driven off the same Filters
  // state" the previous note deferred — now that the archive is big enough to
  // matter. The month/date filter governs BOTH the fetch scope and the display,
  // so the pivot can never show a month it didn't fetch (no data-gap).
  // Default filter: show only the on-market units a buyer is actually shopping —
  // Voľné (V) + Predrezervované (PR). Pushed to the grain RPC (p_stav) so the
  // default stays instant. The user can edit/clear the chip to see all statuses.
  // First paint reads this account's local cache so the pivot never flashes the
  // default layout before the saved one lands. Scoped to the account id (or "anon"
  // when not yet known) so it can NEVER show another account's setup; the hook below
  // then applies the authoritative value from the account's preference store.
  const [persisted] = useState(() => loadPivotState(user?.id));
  // Default filter: show only the on-market units a buyer is actually shopping —
  // Voľné (V) + Predrezervované (PR). Pushed to the grain RPC (p_stav) so the
  // default stays instant. The user can edit/clear the chip to see all statuses.
  const [filters, setFilters] = useState(persisted?.filters ?? DEFAULT_FILTERS);
  // Default layout: Krajina (country) + Project name in Rows, average €/m² as the
  // value, filtered to on-market units (V + PR). The user immediately sees, per
  // country, which projects sit at which price level among the units actually for
  // sale — the canonical first question in residential-market analysis. (Declared
  // here, above isCurrent, so the time-axis logic below can read Rows/Cols.)
  const [rows,    setRows]    = useState(persisted?.rows   ?? DEFAULT_ROWS);
  const [cols,    setCols]    = useState(persisted?.cols   ?? DEFAULT_COLS);
  const [values,  setValues]  = useState(persisted?.values ?? DEFAULT_VALUES);
  // Forever perf fix (2026-06-11): server-able configs render from the pivot_grain
  // RPC (instant), and we fetch raw rows ONLY when a config can't be aggregated
  // server-side (median / count_distinct / rare field / ad-hoc filter) or the user
  // drills into a cell. forceRaw flips us onto that record path.
  const [forceRaw, setForceRaw] = useState(false);
  const { months: archiveMonths } = useArchiveMonths();
  const { days: archiveDays } = useArchiveDays();
  // Time scope — shared by the grain RPC and the (lazy) record fetch. Day-scope
  // by the Datum filter (default = latest scrape day); month-scope by the Mesiac
  // filter. Datum alone → date-range only (fast, no month filter mixed in).
  const fetchMonths = useMemo(() => {
    const monthF = filters.find(f => f.key === "snapshot_month");
    return monthF?.values?.length ? monthF.values.map(String) : undefined;
  }, [filters]);
  const fetchDates = useMemo(() => {
    const dateF = filters.find(f => f.key === "datum");
    return dateF?.values?.length ? dateF.values.map(String) : undefined;
  }, [filters]);
  // A stav (status) filter is pushed to the grain RPC (p_stav) so the default
  // "only Voľné + Predrezervované" view stays server-able/instant. Strip the
  // (prázdne) sentinel — the RPC matches concrete stav codes (V/PR/R/P/…).
  const fetchStav = useMemo(() => {
    const stavF = filters.find(f => f.key === "stav" && (!f.mode || f.mode === "in"));
    const vals = stavF?.values?.filter(v => v !== EMPTY_SENTINEL).map(String);
    return vals && vals.length ? vals : undefined;
  }, [filters]);
  // "Current" view = no time scope → each project's LATEST snapshot. This is the
  // default and the only cross-market-correct mode (SK + CZ scrape on different
  // days, so a single global "latest day" would miss one market). The grain RPC
  // reads flats_current here; any Datum/Mesiac filter switches to flats_archive.
  //
  // A time dimension in Rows/Cols (Datum / Mesiac / Batch-čas) ALSO switches to the
  // archive: putting Datum in Rows means "show me the trend over time", which only
  // exists in history. Without this the series stayed pinned to the single current
  // snapshot → one bucket, "doesn't move by date" (the exact symptom Boss reported).
  // This makes BOTH the grain path AND the record path (median/count_distinct over
  // time) time-travel correctly, not just a time *filter*.
  const groupByTime = rows.some(d => TIME_DIMS.has(d)) || cols.some(d => TIME_DIMS.has(d));
  const isCurrent = !fetchDates && !fetchMonths && !groupByTime;
  // Records are fetched ONLY when forceRaw (non-server-able config or drill-down).
  // Current view pulls flats_current (cross-market current); time-travel pulls the
  // day/month-scoped archive.
  const { flats: archiveFlats, loading: loadingArchive, progress: flatsProgress } = useFlatsArchive(fetchMonths, fetchDates, forceRaw && !isCurrent);
  const { flats: currentFlatsRaw, loading: loadingCurrent } = useFlatsCurrent(forceRaw && isCurrent);
  const realFlats = isCurrent ? currentFlatsRaw : archiveFlats;
  const loadingFlats = isCurrent ? loadingCurrent : loadingArchive;

  // Latest batch DATE (YYYY-MM-DD) — used to auto-seed the Datum filter
  // so the pivot opens on "the most recent scrape" by default. Computed
  // lazily AFTER `records` is built so it works for both paid users
  // (real flats) AND free/anon (synthetic preview rows). Auto-rolls
  // forward the moment a new batch lands in flats_archive.
  // (Computed below — see latestDatum useMemo after `records`.)

  // Enrich flats with their project's metadata once so every accessor
  // can read off a single flat row.
  const projectById = useMemo(() => {
    const m = {};
    for (const p of projects || []) m[p.id] = p;
    return m;
  }, [projects]);

  // Preview flats for free/anon tier — useFlatsArchive is RLS-gated to the
  // user's one chosen project (or nothing for anon), which makes the
  // pivot collapse to a single row. Since the Gated wrapper blurs all
  // numbers anyway, we synthesize a small set of plausible rows per
  // project from projects-table metadata so the pivot shows every
  // project name + district + developer with varied room types and
  // prices. This is presentational preview only — paid users get the
  // real flats query.
  const previewFlats = useMemo(() => {
    if (canViewAnalytics) return null;
    if (!projects?.length) return [];
    const out = [];
    // Deterministic pseudo-random from project id + index so re-renders
    // don't reshuffle and the preview stays stable. Math.random is
    // intentionally NOT used.
    const hash = (s, n) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return Math.abs(h + n * 2654435761) >>> 0;
    };
    const ROOM_DIST = [[1, 0.25], [2, 0.35], [3, 0.25], [4, 0.15]];
    // A few synthetic scrape points (spanning ~2 months) so the TIME dimensions
    // (Datum / Mesiac / Batch presný čas) demo a believable trend in the free
    // preview instead of every unit collapsing into one "(prázdne)" bucket. Derived
    // from "now" so the demo never shows stale dates; computed once per memo (stable).
    const _now = new Date();
    const SYNTH_DAYS = [0, 13, 34, 61].map((d) => {
      const iso = new Date(_now.getTime() - d * 86400000).toISOString();
      return { ts: iso.slice(0, 19) + "+00:00", month: iso.slice(0, 7) };
    });
    // Synthesize previews only for active projects — preview should
    // reflect what paid users would see in the real Pivot, which is
    // active-only. Manual projects (status='active') stay in.
    const activeProjects = projects.filter(p => (p.status || "active") === "active");
    for (const p of activeProjects) {
      const total = Math.min(20, Math.max(3, p.total_units || 10));
      const availShare = p.total_units > 0 ? (p.available_units || 0) / p.total_units : 0.4;
      const soldShare  = p.total_units > 0 ? (p.sold_units     || 0) / p.total_units : 0.5;
      for (let i = 0; i < total; i++) {
        const seed = hash(p.id || p.name || "x", i);
        const r = (seed & 0xffff) / 0xffff;
        let izby = 2;
        let acc = 0;
        for (const [rooms, share] of ROOM_DIST) { acc += share; if (r < acc) { izby = rooms; break; } }
        const floor  = 1 + ((seed >> 16) & 0xf);
        const m2     = [34, 52, 74, 96, 120][Math.min(4, izby - 1)] + ((seed >> 4) % 11);
        const priceM2 = p.avg_price_eur_m2 || 4500;
        const price  = Math.round(priceM2 * m2);
        const shareAvailCum = availShare;
        const shareAvailPlusResv = availShare + Math.max(0, 1 - availShare - soldShare);
        const stav = r < shareAvailCum ? "V" : r < shareAvailPlusResv ? "R" : "P";
        // `seed` is an unsigned 32-bit int (… >>> 0); use it directly so the index is
        // always 0..len-1. (A signed `seed >> 8` can be NEGATIVE for hashes ≥ 2^31 →
        // SYNTH_DAYS[neg] = undefined → crash. Caught in free-tier live test.)
        const day = SYNTH_DAYS[seed % SYNTH_DAYS.length];
        out.push({
          id: `preview-${p.id}-${i}`,
          project_id: p.id,
          unit_id: `preview-${i}`,
          batch_timestamp: day.ts,
          snapshot_month: day.month,
          unit_detail: null,
          typ: "byt",
          etapa: null,
          budova: String.fromCharCode(65 + ((seed >> 20) & 0x3)),
          poschodie: floor,
          izby,
          obytna_plocha: m2,
          balkon_plocha: null, loggia_plocha: null, terasa_plocha: null,
          zahrada_plocha: null, exterier_plocha: null, kobka_plocha: null,
          celkova_plocha: m2 + 5,
          cena_s_dph: price,
          cena_s_dph_text: null,
          orientacia: null, kolaudacia: null,
          stav,
        });
      }
    }
    return out;
  }, [canViewAnalytics, projects]);

  // Source-of-truth: real flats for paid/admin, synthetic for free/anon.
  const flats = canViewAnalytics ? realFlats : previewFlats;

  const records = useMemo(() => {
    if (!flats?.length) return [];
    return flats.map((f) => {
      const p = projectById[f.project_id];
      return {
        ...f,
        // Real flats carry country (flats_current/archive.country); synthetic
        // preview rows don't, so fall back to the project's country so the
        // Krajina dimension is populated on the free-tier demo too.
        country:           f.country ?? p?.country ?? null,
        // Mesto — same shape as country, and for the same reason. flats_archive
        // carries `city`, flats_current does NOT, and synthetic preview rows
        // carry neither, so without the project fallback the Mesto dimension
        // collapsed to "(prázdne)" for EVERY row in the default current view.
        // (Only the drill-down enrichment had it; this one was missed.)
        city:              f.city ?? p?.city ?? null,
        project_name:      p?.name || f.project_id,
        project_status:    p?.status || "active",
        developer:         p?.developer || null,
        district:          p?.district || null,
        sub_district:      p?.sub_district || null,
      };
    });
  }, [flats, projectById]);

  // ── State ─────────────────────────────────────────────────────
  // NOTE: the pivot no longer auto-seeds a Datum filter. It opens in the
  // "current" view (no time scope → each project's latest snapshot, cross-market
  // correct). The user adds a Datum/Mesiac filter to time-travel into the archive.
  const [search,  setSearch]  = useState("");
  const [drag,    setDrag]    = useState(null);
  const [hoverZone, setHoverZone] = useState(null);
  // Slot the drop caret is currently sitting in, inside `hoverZone`. Null while
  // the pointer is over a zone's chrome rather than its chip row (= append).
  const [dropIndex, setDropIndex] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  // Sort state: { col: "label" | "count" | valueIdx (0..n-1), dir: "asc"|"desc" }
  const [sort, setSort] = useState(persisted?.sort ?? DEFAULT_SORT);
  // Which filter chip's popover is currently open (null = none).
  // { key, anchorEl } — anchor used to position the popover next to the chip.
  const [filterPopup, setFilterPopup] = useState(null);

  // Display / analysis options.
  //  valueMode: "raw" | "pct_total" | "pct_parent"
  //  dataBars:  inline horizontal bar per leaf cell
  // (heatmap + chart toggles were removed — heatmap added noise, chart
  //  users can build themselves by copying the CSV into Excel.)
  const [valueMode, setValueMode] = useState(persisted?.valueMode ?? DEFAULT_VALUE_MODE);
  const [dataBars,  setDataBars]  = useState(persisted?.dataBars ?? DEFAULT_DATA_BARS);

  // Apply a whole saved bundle onto the live pivot state.
  const applyPrefs = (p) => {
    const b = normalizeBundle(p);
    setRows(b.rows); setCols(b.cols); setValues(b.values); setFilters(b.filters);
    setValueMode(b.valueMode); setDataBars(b.dataBars); setSort(b.sort);
  };

  // ── Per-ACCOUNT persistence (the setup sticks to the ACCOUNT, not the browser) ──
  // The saved setup is one snapshot under the account, handled by the same hook every
  // other settings page uses — so the pivot cannot drift from them, and the store in
  // accountPrefs.js keeps the user's latest choice authoritative for the whole session
  // (a remount can no longer re-apply a page-load snapshot over it).
  //
  // A persisted blob is UNTRUSTED input — localStorage is user-writable and pivot_prefs
  // round-trips through the DB — so it is sanitised against the current FIELDS registry
  // on the way in; a stale or malformed key can never wedge the pivot.
  const pivotBundle = useMemo(
    () => normalizeBundle({ rows, cols, values, filters, valueMode, dataBars, sort }),
    [rows, cols, values, filters, valueMode, dataBars, sort]
  );
  useAccountPrefState(PIVOT_PREF_KEY, pivotBundle, (saved) => applyPrefs(sanitizePivotState(saved) || DEFAULT_BUNDLE));

  useEffect(() => { purgeLegacyPivotState(); }, []);   // drop the pre-fix shared key once

  // "Predvolené" → restore the opening layout. "Vyčistiť" → wipe rows/cols/values/
  // filters to a clean slate (no field-by-field removal). Both persist via the effect.
  const resetToDefault = () => {
    setRows(DEFAULT_ROWS); setCols(DEFAULT_COLS); setValues(DEFAULT_VALUES); setFilters(DEFAULT_FILTERS);
    setValueMode(DEFAULT_VALUE_MODE); setDataBars(DEFAULT_DATA_BARS); setSort(DEFAULT_SORT);
    setCollapsed(new Set()); setSearch("");
  };
  const clearAll = () => {
    setRows([]); setCols([]); setValues([]); setFilters([]);
    setCollapsed(new Set()); setSearch("");
  };

  // Drill-down modal: clicked cell → shows underlying records
  const [drillDown, setDrillDown] = useState(null);

  // Palette "used" greying: a field is "in use" only when it's in Rows,
  // Cols or Values. Being in Filters doesn't count — because Filters
  // coexist with any of those (user might want cena in Values AND in
  // Filters to exclude outliers).
  const usedKeys = useMemo(() => new Set([
    ...rows,
    ...cols,
    ...values.map(v => v.key),
  ]), [rows, cols, values]);

  // ── Actions ───────────────────────────────────────────────────
  /* `atIndex` is the slot the drop caret was sitting in (null = append). A field
     already IN the target zone is a RE-ORDER, not a duplicate drop — that is
     what makes dragging a chip sideways change the order instead of doing
     nothing (which is what it used to do: the user had to delete the chip and
     re-add it in the order they wanted). */
  const addToZone = (fieldKey, zone, atIndex = null) => {
    // Rows ↔ Values are mutually exclusive (same field can't be a
    // group-by AND a measure at the same time — that's not a pivot,
    // it's a tautology). But Filters can COEXIST with either:
    // e.g. `cena_s_dph` in Values with agg=avg, AND in Filters between
    // 100k-500k to exclude outliers. User explicitly asked for this.
    const fld = FIELDS[fieldKey];
    // Measures are Values-only — calculated at group level, can't group-by.
    if (fld && fld.type === "measure" && zone !== "values" && zone !== "palette") {
      zone = "values";
    }
    if (zone === "rows") {
      // Rows ⇄ Cols ⇄ Values are mutually exclusive — same field can't
      // group a row AND a column AND be aggregated.
      setValues(v => v.filter(x => x.key !== fieldKey));
      setCols(c => c.filter(k => k !== fieldKey));
      setRows(r => {
        if (r.includes(fieldKey)) return moveToIndex(r, keyOfString, fieldKey, atIndex ?? r.length);
        if (r.length >= MAX_ROWS) return r;
        return insertAt(r, fieldKey, atIndex);
      });
    } else if (zone === "cols") {
      // Cross-tab axis: drop mutually exclusive with rows/values.
      // Measures can't be col-headers.
      if (fld && fld.type === "measure") return;
      setRows(r => r.filter(k => k !== fieldKey));
      setValues(v => v.filter(x => x.key !== fieldKey));
      setCols(c => {
        if (c.includes(fieldKey)) return moveToIndex(c, keyOfString, fieldKey, atIndex ?? c.length);
        if (c.length >= MAX_COLS) return [fieldKey]; // replace existing (cap=1)
        return insertAt(c, fieldKey, atIndex);
      });
    } else if (zone === "values") {
      setRows(r => r.filter(k => k !== fieldKey));
      setCols(c => c.filter(k => k !== fieldKey));
      setValues(v => {
        if (v.find(x => x.key === fieldKey)) return moveToIndex(v, keyOfObject, fieldKey, atIndex ?? v.length);
        if (v.length >= MAX_VALUES) return v;
        const fld = FIELDS[fieldKey];
        return insertAt(v, { key: fieldKey, field: fieldKey, agg: defaultAggFor(fld) }, atIndex);
      });
    } else if (zone === "filters") {
      // Filters coexist with Rows / Cols / Values — no mutual-exclusion.
      setFilters(f => {
        if (f.find(x => x.key === fieldKey)) return moveToIndex(f, keyOfObject, fieldKey, atIndex ?? f.length);
        return insertAt(f, { key: fieldKey }, atIndex);
      });
    } else if (zone === "palette") {
      // Drag back to palette = full remove from wherever it was.
      setRows(r => r.filter(k => k !== fieldKey));
      setCols(c => c.filter(k => k !== fieldKey));
      setValues(v => v.filter(x => x.key !== fieldKey));
      setFilters(f => f.filter(x => x.key !== fieldKey));
    }
  };

  const removeFromZone = (zone, fieldKey) => {
    if (zone === "rows")    setRows(r => r.filter(k => k !== fieldKey));
    if (zone === "cols")    setCols(c => c.filter(k => k !== fieldKey));
    if (zone === "values")  setValues(v => v.filter(x => x.key !== fieldKey));
    if (zone === "filters") setFilters(f => f.filter(x => x.key !== fieldKey));
  };

  const changeValueAgg = (fieldKey, newAgg) => {
    setValues(vs => vs.map(v => v.key === fieldKey ? { ...v, agg: newAgg } : v));
  };

  /* Patch a filter in-place by its `key`. `patch` is a partial object —
     passing `null` wipes the filter to "inactive" (pass-through). */
  const updateFilter = (fieldKey, patch) => {
    setFilters(fs => fs.map(f => {
      if (f.key !== fieldKey) return f;
      if (patch === null) return { key: fieldKey };   // reset to inactive
      return { ...f, ...patch };
    }));
  };

  const toggleCollapse = (pathKey) => {
    setCollapsed(s => {
      const n = new Set(s);
      if (n.has(pathKey)) n.delete(pathKey); else n.add(pathKey);
      return n;
    });
  };
  const expandAll   = () => setCollapsed(new Set());
  const collapseAll = () => {
    // Collapse every non-leaf pathKey
    const collect = (nodes, out) => {
      for (const n of nodes) {
        if (n.children?.length) { out.add(n.pathKey); collect(n.children, out); }
      }
      return out;
    };
    setCollapsed(collect(sortedTree.children, new Set()));
  };

  // ── Build tree ────────────────────────────────────────────────
  // Values default to a single implicit "count" when the user hasn't
  // dropped anything into Values yet — the user asked for count-first
  // behaviour so the pivot always shows something meaningful.
  //
  // Memoised so the literal `[{ ... }]` fallback doesn't get a new array
  // identity on every render, which would invalidate every downstream
  // useMemo (rawTree, sortedTree, flatRows) and trigger a full pivot
  // rebuild on every keystroke / hover / drag — the user reported the
  // pivot "felt sticky" while interacting with unrelated UI.
  const effectiveValues = useMemo(
    () => values.length > 0
      ? values
      : [{ key: "__count__", field: null, agg: "count" }],
    [values]
  );

  // Apply filters BEFORE tree build. Inactive filters (chip dropped but not
  // yet configured) pass everything through — see isFilterActive.
  const filteredRecords = useMemo(
    () => records.filter(r => filters.every(f => passesFilter(r, f))),
    [records, filters]
  );

  // ── Server-side aggregation gate (forever perf fix) ───────────────
  // configServerable = the current config can be answered by pivot_grain
  // (whitelisted dims, decomposable aggs, time-only filters). When true the
  // table renders from the grain — no 152k-row archive pull. forceRaw is
  // independent: it pulls records for a drill-down (table stays on the grain)
  // or to back a non-server-able config (median / ad-hoc filter / rare field).
  const configServerable = useMemo(
    () => canViewAnalytics && isServerable(rows, cols, effectiveValues, filters),
    [canViewAnalytics, rows, cols, effectiveValues, filters]
  );
  const gDims = useMemo(() => [...rows, ...cols], [rows, cols]);
  // Full server-side spec — ALL active filters (any dim, any mode) go to the engine,
  // so a city/developer/price filter is instant instead of pulling the archive.
  // (`isCurrent` already accounts for a time group-by — see its definition — so a
  // Datum/Mesiac dimension in Rows correctly switches the engine into archive mode.)
  const pivotSpec = useMemo(
    () => buildPivotSpec({ dims: gDims, filters, country, isCurrent }),
    [gDims, filters, country, isCurrent]
  );
  const { grain, loading: grainLoading, error: grainError } = usePivotGrain({ enabled: configServerable, spec: pivotSpec });
  // A non-server-able config needs records — pull them (sticky once needed).
  useEffect(() => {
    if (canViewAnalytics && !configServerable && !forceRaw) setForceRaw(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [canViewAnalytics, configServerable, forceRaw]);

  // Opening a filter popover may need raw records — the value-checkbox list is
  // derived from `records`. In server-side mode records aren't loaded, so a
  // freshly-added (inactive) filter chip could never be configured: isServerable
  // ignores inactive filters → config stays server-able → forceRaw never flips →
  // records stay empty → the list stays empty → deadlock.
  // EXCEPT server-able CATEGORICAL fields, which now get their values from the grain
  // (one fast RPC, see usePivotDistinct below) — no records pull. And datum /
  // snapshot_month synthesize options from the light archive lists. So pull records
  // only for the rest (numeric ranges / non-server-able fields), which truly need them.
  useEffect(() => {
    if (!canViewAnalytics || forceRaw || !filterPopup) return;
    if (filterPopup.key === "datum" || filterPopup.key === "snapshot_month") return;
    if (fieldUsesGrainValues(filterPopup.key)) return;   // grain serves its values
    if (fieldUsesStatsRpc(filterPopup.key)) return;       // stats RPC serves its bounds
    setForceRaw(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [canViewAnalytics, forceRaw, filterPopup]);

  // Server-side distinct values for the OPEN filter popover, when the field is a
  // server-able categorical dim — one pivot_grain(p_dims=[field]) call instead of a
  // ~30k-row pull. Scope mirrors the table (month/date); narrowed by the stav filter
  // for OTHER fields, but a field's own value list is never narrowed by itself.
  const popupField = filterPopup?.key || null;
  const popupUsesGrain = !!popupField && fieldUsesGrainValues(popupField);
  const { values: popupGrainValues, hasEmpty: popupGrainHasEmpty, loading: popupGrainLoading } = usePivotDistinct({
    enabled: canViewAnalytics && popupUsesGrain,
    field: popupField,
    months: fetchMonths,
    dates: fetchDates,
    stav: popupField === "stav" ? null : fetchStav,
  });

  // Server-side min/max/median/count for a continuous-numeric range filter popover —
  // one report_field_stats RPC on the NATIVE column instead of a ~30k-row pull.
  const popupUsesStats = !!popupField && fieldUsesStatsRpc(popupField);
  const { stats: popupFieldStats, loading: popupStatsLoading } = usePivotFieldStats({
    enabled: canViewAnalytics && popupUsesStats,
    field: popupField,
    months: fetchMonths,
    dates: fetchDates,
    stav: fetchStav,
  });

  // Render from the grain whenever the config is server-able — the table stays
  // instant. forceRaw loads records in the background to back a drill-down modal
  // (table unchanged) or a non-server-able config (where useGrain is false anyway).
  const useGrain = configServerable;
  const rawTree = useMemo(
    () => useGrain
      ? buildTreeFromGrain(grain, rows, cols, effectiveValues)
      : buildTree(filteredRecords, rows, cols, effectiveValues),
    [useGrain, grain, filteredRecords, rows, cols, effectiveValues]
  );

  // Header unit count + loading skeleton, source-aware.
  const displayCount = useGrain ? (rawTree?.count || 0) : records.length;

  // Stav split for the header — so the unit count is never misread as "all on
  // the market". On-market = V (voľné) + PR (predrezervované) + R (rezervované);
  // sold = P (predané). Big projects (e.g. Slnečnice) carry thousands of sold
  // units from the developer feed — intentional (that's the sell-through data),
  // but it dominates the raw count. Source-aware: grain components when
  // server-aggregated, else the filtered record set.
  const stavSplit = useMemo(() => {
    let offer = 0, sold = 0;
    if (useGrain) {
      // grain rows are { d: [dimVals], m: {components} } — components are under .m
      for (const g of (grain || [])) { const m = g.m || {}; offer += (+m.avail || 0) + (+m.res || 0) + (+m.prer || 0); sold += (+m.sold || 0); }
    } else {
      for (const r of filteredRecords) {
        const s = (r.stav || "").trim().toUpperCase();
        if (s === "P") sold++;
        else if (s === "V" || s === "R" || s === "PR") offer++;
      }
    }
    return { offer, sold };
  }, [useGrain, grain, filteredRecords]);
  const isInitialLoading = canViewAnalytics && (
    useGrain
      ? (grainLoading && (grain == null || grain.length === 0))
      : ((forceRaw || !configServerable) && loadingFlats && (realFlats?.length || 0) === 0)
  );
  // The server pivot (analytics_pivot RPC) can fail (cold statement_timeout, RLS,
  // bad spec). Without this the empty grain rendered as a benign "0 units" — a
  // silent failure indistinguishable from "filters matched nothing". Surface it.
  const grainErrored = useGrain && !!grainError && !grainLoading && (grain == null || grain.length === 0);

  // Records for the open drill-down. In grain mode the clicked node carries no
  // records, so resolve them from filteredRecords by matching the row-dim path
  // (records arrive via the forceRaw pull the drill-down click triggers).
  const drillRecords = useMemo(() => {
    if (!drillDown) return [];
    // Targeted-fetch / record-mode result lives on drillDown.records (an array,
    // possibly empty = "no records"). null = the rare flat-only fallback that
    // pulls all flats and filters here.
    if (drillDown.records != null) return drillDown.records;
    const path = drillDown.pathKey ? drillDown.pathKey.split(SEP) : [];
    if (!path.length) return filteredRecords;
    return filteredRecords.filter(r => path.every((pv, i) => {
      const f = FIELDS[rows[i]];
      return f && normKey(f.accessor(r)) === pv;
    }));
  }, [drillDown, filteredRecords, rows]);
  const drillLoading = !!drillDown && (
    drillDown.loading === true ||
    (drillDown.records == null && configServerable && forceRaw && loadingFlats && drillRecords.length === 0)
  );

  const sortedTree = useMemo(() => ({
    ...rawTree,
    children: sortTree(rawTree.children, sort.col, sort.dir),
  }), [rawTree, sort.col, sort.dir]);

  const flatRows = useMemo(
    () => flattenTree(sortedTree.children, collapsed),
    [sortedTree, collapsed]
  );

  // ── UI ─────────────────────────────────────────────────────────
  // Chart-click → scroll-and-flash glue. The chart panel below the
  // table calls onChartSelect(pathKey, colKey?) when a bar / segment /
  // dot / slice / cell is clicked. We find the matching <tr data-pathkey>
  // (and the cross-tab <td data-colkey> when applicable), scroll it into
  // the middle of the viewport, and apply a 1.6s pulse so the user sees
  // exactly which row in the table corresponds to the chart element they
  // just clicked. setTimeout(0) lets React commit any pending state
  // updates (collapse expansion, sort change) before we measure the DOM.
  const handleChartSelect = (pathKey, colKey) => {
    if (!pathKey) return;
    setTimeout(() => {
      const safePath = (window.CSS && window.CSS.escape)
        ? window.CSS.escape(String(pathKey))
        : String(pathKey).replace(/(["\\])/g, "\\$1");
      const rowEl = document.querySelector(`[data-pathkey="${safePath}"]`);
      if (!rowEl) return;
      rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
      rowEl.classList.remove("pivot-flash");
      // Force reflow so re-adding the class restarts the animation even if
      // user clicks the same chart element twice in a row.
      void rowEl.offsetWidth;
      rowEl.classList.add("pivot-flash");
      setTimeout(() => rowEl.classList.remove("pivot-flash"), 1700);

      if (colKey != null) {
        const safeCol = (window.CSS && window.CSS.escape)
          ? window.CSS.escape(String(colKey))
          : String(colKey).replace(/(["\\])/g, "\\$1");
        const cellEl = rowEl.querySelector(`[data-colkey="${safeCol}"]`);
        if (cellEl) {
          cellEl.classList.remove("pivot-cell-flash");
          void cellEl.offsetWidth;
          cellEl.classList.add("pivot-cell-flash");
          setTimeout(() => cellEl.classList.remove("pivot-cell-flash"), 1700);
        }
      }
    }, 0);
  };

  return (
    <div style={{
      background: `linear-gradient(135deg, var(--surface-2) 0%, var(--bg) 100%)`,
      border: `1px solid color-mix(in srgb, var(--accent) 25%, transparent)`, borderRadius: 12, padding: "1.25rem",
      boxShadow: "0 0 28px color-mix(in srgb, var(--accent) 5%, transparent)",
    }}>
      {/* Local stylesheet — keyframes for the chart-click flash. Scoped
          here (not in the global App.jsx <style>) because nothing else in
          the app needs it; inline keeps it co-located with the component
          that triggers the animation. */}
      <style>{`
        @keyframes pivotFlash {
          0%   { background-color: color-mix(in srgb, var(--accent) 0%, transparent); box-shadow: inset 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); }
          15%  { background-color: color-mix(in srgb, var(--accent) 32%, transparent); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 65%, transparent); }
          100% { background-color: color-mix(in srgb, var(--accent) 0%, transparent); box-shadow: inset 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); }
        }
        .pivot-flash > td { animation: pivotFlash 1.6s ease-out; }
        @keyframes pivotCellFlash {
          0%   { box-shadow: inset 0 0 0 0 ${green}, 0 0 0 ${green}; outline-color: color-mix(in srgb, var(--accent) 0%, transparent); }
          15%  { box-shadow: inset 0 0 0 2px ${green}, 0 0 12px color-mix(in srgb, var(--accent) 55%, transparent); outline-color: ${green}; }
          100% { box-shadow: inset 0 0 0 0 ${green}, 0 0 0 ${green}; outline-color: color-mix(in srgb, var(--accent) 0%, transparent); }
        }
        .pivot-cell-flash {
          animation: pivotCellFlash 1.6s ease-out;
          outline: 2px solid transparent;
          outline-offset: -2px;
        }
        /* Chart-element hover affordance — works for bars, segments, dots,
           slices, and heatmap cells. Cursor + opacity bump tell the user
           the surface is interactive. */
        .pivot-chart-target { cursor: pointer; transition: opacity 0.12s, filter 0.12s; }
        .pivot-chart-target:hover { opacity: 1 !important; filter: brightness(1.18); }
        @keyframes pivotPulse {
          0%, 100% { opacity: 0.45; }
          50%      { opacity: 0.85; }
        }
        .pivot-loading-pulse { animation: pivotPulse 1.6s ease-in-out infinite; }
        /* Pivot-table row affordance (2026-06-12): the WHOLE row is the click
           target (open project / toggle group) — best-in-class standard
           (Linear/Stripe/Notion). The row glows on hover (JS sets the bg) and
           cursor:pointer + the project name underlines so it's obviously
           interactive; the count cell keeps its own drill-down (it
           stopPropagation's). Keyboard focus ring on the name. */
        .pivot-row-int { cursor: pointer; }
        .pivot-row-int:hover .pivot-label-text {
          text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 3px;
        }
        .pivot-label-text:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 3px; }
        /* A field chip is grabbable anywhere on its body — cursor:grab says so,
           and that is the whole affordance. It briefly carried a braille-dots grip
           as well; once the body became the handle those dots were decoration on
           top of a cue that already worked, so they are gone (Boss 2026-08-24).
           No pivot builder worth copying draws them. */
        .pivotv2-chip:active { cursor: grabbing; }
        .pivotv2-chip:focus-visible {
          outline: 2px solid var(--accent); outline-offset: 2px;
        }
        /* The pivot's own horizontal scrollbar — visible enough to be found,
           quiet enough not to compete with the data. */
        .pivot-scroll { --pv-label-w: 300px; --pv-count-w: 96px; scrollbar-width: thin; }
        .pivot-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .pivot-scroll::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--text) 22%, transparent);
          border-radius: 6px;
        }
        .pivot-scroll::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--text) 34%, transparent); }
        /* On a phone a 300px frozen column would eat the whole viewport, so it
           shrinks instead of being switched off — the row keeps its name, which is
           the entire point of freezing it. */
        @media (max-width: 820px) {
          .pivot-scroll { --pv-label-w: 200px; --pv-count-w: 80px; }
        }
        @media (max-width: 560px) {
          .pivot-scroll { --pv-label-w: 130px; --pv-count-w: 56px; }
        }
      `}</style>

      {/* Initial-load skeleton — shown ONLY while real flats are still
          paginating in. Without this, the pivot would render an empty
          table + "0 bytov" header for ~5 seconds before suddenly
          populating, which looked broken. We swap it out the moment
          records become non-empty. */}
      {isInitialLoading && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "5rem 1.25rem", gap: "1.1rem", minHeight: 320,
        }}>
          <div className="pivot-loading-pulse" style={{
            fontFamily: mono, fontSize: "0.95rem", color: text,
            letterSpacing: "0.04em",
          }}>
            {lang === "sk" ? "Načítavam analytiku…" : "Loading analytics…"}
          </div>
          <div style={{ fontFamily: mono, fontSize: "0.78rem", color: dim }}>
            {flatsProgress > 0
              ? `${flatsProgress.toLocaleString(localeTag(lang))} ${lang === "sk" ? "záznamov" : "records"}`
              : (lang === "sk" ? "pripravujem" : "preparing")}
          </div>
          {/* Skeleton rows */}
          <div style={{ width: "100%", maxWidth: 720, marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="pivot-loading-pulse" style={{
                height: 18,
                // `${border}80` appended a hex-alpha to a var() → invalid gradient →
                // the skeleton had no background at all. color-mix keeps the token.
                background: `linear-gradient(90deg, ${border} 0%, color-mix(in srgb, ${border} 50%, transparent) 50%, ${border} 100%)`,
                borderRadius: 4,
                width: `${100 - i * 8}%`,
                animationDelay: `${i * 0.12}s`,
              }}/>
            ))}
          </div>
        </div>
      )}

      {/* Load error (server pivot RPC failed) — a DISTINCT state, never the
          "0 units" empty, so a failure can't masquerade as no-data. */}
      {!isInitialLoading && grainErrored && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "4rem 1.25rem", gap: "0.9rem", minHeight: 280, textAlign: "center",
        }}>
          <div style={{ fontSize: "1.6rem" }}>⚠️</div>
          <div style={{ color: text, fontWeight: 600, fontSize: "0.95rem" }}>
            {lang === "sk" ? "Analytiku sa nepodarilo načítať" : "Couldn't load analytics"}
          </div>
          <div style={{ color: dim, fontSize: "0.82rem", maxWidth: 420, lineHeight: 1.5 }}>
            {lang === "sk"
              ? "Toto nie je prázdny výsledok — požiadavka zlyhala. Skús to znova."
              : "This isn't an empty result — the request failed. Please try again."}
          </div>
          <button onClick={() => window.location.reload()} style={{
            marginTop: "0.3rem", background: green, color: "var(--bg)", border: "none",
            borderRadius: 8, padding: "0.55rem 1.1rem", fontFamily: mono, fontSize: "0.8rem",
            fontWeight: 700, cursor: "pointer",
          }}>
            {lang === "sk" ? "Skúsiť znova" : "Try again"}
          </button>
        </div>
      )}

      {/* Header — record count + expand/collapse. Mesiac scope is part
          of the standard Filters zone (drag the field there, pick months
          from the popup) — no special top-bar selector. */}
      {!isInitialLoading && !grainErrored && (<>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.78rem", color: dim }}>
          {displayCount.toLocaleString("en-US").replace(/,/g, " ")} {lang === "sk" ? "bytov" : "units"}
          {(stavSplit.offer > 0 || stavSplit.sold > 0) && (
            <span style={{ marginLeft: "0.5rem" }}>
              · <strong style={{ color: "var(--accent)" }}>{stavSplit.offer.toLocaleString("en-US").replace(/,/g, " ")}</strong> {lang === "sk" ? "v ponuke" : "on offer"}
              {" · "}<strong style={{ color: "var(--text-dim)" }}>{stavSplit.sold.toLocaleString("en-US").replace(/,/g, " ")}</strong>{" "}
              <span title={lang === "sk"
                ? "Byty, ktoré developer v cenníku označuje ako Predané. Developeri, čo predaný byt z cenníka zmažú, tu nie sú — skutočné predaje sú v Analytika → Predaje."
                : "Flats a developer currently labels sold on their price list. Developers who delete a sold flat are not here — actual sales are in Analytics → Sales."}>
                {lang === "sk" ? "predaných (v cenníku)" : "sold (on the price list)"}
              </span>
            </span>
          )}
          {!configServerable && filteredRecords.length !== records.length && (
            <span style={{ marginLeft: "0.5rem", color: dim }}>
              ({filteredRecords.length.toLocaleString("en-US").replace(/,/g, " ")} {lang === "sk" ? "po filtroch" : "after filters"})
            </span>
          )}
        </span>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* Always-available layout controls. "Predvolené" restores the opening
              setup; "Vyčistiť" wipes everything to a clean slate in one click —
              no removing fields one by one. The whole setup auto-persists, so it's
              still here after visiting Reports etc. and coming back. */}
          <button
            onClick={resetToDefault}
            style={miniBtn}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = green; e.currentTarget.style.color = green; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = dim; }}
            title={lang === "sk" ? "Obnoviť predvolené rozloženie" : "Restore the default layout"}
          >↺ {lang === "sk" ? "Predvolené" : "Default"}</button>
          <button
            onClick={clearAll}
            style={miniBtn}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#ff6b6b"; e.currentTarget.style.color = "#ff6b6b"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = dim; }}
            title={lang === "sk" ? "Vymazať všetky filtre aj rozloženie" : "Clear all filters and layout"}
          >✕ {lang === "sk" ? "Vyčistiť" : "Clear"}</button>
          {rows.length >= 2 && (<>
            <span style={{ width: 1, alignSelf: "stretch", background: border, margin: "0.1rem 0.2rem" }} />
            <button onClick={expandAll}   style={miniBtn}>▾ {lang === "sk" ? "Rozbaliť" : "Expand"}</button>
            <button onClick={collapseAll} style={miniBtn}>▸ {lang === "sk" ? "Zbaliť" : "Collapse"}</button>
          </>)}
        </div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 280px", gap: "1rem",
        marginBottom: "1rem",
      }} className="pivotv2-grid">
        <LeftPanel
          rows={rows} cols={cols} values={values} filters={filters}
          drag={drag} setDrag={setDrag}
          hoverZone={hoverZone} setHoverZone={setHoverZone}
          dropIndex={dropIndex} setDropIndex={setDropIndex}
          onDropToZone={(zone, atIndex) => {
            if (!drag) return;
            addToZone(drag.fieldKey, zone, atIndex);
            setDrag(null); setHoverZone(null); setDropIndex(null);
          }}
          onReorder={(zone, fieldKey, toIndex) => addToZone(fieldKey, zone, toIndex)}
          removeFromZone={removeFromZone}
          changeValueAgg={changeValueAgg}
          openFilter={(key, anchorEl) => setFilterPopup({ key, anchorEl })}
          lang={lang}
        />
        <RightPanel
          usedKeys={usedKeys}
          search={search} setSearch={setSearch}
          drag={drag} setDrag={setDrag}
          hoverZone={hoverZone} setHoverZone={setHoverZone}
          onDropBack={() => {
            if (drag && drag.fromZone !== "palette") addToZone(drag.fieldKey, "palette");
            setDrag(null); setHoverZone(null); setDropIndex(null);
          }}
          lang={lang}
        />
      </div>

      {/* Analysis toolbar: value-mode + data bars toggle + CSV export */}
      {rows.length > 0 && (
        <AnalysisToolbar
          valueMode={valueMode} setValueMode={setValueMode}
          dataBars={dataBars}   setDataBars={setDataBars}
          onExportCSV={() => exportPivotCSV(flatRows, sortedTree, rows, cols, effectiveValues, valueMode, lang)}
          onCopyTable={() => copyPivotTable(flatRows, sortedTree, rows, cols, effectiveValues, valueMode, lang)}
          effectiveValues={effectiveValues}
          lang={lang}
        />
      )}

      <ResultTable
        rowFields={rows}
        colFields={cols}
        effectiveValues={effectiveValues}
        flatRows={flatRows}
        collapsed={collapsed}
        onToggle={toggleCollapse}
        sort={sort} setSort={setSort}
        grandTotal={sortedTree}
        valueMode={valueMode}
        dataBars={dataBars}
        onDrillDown={async (node) => {
          const title = node.path.length ? node.path.join(" › ") : (lang === "sk" ? "Všetky záznamy" : "All records");
          // Record-mode node already carries its records (non-serverable config).
          if (node.records && node.records.length) {
            setDrillDown({ title, pathKey: node.pathKey, records: node.records });
            return;
          }
          // Resolve the clicked group's project ids from its project-level path
          // conditions, so we fetch ONLY those projects' flats — instant, not the
          // whole dataset (project / district / developer drill-down).
          const path = node.path || [];
          let candIds = null;
          for (let i = 0; i < path.length; i++) {
            const attr = PROJECT_LEVEL_ATTR[rows[i]];
            if (!attr) continue;
            const m = projects.filter(p => normKey(p[attr]) === path[i]).map(p => p.id);
            candIds = candIds == null ? m : candIds.filter(id => m.includes(id));
          }
          // No project-level narrowing (rare flat-only grouping), or resolution
          // came up empty (projects still loading) → fall back to the full
          // client pull so it still works.
          if (candIds == null || candIds.length === 0) {
            if (configServerable) setForceRaw(true);
            setDrillDown({ title, pathKey: node.pathKey, records: null });
            return;
          }
          setDrillDown({ title, pathKey: node.pathKey, records: null, loading: true });
          const raw = await fetchFlatsForProjects(country, candIds, { isCurrent, months: fetchMonths });
          const enriched = raw.map((f) => {
            const p = projectById[f.project_id];
            return {
              ...f,
              project_name: p?.name || f.project_id,
              project_status: p?.status || "active",
              developer: p?.developer || null,
              district: p?.district || null,
              sub_district: p?.sub_district || null,
              city: p?.city || null,
            };
          });
          // Match the row-dim path AND re-apply the ACTIVE filters (stav, price
          // ranges, …). Without the filter pass the modal listed every unit of the
          // matched projects across all statuses — so the header count contradicted
          // the filtered cell number the user actually clicked.
          const filtered = enriched.filter((r) =>
            path.every((pv, i) => { const f = FIELDS[rows[i]]; return f && normKey(f.accessor(r)) === pv; })
            && filters.every((flt) => passesFilter(r, flt))
          );
          setDrillDown((d) => (d && d.pathKey === node.pathKey ? { ...d, records: filtered, loading: false } : d));
        }}
        onProjectOpen={setCurrent ? (projectId) => setCurrent(`App:ProjectDetail:${projectId}`) : undefined}
        lang={lang}
      />

      {/* Chart panel — derived from the same tree as the table.
          Always rendered (even with no rows) so the user can discover
          the feature; an empty-state inside the panel guides them to
          drag a field. Lives BELOW the table because the table is the
          primary surface; the chart is a supplementary "eyeball check"
          of the same numbers. Click any chart element → scroll the
          matching row into view + flash highlight via handleChartSelect. */}
      <PivotChart
        tree={sortedTree}
        rowFields={rows}
        colFields={cols}
        effectiveValues={effectiveValues}
        onSelect={handleChartSelect}
        lang={lang}
      />

      {/* Drill-down modal */}
      {drillDown && (
        <DrillDownModal
          title={drillDown.title}
          records={drillRecords}
          loading={drillLoading}
          onClose={() => { setDrillDown(null); }}
          lang={lang}
        />
      )}

      {/* Filter popover — floats over the rest of the UI, positioned next
          to the clicked filter chip. Uses `records` (pre-filtering) so
          distinct-value list is stable regardless of other filters; if
          we ever want contextual filtering (distinct values from the set
          filtered by OTHER filters), pass filteredRecords instead. */}
      {filterPopup && (() => {
        const current = filters.find(f => f.key === filterPopup.key);
        // FAST PATH — server-able categorical field: its distinct values come from
        // the grain (one pivot_grain(p_dims=[field]) RPC via usePivotDistinct), so we
        // skip BOTH the ~30k-row records pull and the contextual record-filtering.
        // This is the forever-fix for "opening a filter dragged the whole dataset".
        if (popupUsesGrain) {
          return (
            <FilterPopover
              fieldKey={filterPopup.key}
              filter={current}
              anchorEl={filterPopup.anchorEl}
              records={EMPTY_RECORDS}
              distinctOverride={{ values: popupGrainValues, hasEmpty: popupGrainHasEmpty }}
              loading={popupGrainLoading}
              fellBack={false}
              otherFilterCount={0}
              onChange={(patch) => updateFilter(filterPopup.key, patch)}
              onClear={() => updateFilter(filterPopup.key, null)}
              onClose={() => setFilterPopup(null)}
              lang={lang}
            />
          );
        }
        // FAST PATH — continuous-numeric field: its range bounds (min/max/median)
        // come from the report_field_stats RPC (NATIVE column, one call), so opening
        // the range popover doesn't pull ~30k rows. (Applying the filter still loads
        // records for the table — numeric ranges aren't server-able — but the popover
        // itself is instant.)
        if (popupUsesStats) {
          return (
            <FilterPopover
              fieldKey={filterPopup.key}
              filter={current}
              anchorEl={filterPopup.anchorEl}
              records={EMPTY_RECORDS}
              statsOverride={popupFieldStats}
              loading={popupStatsLoading}
              fellBack={false}
              otherFilterCount={0}
              onChange={(patch) => updateFilter(filterPopup.key, patch)}
              onClear={() => updateFilter(filterPopup.key, null)}
              onClose={() => setFilterPopup(null)}
              lang={lang}
            />
          );
        }
        // Contextual records first: filter by OTHER active filters so the
        // user sees options in the narrowed context (the "I just filtered
        // X, now X is gone" Excel footgun goes away).
        //
        // BUT — when other filters narrow to 0 rows (or to a set with no
        // distinct values for the chosen field), the popover would show
        // "Žiadne zhody" and the user can't do anything. Per QA report:
        // this is the bug behind "dam stav do filtra a vidím prázdny
        // zoznam". Fall back to the FULL records set in that case so the
        // user always has values to pick from. The popover surfaces a
        // small info row when the fallback kicks in so the user knows
        // why their other filters reduce to 0.
        const otherFilters = filters.filter(f => f.key !== filterPopup.key);
        // Grain mode has no records loaded. For the two TIME fields, synthesize
        // option rows from the light archive_days / archive_months sources so the
        // user can still pick a day / month. Other fields aren't server-able, so
        // dropping them into Filters flips forceRaw and real records arrive.
        let baseRecords = records;
        if (records.length === 0) {
          if (filterPopup.key === "datum") baseRecords = (archiveDays || []).map(d => ({ batch_timestamp: d }));
          else if (filterPopup.key === "snapshot_month") baseRecords = (archiveMonths || []).map(m => ({ snapshot_month: m }));
        }
        const contextual = baseRecords.filter(r => otherFilters.every(f => passesFilter(r, f)));
        // Cheap probe: do we get distinct values for THIS field from the
        // contextual set? distinctValuesForField is O(n); good for our
        // ~5–6k rows. Memoising would gain ~nothing here.
        const probe = distinctValuesForField(contextual, filterPopup.key);
        const hasContextualValues = probe.values.length > 0 || probe.hasEmpty;
        const passedRecords = hasContextualValues ? contextual : baseRecords;
        const fellBack = !hasContextualValues && contextual.length !== baseRecords.length;
        // Records still streaming in for a field that needs them (the popover-open
        // effect just flipped forceRaw) → show a "loading values" state instead of
        // a bare "no matches", so it never looks broken/empty.
        const needsRecords = filterPopup.key !== "datum" && filterPopup.key !== "snapshot_month";
        const loadingValues = needsRecords && records.length === 0;
        return (
          <FilterPopover
            fieldKey={filterPopup.key}
            filter={current}
            anchorEl={filterPopup.anchorEl}
            records={passedRecords}
            loading={loadingValues}
            fellBack={fellBack}
            otherFilterCount={otherFilters.filter(isFilterActive).length}
            onChange={(patch) => updateFilter(filterPopup.key, patch)}
            onClear={() => updateFilter(filterPopup.key, null)}
            onClose={() => setFilterPopup(null)}
            lang={lang}
          />
        );
      })()}

      {/* Active filters summary — calm strip, no shouting uppercase. */}
      {filters.some(isFilterActive) && (
        <div style={{
          marginTop: "0.75rem", padding: "0.5rem 0.75rem",
          background: "transparent", border: `1px dashed color-mix(in srgb, var(--accent) 25%, transparent)`,
          borderRadius: 6, display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap",
          fontSize: "0.75rem",
        }}>
          <span style={{ color: dim }}>
            Filtrovaných <strong style={{ color: text }}>{(configServerable ? displayCount : filteredRecords.length).toLocaleString("en-US").replace(/,/g, " ")}</strong>
            {" "}z {(configServerable ? displayCount : records.length).toLocaleString("en-US").replace(/,/g, " ")}
          </span>
          {filters.filter(isFilterActive).map(f => (
            <span key={f.key} style={{ color: text }}>
              <span style={{ color: dim }}>{fieldLabel(f.key, lang)}:</span> {summariseFilter(f, FIELDS[f.key]?.type, lang)}
            </span>
          ))}
          <button onClick={() => setFilters(fs => fs.map(f => ({ key: f.key })))}
            style={{ marginLeft: "auto", background: "transparent", border: "none", color: dim, cursor: "pointer", fontSize: "0.72rem", textDecoration: "underline" }}>
            vymazať
          </button>
        </div>
      )}

      <style>{`
        @media (max-width: 820px) {
          .pivotv2-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 540px) {
          .pivotv2-chip { font-size: 0.68rem !important; padding: 0.25rem 0.4rem !important; }
        }
      `}</style>
      </>)}
    </div>
  );
}

const miniBtn = {
  background: "transparent", border: `1px solid ${border}`,
  color: dim, borderRadius: 4, padding: "0.3rem 0.55rem",
  cursor: "pointer", fontSize: "0.68rem", fontFamily: mono,
  letterSpacing: "0.06em",
};

/* ─── LEFT PANEL ─────────────────────────────────────────────── */
function LeftPanel({ rows, cols, values, filters, drag, setDrag, hoverZone, setHoverZone, dropIndex, setDropIndex, onDropToZone, onReorder, removeFromZone, changeValueAgg, openFilter, lang }) {
  const shared = {
    drag, setDrag, hoverZone, setHoverZone, dropIndex, setDropIndex, lang,
    onDrop: onDropToZone, onReorder,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <DropZone
        {...shared}
        zoneKey="rows"
        title={lang === "sk" ? "Riadky" : "Rows"}
        hint={lang === "sk" ? "Potiahni pole sem — bude group-by os (hierarchia)." : "Drop a field here — becomes a group-by axis."}
        icon="↓"
        chips={rows.map(k => ({ key: k, label: fieldLabel(k, lang) || k, type: FIELDS[k]?.type }))}
        onRemove={(k) => removeFromZone("rows", k)}
      />
      <DropZone
        {...shared}
        zoneKey="cols"
        title={lang === "sk" ? "Stĺpce" : "Columns"}
        hint={lang === "sk"
          ? "Potiahni text-pole sem — každá hodnota dostane vlastný stĺpec (cross-tab, napr. Stav: V/P/R)."
          : "Drop a text field here — each value becomes its own column (cross-tab)."}
        icon="→"
        chips={cols.map(k => ({ key: k, label: fieldLabel(k, lang) || k, type: FIELDS[k]?.type }))}
        onRemove={(k) => removeFromZone("cols", k)}
      />
      <DropZone
        {...shared}
        zoneKey="values"
        title={lang === "sk" ? "Hodnoty" : "Values"}
        hint={lang === "sk" ? "Potiahni pole sem — bude sa agregovať (default: count; zmeň kliknutím na chip)." : "Drop a field here — aggregated (default: count; click the chip to change)."}
        icon="Σ"
        chips={values.map(v => ({ key: v.key, label: fieldLabel(v.key, lang) || v.key, type: FIELDS[v.key]?.type, agg: v.agg }))}
        onRemove={(k) => removeFromZone("values", k)}
        onChangeAgg={changeValueAgg}
      />
      <DropZone
        {...shared}
        zoneKey="filters"
        title={lang === "sk" ? "Filtre" : "Filters"}
        hint={lang === "sk"
          ? "Potiahni pole sem — vylúč / zahrň konkrétne hodnoty. Platí na celý pivot (pred agregáciou)."
          : "Drop a field here — include / exclude specific values. Applied before aggregation."}
        icon="⚑"
        chips={filters.map(f => ({
          key: f.key,
          label: fieldLabel(f.key, lang) || f.key,
          type: FIELDS[f.key]?.type,
          // Full filter object passed through so the chip can render its summary
          filter: f,
        }))}
        onRemove={(k) => removeFromZone("filters", k)}
        onChipClick={openFilter}
      />
    </div>
  );
}

/**
 * A drop zone, and — since 2026-08-24 — a re-orderable list.
 *
 * Order is meaning here: Rows is the hierarchy (L1 › L2 › L3), Values is the
 * left-to-right column order of the result table. Before this, changing it
 * meant removing a chip and adding it back in the order you wanted. Now the
 * pointer position picks a slot, a caret shows it, and the drop lands there.
 *
 * The slot arithmetic (and the drag-right off-by-one it hides) lives in
 * lib/zoneOrder.js with tests; this component only reports rectangles.
 */
function DropZone({ zoneKey, title, hint, icon, chips, drag, hoverZone, setHoverZone, dropIndex, setDropIndex, onDrop, onReorder, onRemove, onChangeAgg, onChipClick, lang }) {
  const isHover = hoverZone === zoneKey && drag;
  const isDragging = drag != null;
  const rowRef = useRef(null);

  /* Which slot is the pointer asking for? Measured from the live chip
     rectangles, so it is correct however the chips have wrapped. */
  const slotAt = (e) => {
    const host = rowRef.current;
    if (!host) return chips.length;
    const rects = Array.from(host.querySelectorAll("[data-chip]")).map(el => el.getBoundingClientRect());
    return dropIndexFor(rects, e.clientX, e.clientY);
  };

  const trackPointer = (e) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hoverZone !== zoneKey) setHoverZone(zoneKey);
    const slot = slotAt(e);
    if (slot !== dropIndex) setDropIndex(slot);
  };

  const caret = (i) => (
    isHover && dropIndex === i
      ? <span key={"caret" + i} aria-hidden style={{
          width: 2, alignSelf: "stretch", minHeight: 22, borderRadius: 1,
          background: green, boxShadow: `0 0 6px ${green}`,
        }} />
      : null
  );

  return (
    <div
      onDragOver={trackPointer}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && hoverZone === zoneKey) {
          setHoverZone(null); setDropIndex(null);
        }
      }}
      onDrop={(e) => { e.preventDefault(); onDrop(zoneKey, drag ? slotAt(e) : null); }}
      style={{
        background: isHover ? "color-mix(in srgb, var(--accent) 7%, transparent)" : panel,
        border: `1px dashed ${isHover ? green : (isDragging ? "#2c2c36" : border)}`,
        borderRadius: 8, padding: "0.75rem 0.9rem",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: chips.length ? "0.55rem" : "0.3rem" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 22, height: 22, borderRadius: 4,
          background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: accentInk,
          fontFamily: mono, fontSize: "0.76rem", fontWeight: 800,
        }}>{icon}</span>
        <span style={{ fontFamily: mono, fontSize: "0.8rem", color: text, fontWeight: 700, letterSpacing: "0.04em" }}>{title}</span>
        <span style={{ fontFamily: mono, fontSize: "0.66rem", color: dim }}>({chips.length})</span>
      </div>
      {chips.length === 0 ? (
        <div style={{ fontSize: "0.74rem", color: dim, fontStyle: "italic", lineHeight: 1.45 }}>{hint}</div>
      ) : (
        <div ref={rowRef} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.3rem" }}>
          {chips.map((c, idx) => (
            <Fragment key={c.key}>
              {caret(idx)}
              <ChipInZone
                label={c.label}
                type={c.type}
                agg={c.agg}
                filter={c.filter}
                level={zoneKey === "rows" ? idx : null}
                isDragged={drag?.fromZone === zoneKey && drag?.fieldKey === c.key}
                onDragStart={() => setHoverZone(null)}
                onDragStartPayload={() => ({ fromZone: zoneKey, fieldKey: c.key })}
                /* Keyboard equivalent of a one-slot drag. Goes through onReorder,
                   not onDrop, because there is no drag in flight to read from. */
                onNudge={(dir) => {
                  const slot = dir < 0 ? idx - 1 : idx + 2;
                  if (slot < 0 || slot > chips.length) return;   // already at the edge
                  onReorder(zoneKey, c.key, slot);
                }}
                onRemove={() => onRemove(c.key)}
                onChangeAgg={onChangeAgg ? (a) => onChangeAgg(c.key, a) : null}
                onClick={onChipClick ? (e) => onChipClick(c.key, e.currentTarget) : null}
                lang={lang}
              />
            </Fragment>
          ))}
          {caret(chips.length)}
        </div>
      )}
    </div>
  );
}

/* A chip inside a drop zone. In Values zone the chip carries an agg
   dropdown directly — click to cycle or pick from a menu.

   THE WHOLE CHIP IS THE HANDLE. Boss: "i want it fully modular — both
   inputting them but also taking and reordering them once they are already
   in." So you grab a chip anywhere on its body and move it: to another slot,
   to another zone, or back to the palette. cursor:grab is the whole affordance.

   That used to be impossible to combine with the chip's own click. Making a
   chip draggable puts the browser's dragstart-vs-click dance on top of it, and
   a filter chip's click (open its editor) was getting swallowed — reported
   twice — so dragging was switched off for filter chips altogether, which is
   why they could not be re-ordered at all.

   The fix is to stop relying on the native `click` event, which is the flaky
   half. A press is a CLICK when the pointer comes back up near where it went
   down and no drag ever started; anything else is a drag. Both readings come
   from pointer events we own, so neither can eat the other:

     pointerdown → remember where, and whether it landed on an inner control
     pointermove → past 3px this is a drag, not a press (below the browser's
                   own ~5px drag threshold, so it is always decided in time)
     dragstart   → refuse it outright when the press began on the × or the agg
                   button; those are buttons, not grips
     pointerup   → no drag + still within CLICK_SLOP of the start = a click

   Keyboard: the chip is focusable, ←/→ move it one slot, Enter/Space is the
   click. Reordering never needs a mouse. */
const CLICK_SLOP = 5;      // px — a press that travels further was a drag
const DRAG_SLOP  = 3;      // px — past this a press can become a drag

function ChipInZone({ label, type, agg, filter, level, isDragged, onDragStart, onDragStartPayload, onNudge, onRemove, onChangeAgg, onClick, lang }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // One dismissal behaviour for every layer in the app: an outside click or Esc
  // closes it. (This used to lean on the button's onBlur + a 150ms timeout,
  // which never fired when the click didn't move focus.)
  const chipRef = useDismiss(menuOpen, () => setMenuOpen(false));
  const pressRef = useRef(null);      // { x, y, onControl, moved } for the press in flight
  const draggedRef = useRef(false);
  const aggs = type === "measure" ? AGGS_MEASURE
             : type === "number" ? AGGS_NUMBER
             : AGGS_TEXT;

  // Filter chips get a summary badge based on their current config.
  // Idle (= just dropped, not configured yet) renders in dim/grey; active
  // filter gets the normal green chip color.
  const isFilterChip = filter !== undefined;
  const active = isFilterChip ? isFilterActive(filter) : true;
  const filterSummary = isFilterChip ? summariseFilter(filter, type, lang) : null;

  const nudge = (dir) => { if (onNudge) onNudge(dir); };

  return (
    <span
      ref={chipRef}
      data-chip
      className="pivotv2-chip"
      draggable
      tabIndex={0}
      role="button"
      aria-label={label}
      title={isFilterChip
        ? (active ? "Klikni pre úpravu filtra · ťahaj pre presun" : "Klikni pre nastavenie filtra · ťahaj pre presun")
        : (lang === "sk" ? "Ťahaj pre presun / zmenu poradia (alebo ←/→)" : "Drag to move or reorder (or ←/→)")}
      onPointerDown={(e) => {
        draggedRef.current = false;
        pressRef.current = {
          x: e.clientX, y: e.clientY, moved: false,
          // A press that starts on the × or the agg button is that button's,
          // never a drag of the chip around it.
          onControl: !!(e.target.closest && e.target.closest("[data-chip-control]")),
        };
      }}
      onPointerMove={(e) => {
        const p = pressRef.current;
        if (p && !p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_SLOP) p.moved = true;
      }}
      onPointerUp={(e) => {
        const p = pressRef.current;
        pressRef.current = null;
        if (!onClick || !p || p.onControl || draggedRef.current) return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) return;
        onClick(e);
      }}
      onPointerCancel={() => { pressRef.current = null; }}
      onDragStart={(e) => {
        const p = pressRef.current;
        if (p && p.onControl) { e.preventDefault(); return; }
        draggedRef.current = true;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", label);
        const payload = onDragStartPayload();
        if (onDragStart) onDragStart();
        window.__pivotv2_drag = payload;
        window.dispatchEvent(new CustomEvent("pivotv2-drag-start", { detail: payload }));
      }}
      onDragEnd={() => { pressRef.current = null; }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;         // let the inner buttons keep their keys
        if (e.key === "ArrowLeft")  { e.preventDefault(); nudge(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); nudge(1); }
        else if ((e.key === "Enter" || e.key === " ") && onClick) { e.preventDefault(); onClick(e); }
      }}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.35rem",
        padding: "0.3rem 0.45rem 0.3rem 0.6rem", borderRadius: 100,
        background: active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "rgba(138,138,150,0.10)",
        border: `1px solid ${active ? green : "var(--border-soft)"}`,
        color: active ? green : dim,
        fontSize: "0.75rem",
        cursor: "grab",
        userSelect: "none", position: "relative",
        opacity: isDragged ? 0.4 : 1,
        transition: "opacity 0.12s",
      }}
    >
      {level != null && (
        <span style={{ opacity: 0.65, fontSize: "0.58rem", padding: "0 2px" }}>L{level + 1}</span>
      )}
      <span
        title={label}
        style={{
          fontWeight: 600,
          maxWidth: 180, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {/* Filter chip meta: inline summary when configured, subtle hint
          when idle. Whole chip is clickable (the pointerup handler above),
          so no loud orange pseudo-button is needed. */}
      {isFilterChip && (
        <span style={{
          fontSize: "0.7rem",
          color: active ? green : dim,
          opacity: active ? 1 : 0.8,
          fontStyle: active ? "normal" : "italic",
          whiteSpace: "nowrap",
        }}>
          {active ? filterSummary : "nastaviť…"}
        </span>
      )}
      {/* Agg picker. Hidden for measure fields (single fixed calculation,
          no alternative aggs to choose from — the dropdown would be a
          one-item menu). For measures we still show a small static label
          so the user sees what's computed. */}
      {agg != null && onChangeAgg && aggs.length > 1 && (
        <>
          <span style={{ color: dim, opacity: 0.5, fontSize: "0.58rem" }}>·</span>
          <button
            data-chip-control
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
            style={{
              background: "transparent", border: "none",
              color: accentInk, cursor: "pointer", padding: 0,
              fontFamily: mono, fontSize: "0.7rem",
            }}
            title="Zmeň agregáciu"
          >
            {AGG_LABEL[agg] || agg} ▾
          </button>
          {menuOpen && (
            <div data-chip-control style={{
              position: "absolute", top: "100%", left: 0, marginTop: 4,
              background: "var(--surface-2)", border: `1px solid ${green}`,
              borderRadius: 6, padding: "0.25rem",
              boxShadow: "0 12px 32px rgba(0,0,0,0.8)",
              zIndex: 900, minWidth: 140,
            }}>
              {aggs.map(a => (
                <button
                  key={a}
                  data-chip-control
                  onClick={() => { onChangeAgg(a); setMenuOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "0.3rem 0.55rem", borderRadius: 3,
                    background: a === agg ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
                    color: a === agg ? green : text,
                    border: "none", fontFamily: mono, fontSize: "0.72rem",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { if (a !== agg) e.currentTarget.style.background = "var(--surface-2)"; }}
                  onMouseLeave={(e) => { if (a !== agg) e.currentTarget.style.background = "transparent"; }}
                >
                  {AGG_LABEL[a]}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <button
        data-chip-control
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove"
        style={{ background: "transparent", border: "none", color: accentInk, cursor: "pointer", padding: 0, fontSize: "0.95rem", lineHeight: 1 }}
      >×</button>
    </span>
  );
}

/* ─── RIGHT PANEL (palette) ─────────────────────────────────── */
function RightPanel({ usedKeys, search, setSearch, drag, setDrag, hoverZone, setHoverZone, onDropBack, lang }) {
  // Wire drag events from chips via a DOM-level custom event (chips live
  // in siblings, easier than prop-drilling a setDrag everywhere).
  // Also listen for the native HTML5 `dragend` so we clear drag state
  // when the user releases the pointer OUTSIDE any drop zone — without
  // this, the dim styling on inactive zones + the "drop to remove"
  // banner over the palette stayed sticky until the next drag.
  useEffect(() => {
    const onStart = (e) => setDrag({ ...e.detail });
    const onEnd   = () => { setDrag(null); setHoverZone(null); };
    window.addEventListener("pivotv2-drag-start", onStart);
    window.addEventListener("dragend", onEnd);
    return () => {
      window.removeEventListener("pivotv2-drag-start", onStart);
      window.removeEventListener("dragend", onEnd);
    };
  }, [setDrag, setHoverZone]);

  const q = search.trim().toLowerCase();
  const filtered = FIELD_ORDER
    .map(k => ({ key: k, ...FIELDS[k] }))
    .filter(f => !q || (f.label + " " + fieldLabel(f.key, "en")).toLowerCase().includes(q));

  // Group
  const groups = useMemo(() => {
    const out = {};
    for (const f of filtered) (out[f.group] = out[f.group] || []).push(f);
    return out;
  }, [filtered]);

  const isHover = hoverZone === "palette" && drag && drag.fromZone !== "palette";

  return (
    <div
      onDragOver={(e) => { if (drag && drag.fromZone !== "palette") { e.preventDefault(); setHoverZone("palette"); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && hoverZone === "palette") setHoverZone(null); }}
      onDrop={(e) => { e.preventDefault(); onDropBack(); }}
      style={{
        background: isHover ? "rgba(255,107,107,0.06)" : panel,
        border: `1px solid ${isHover ? "#ff6b6b" : border}`,
        borderRadius: 8, padding: "0.75rem",
        display: "flex", flexDirection: "column",
        minHeight: 480, maxHeight: 640,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.55rem" }}>
        <span style={{ fontFamily: mono, fontSize: "0.7rem", color: text, fontWeight: 700, letterSpacing: "0.06em" }}>
          {lang === "sk" ? "POLIA" : "FIELDS"}
        </span>
        <span style={{ fontFamily: mono, fontSize: "0.6rem", color: dim }}>{filtered.length}/{FIELD_ORDER.length}</span>
        {isHover && (
          <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: "0.62rem", color: dangerInk, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            ↓ {lang === "sk" ? "pusti pre odstránenie" : "drop to remove"}
          </span>
        )}
      </div>

      <div style={{ position: "relative", marginBottom: "0.55rem" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={lang === "sk" ? "Hľadať pole…" : "Search fields…"}
          style={{
            width: "100%",
            padding: "0.45rem 0.65rem 0.45rem 1.9rem",
            background: bg, border: `1px solid ${border}`, borderRadius: 5,
            color: text, fontSize: "0.78rem", fontFamily: "inherit",
            boxSizing: "border-box", outline: "none",
          }}
          onFocus={(e) => e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 67%, transparent)"}
          onBlur={(e) => e.currentTarget.style.borderColor = border}
        />
        <span style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: dim, fontSize: "0.9rem", pointerEvents: "none" }}>🔍</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", background: bg, border: `1px solid ${border}`, borderRadius: 5, padding: "0.3rem" }}>
        {Object.entries(groups).map(([groupKey, items], gi) => (
          <div key={groupKey} style={{ marginBottom: gi < Object.keys(groups).length - 1 ? "0.4rem" : 0 }}>
            <div style={{ fontFamily: mono, fontSize: "0.58rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0.3rem 0.45rem 0.2rem" }}>
              {groupLabel(groupKey, lang)}
            </div>
            {items.map(f => (
              <PaletteField
                key={f.key}
                field={f}
                lang={lang}
                used={usedKeys.has(f.key)}
                onDragStart={() => {
                  const payload = { fromZone: "palette", fieldKey: f.key };
                  window.__pivotv2_drag = payload;
                  window.dispatchEvent(new CustomEvent("pivotv2-drag-start", { detail: payload }));
                }}
              />
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "1rem 0.45rem", color: dim, fontSize: "0.74rem", textAlign: "center", fontStyle: "italic" }}>
            {lang === "sk" ? "Žiadne zhody." : "No matches."}
          </div>
        )}
      </div>
    </div>
  );
}

/* (useEffect for the drag-event listener is inlined in RightPanel now.) */

function PaletteField({ field, used, onDragStart, lang }) {
  const typeBadge = field.type === "number" ? "#" : (field.type === "date" ? "📅" : "T");
  const typeColor = field.type === "number" ? orange : green;
  // Palette fields are ALWAYS draggable now — even when the field is
  // already in Rows / Cols / Values. The "used" flag is a visual hint
  // (check mark + slight dim), not a hard lock. This is what unblocks
  // the "same field in Values + in Filters" flow: user drags `cena s
  // DPH` to Values, then drags the SAME palette entry to Filters to
  // exclude outliers. The mutex logic in addToZone still prevents
  // duplicates in Rows / Cols / Values themselves.
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", field.key);
        onDragStart();
      }}
      title={used
        ? "Už v niektorej zóne · potiahni do Filtrov pre coexistenciu"
        : "Potiahni do Riadky / Stĺpce / Hodnoty / Filtre"}
      style={{
        display: "flex", alignItems: "center", gap: "0.45rem",
        padding: "0.32rem 0.55rem", borderRadius: 4,
        color: used ? "var(--text-dim)" : text, fontSize: "0.78rem",
        cursor: "grab", userSelect: "none",
        borderLeft: "2px solid transparent", transition: "background 0.1s, border-color 0.1s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = panelHi;
        e.currentTarget.style.borderLeftColor = green;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderLeftColor = "transparent";
      }}
    >
      <span style={{ fontFamily: mono, fontSize: "0.62rem", width: 16, textAlign: "center", color: typeColor, opacity: used ? 0.45 : 1, fontWeight: 700 }}>
        {typeBadge}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fieldLabel(field.key, lang)}</span>
      {used && <span style={{ fontFamily: mono, fontSize: "0.58rem", color: accentInk, opacity: 0.65 }} title="Už použité inde">✓</span>}
    </div>
  );
}

function groupLabel(g, lang) {
  const labels = {
    meta:     lang === "sk" ? "Meta"              : "Meta",
    identity: lang === "sk" ? "Identifikácia"     : "Identity",
    spec:     lang === "sk" ? "Špecifikácia bytu" : "Unit spec",
    price:    lang === "sk" ? "Cena"              : "Price",
    status:   lang === "sk" ? "Stav"              : "Status",
    location: lang === "sk" ? "Lokalita"          : "Location",
    derived:  lang === "sk" ? "Vypočítané"        : "Derived",
    measure:  lang === "sk" ? "Merače (len do Hodnôt)" : "Measures (Values only)",
  };
  return labels[g] || g;
}

/* ─── ANALYSIS TOOLBAR ────────────────────────────────────────── */
function AnalysisToolbar({ valueMode, setValueMode, dataBars, setDataBars, onExportCSV, onCopyTable, effectiveValues = [], lang }) {
  // "copied" / "failed" flash on the copy button. A clipboard write can be
  // refused (permissions, non-secure context) and a button that silently does
  // nothing is indistinguishable from a broken one — so it always says which.
  const [copyState, setCopyState] = useState(null);   // null | "ok" | "fail"
  useEffect(() => {
    if (!copyState) return undefined;
    const t = setTimeout(() => setCopyState(null), 1800);
    return () => clearTimeout(t);
  }, [copyState]);
  // Long-hand border, not the `border` shorthand: btnActive below tints the pill by
  // overriding `borderColor`, and mixing the two in one React style object means the
  // pill LOSES its border the moment it goes inactive again (React clears borderColor
  // while the shorthand still stands) — plus a console warning on every toggle.
  const btnBase = {
    background: "transparent",
    borderWidth: "1px", borderStyle: "solid", borderColor: border,
    color: dim, padding: "0.35rem 0.7rem", borderRadius: 4,
    fontSize: "0.75rem", cursor: "pointer",
  };
  const btnActive = { ...btnBase, background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: accentInk, borderColor: green };
  const btnDisabled = { ...btnBase, opacity: 0.4, cursor: "not-allowed" };
  const btnPill = (active, disabled) => (disabled ? btnDisabled : (active ? btnActive : btnBase));

  // Pct modes (% z celku, % z rodiča) only make semantic sense for
  // ADDITIVE aggregates (count, count_distinct, sum). For avg/median/
  // min/max/measure they compute mathematically valid ratios that
  // EXCEED 100 % when the child's average is higher than the parent's
  // (e.g. Staré Mesto avg €/m² = 7,500 vs Bratislava avg = 5,500 →
  // 136 %), but the label "% z celku/rodiča" implies share-of-total
  // which averages can't have. Disable the buttons in that case +
  // auto-revert valueMode to "raw" so the table never shows nonsense.
  const NON_ADDITIVE = new Set(["avg", "median", "min", "max", "measure"]);
  const anyNonAdditive = effectiveValues.some(v => NON_ADDITIVE.has(v.agg));
  const pctDisabled = anyNonAdditive;
  useEffect(() => {
    if (pctDisabled && valueMode !== "raw") setValueMode("raw");
  }, [pctDisabled, valueMode, setValueMode]);

  // Note: the SK string uses Unicode quotes „..." (U+201E / U+201C). Plain
  // ASCII " inside a JS string literal terminates it — JSX/Vite parser
  // would die with "Expected `:` but found `Identifier`".
  const pctTooltip = pctDisabled
    ? (lang === "sk"
        ? "% z celku / rodiča má zmysel len pre count / sum. Pri priemere/mediáne/min/max sa hodnoty nesčítavajú do 100 %, takže by zobrazenie klamalo (napr. 135 % pre okres s vyšším priemerom než celé mesto). Prepni mieru na count alebo sum aby sa táto možnosť zapla."
        : "% of total / parent only makes sense for count / sum. For avg/median/min/max the values don't add up to 100 % (e.g. a district with a higher average shows >100 %), so the labels would mislead. Switch the measure to count or sum to enable this.")
    : undefined;

  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center",
      margin: "0 0 0.6rem", padding: "0.5rem 0.7rem",
      background: panel, border: `1px solid ${border}`, borderRadius: 6,
    }}>
      <span style={{ fontSize: "0.75rem", color: dim, marginRight: "0.3rem" }}>
        {lang === "sk" ? "Zobraziť" : "Show"}
      </span>
      <button style={btnPill(valueMode === "raw")}        onClick={() => setValueMode("raw")}>{lang === "sk" ? "absolútne" : "absolute"}</button>
      <button
        style={btnPill(valueMode === "pct_total", pctDisabled)}
        onClick={pctDisabled ? undefined : () => setValueMode("pct_total")}
        disabled={pctDisabled}
        title={pctTooltip}
      >
        % {lang === "sk" ? "z celku" : "of total"}
      </button>
      <button
        style={btnPill(valueMode === "pct_parent", pctDisabled)}
        onClick={pctDisabled ? undefined : () => setValueMode("pct_parent")}
        disabled={pctDisabled}
        title={pctTooltip}
      >
        % {lang === "sk" ? "z rodiča" : "of parent"}
      </button>

      <span style={{ width: 1, height: 16, background: border, margin: "0 0.35rem" }} />

      <button style={btnPill(dataBars)} onClick={() => setDataBars(x => !x)}>{lang === "sk" ? "▮ stĺpčeky" : "▮ bars"}</button>

      <button
        style={{
          ...btnBase, marginLeft: "auto",
          color: copyState === "fail" ? "#ff6b6b" : accentInk,
          borderColor: copyState === "fail" ? "#ff6b6b" : `color-mix(in srgb, var(--accent) 33%, transparent)`,
          background: copyState === "ok" ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
        }}
        onClick={async () => setCopyState((await onCopyTable()) ? "ok" : "fail")}
        title={lang === "sk"
          ? "Skopíruje celú tabuľku do schránky ako tabuľku — v Exceli ju vlož cez Ctrl+V a padne do buniek (čísla ako čísla)."
          : "Copies the whole table to the clipboard as a table — paste it into Excel with Ctrl+V and it lands in cells (numbers as numbers)."}
      >
        {copyState === "ok" ? (lang === "sk" ? "✓ skopírované" : "✓ copied")
          : copyState === "fail" ? (lang === "sk" ? "✕ nepodarilo sa" : "✕ copy failed")
          : (lang === "sk" ? "⧉ Kopírovať pre Excel" : "⧉ Copy for Excel")}
      </button>
      <button style={{ ...btnBase, color: accentInk, borderColor: `color-mix(in srgb, var(--accent) 33%, transparent)` }}
              onClick={onExportCSV}>
        ⬇ CSV
      </button>
    </div>
  );
}

/* ─── EXPORT / CLIPBOARD ──────────────────────────────────────────
   ONE builder, two destinations. The .csv download and the "copy for Excel"
   button both render the SAME matrix, so they can never disagree about what a
   number is. Serialization (locale decimal mark, list separator, formula
   guard, the HTML clipboard flavour) lives in lib/tableClipboard.js.

   Cells are values, not display strings: a number stays a number, a % stays a
   percentage, text stays text. That is the whole reason a paste into Excel
   lands as figures you can sum instead of left-aligned text. */
function buildPivotMatrix(flatRows, grandTotal, rowFields, colFields, effectiveValues, valueMode, lang = "sk") {
  // Headers follow the active UI language (fieldLabel), same as every on-screen label —
  // an EN user must not get Slovak column names in their export.
  // Measure unit → header + currency conversion, mirroring the on-screen
  // formatValue so the export matches what the user sees (currency + unit).
  const measureUnit = (v) => v.key === "__count__" ? null : FIELDS[v.field]?.unit;
  const valueHeader = (v) => {
    if (v.key === "__count__") return "Count";
    const u = measureUnit(v);
    const unit = isMoneyUnit(u) ? ` (${displayMoneyUnit(u)})` : (u ? ` (${u})` : "");
    return `${AGG_LABEL[v.agg]}(${fieldLabel(v.field, lang)})${unit}`;
  };
  /* A measure as a NUMBER in the display currency. Rounding to 2 places is the
     serializer's job — here we only convert. null → an empty cell (not 0). */
  const measureNum = (raw, v) => {
    if (raw == null || !Number.isFinite(raw)) return null;
    return isMoneyUnit(measureUnit(v)) ? moneyFromEur(raw) : raw;
  };

  const crossTab = colFields.length > 0;
  const colKeys = crossTab ? (grandTotal.colKeys || []) : [];
  const grandForCol = (i) => grandTotal.rollups[i];

  // Parent-node lookup for the "% of parent" value mode (level-0 → grand total).
  const nodeByPath = new Map();
  for (const n of flatRows) nodeByPath.set(JSON.stringify(n.path.slice(0, n.level + 1)), n);
  const parentOf = (n) => (n.level === 0 ? grandTotal : (nodeByPath.get(JSON.stringify(n.path.slice(0, n.level))) || grandTotal));

  // A single value cell honoring the active valueMode (absolute / % total / % parent).
  // Mirror renderCellValue: % modes only apply to additive aggs (share of a whole);
  // avg/min/max/median export the raw measure (a "% of total" on an average is nonsense).
  const cellVal = (raw, i, parentRaw) => {
    const shareable = SHAREABLE_AGGS.has(effectiveValues[i]?.agg);
    if (valueMode === "pct_total" && shareable) {
      const g = grandForCol(i);
      return (raw == null || !g) ? null : { v: (raw / g) * 100, pct: true };
    }
    if (valueMode === "pct_parent" && shareable) {
      return (raw == null || !parentRaw) ? null : { v: (raw / parentRaw) * 100, pct: true };
    }
    return measureNum(raw, effectiveValues[i]);
  };

  // Header
  const header = [
    ...rowFields.map((f, i) => `L${i + 1}·${fieldLabel(f, lang)}`),
    "Count",
  ];
  if (crossTab) {
    for (const ck of colKeys) {
      for (const v of effectiveValues) header.push(`${ck} · ${valueHeader(v)}`);
    }
    for (const v of effectiveValues) header.push(`TOTAL · ${valueHeader(v)}`);
  } else {
    for (const v of effectiveValues) header.push(valueHeader(v));
  }

  const matrix = [header];

  for (const n of flatRows) {
    const labelCols = rowFields.map((_, i) => i <= n.level ? (n.path[i] || "") : "");
    const row = [...labelCols, n.count];
    const par = parentOf(n);
    if (crossTab) {
      for (const ck of colKeys) {
        for (let i = 0; i < effectiveValues.length; i++) {
          row.push(cellVal(n.colRollups?.[ck]?.[i], i, par.colRollups?.[ck]?.[i]));
        }
      }
    }
    for (let i = 0; i < effectiveValues.length; i++) {
      row.push(cellVal(n.rollups[i], i, par.rollups?.[i]));
    }
    matrix.push(row);
  }

  // Grand total row is always ABSOLUTE (currency-converted) — clearest anchor
  // regardless of the % value mode.
  const gt = ["TOTAL", ...rowFields.slice(1).map(() => ""), grandTotal.count];
  if (crossTab) {
    for (const ck of colKeys) {
      for (let i = 0; i < effectiveValues.length; i++) {
        gt.push(measureNum(grandTotal.colRollups?.[ck]?.[i], effectiveValues[i]));
      }
    }
  }
  for (let i = 0; i < effectiveValues.length; i++) {
    gt.push(measureNum(grandTotal.rollups[i], effectiveValues[i]));
  }
  matrix.push(gt);

  return matrix;
}

function exportPivotCSV(flatRows, grandTotal, rowFields, colFields, effectiveValues, valueMode, lang = "sk") {
  const csv = toCSV(buildPivotMatrix(flatRows, grandTotal, rowFields, colFields, effectiveValues, valueMode, lang), lang);
  // BOM so Excel opens it as UTF-8 rather than mangling ž/é/ô.
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `residata-pivot-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Copy the pivot to the clipboard as a real table — HTML flavour for
   Excel/Sheets/Numbers (real cells, right there on Ctrl+V) plus a TSV flavour
   for anything that only takes text. Resolves to true when it landed. */
function copyPivotTable(flatRows, grandTotal, rowFields, colFields, effectiveValues, valueMode, lang = "sk") {
  return copyTable(
    buildPivotMatrix(flatRows, grandTotal, rowFields, colFields, effectiveValues, valueMode, lang),
    { lang, headerRows: 1 }
  );
}

/* On-offer (V+PR+R) vs sold (P) split for a tree node — from its stav comp
   (grain rows) or its records (raw mode). Lets every row show the split so the
   count is never misread as "all on the market". */
function stavSplitOf(n) {
  const c = n.comp;
  if (c) return { offer: (+c.avail || 0) + (+c.res || 0) + (+c.prer || 0), sold: +c.sold || 0 };
  if (n.records && n.records.length) {
    let offer = 0, sold = 0;
    for (const r of n.records) {
      const s = (r.stav || "").trim().toUpperCase();
      if (s === "P") sold++;
      else if (s === "V" || s === "R" || s === "PR") offer++;
    }
    return { offer, sold };
  }
  return null;
}

/* ─── RESULT TABLE ────────────────────────────────────────────── */
function ResultTable({ rowFields, colFields = [], effectiveValues, flatRows, collapsed: _collapsed, onToggle, sort, setSort, grandTotal, lang, valueMode = "raw", dataBars = false, onDrillDown, onProjectOpen }) {
  const spec = useSpecifics(lang);
  // Project-name column support:
  // When the deepest row field is project_name, rows ARE individual
  // projects — we offer a click-to-navigate on the name cell.
  // For non-project groupings (cast, developer, district), clicking
  // the name does nothing (no destination for 'district=Ružinov').
  const deepestRowField = rowFields[rowFields.length - 1];
  const projectRowsActive = deepestRowField === "project_name" && typeof onProjectOpen === "function";
  // Cross-tab columns come from the tree's top-level colKeys so every
  // row shares the same horizontal axis (otherwise leaves could have
  // different col sets and the table would be ragged).
  const colKeys = colFields.length ? (grandTotal.colKeys || []) : null;
  const colOverflow = grandTotal.colOverflow || 0;   // # column values folded into Σ but not shown
  const crossTab = !!colKeys;

  /* The cross-tab header is two rows deep. To freeze the SECOND one we need
     the real pixel height of the FIRST — which changes with font size, zoom and
     the browser's own metrics, so it is measured rather than guessed. A hard-coded
     offset here is exactly the kind of magic number that looks fine on one machine
     and leaves a 3px seam of scrolling rows on another. */
  const headRow1Ref = useRef(null);
  const [headRow1H, setHeadRow1H] = useState(0);
  useLayoutEffect(() => {
    const el = headRow1Ref.current;
    if (!el) { setHeadRow1H(0); return undefined; }
    const measure = () => setHeadRow1H(el.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [crossTab, colKeys?.length, effectiveValues.length]);
  const row2Top = crossTab ? headRow1H : 0;

  if (!rowFields.length) {
    return (
      <div style={{
        background: panel, border: `1px solid ${border}`, borderRadius: 8,
        padding: "1.75rem 1.25rem", textAlign: "center", color: dim, fontSize: "0.82rem",
      }}>
        <div style={{ fontFamily: mono, fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.6rem" }}>
          {lang === "sk" ? "Výsledok" : "Result"}
        </div>
        {lang === "sk"
          ? "Potiahni aspoň jedno pole do Riadkov — pivot sa objaví tu."
          : "Drop at least one field into Rows — the pivot will appear here."}
      </div>
    );
  }

  const valueHeaderText = (v) => {
    if (v.key === "__count__") return lang === "sk" ? "Počet" : "Count";
    const fld = FIELDS[v.field];
    if (fld && fld.type === "measure") {
      const u = isMoneyUnit(fld.unit) ? displayMoneyUnit(fld.unit) : fld.unit;
      return fieldLabel(v.field, lang) + (u ? ` (${u})` : "");
    }
    return `${AGG_LABEL[v.agg]} · ${fieldLabel(v.field, lang) || v.field}`;
  };

  const clickSort = (col) => {
    setSort(cur => {
      if (cur.col === col) return { col, dir: cur.dir === "desc" ? "asc" : "desc" };
      return { col, dir: "desc" };
    });
  };
  const sortIndicator = (col) => {
    if (sort.col !== col) return null;
    return <span style={{ marginLeft: 4, color: accentInk }}>{sort.dir === "desc" ? "▾" : "▴"}</span>;
  };

  // Per-value-column min/max (across LEAF nodes only — subtotals would
  // skew scale). Used for inline data bars in the Σ-total cells.
  const scaleByCol = (() => {
    const out = [];
    for (let i = 0; i < effectiveValues.length; i++) {
      let lo = Infinity, hi = -Infinity;
      for (const n of flatRows) {
        if (!n.isLeaf) continue;
        const v = n.rollups[i];
        if (v == null || !Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) { out.push(null); continue; }
      out.push({ lo, hi });
    }
    return out;
  })();

  // Per-(colKey × value) min/max for cross-tab data bars. Scoping per
  // column means each cell's bar is sized against peers in the same
  // column bucket — visually "who's biggest in V" / "who's biggest in P".
  const scaleByCellKey = (() => {
    if (!crossTab) return {};
    const m = {};
    for (const ck of colKeys) {
      for (let i = 0; i < effectiveValues.length; i++) {
        let lo = Infinity, hi = -Infinity;
        for (const n of flatRows) {
          if (!n.isLeaf) continue;
          const v = n.colRollups?.[ck]?.[i];
          if (v == null || !Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        m[`${ck}::${i}`] = (Number.isFinite(lo) && Number.isFinite(hi))
          ? { lo, hi } : null;
      }
    }
    return m;
  })();

  // ── Render one cell's display value with valueMode applied ──
  // Modes:
  //   raw         → formatValue(raw)         (e.g. "1 200 €", "57.3 %")
  //   pct_total   → raw / grand-total[i] × 100  (cell as % of grand total)
  //   pct_parent  → raw / parent[i]      × 100  (cell as % of parent row)
  //
  // pct_parent edge case: at level 0 there's no real parent — we fall
  // back to the grand total, which makes pct_parent equivalent to
  // pct_total there. For deeper rows the parent is the row's L-(n-1)
  // subtotal. Show "—" only when both raw and parent are missing — show
  // raw as fallback when parent is 0 (avoids /0 looking like "—").
  const renderCellValue = (raw, valIdx, parentRaw) => {
    if (raw == null || !Number.isFinite(raw)) return "—";
    const v = effectiveValues[valIdx];
    // "% of total/parent" is a SHARE of a whole — only meaningful for additive measures
    // (count / count_distinct / sum). For avg/min/max/median a row's value ÷ the grand
    // value is NOT a share and routinely exceeds 100% (a project priced above the global
    // average would read "142%"). Show the raw formatted value for non-additive aggs.
    const shareable = SHAREABLE_AGGS.has(v.agg);
    if (valueMode === "pct_total" && shareable) {
      const g = grandTotal.rollups[valIdx];
      if (g == null || !Number.isFinite(g) || g === 0) return formatValue(raw, v.field, v.agg);
      return `${((raw / g) * 100).toFixed(1)}%`;
    }
    if (valueMode === "pct_parent" && shareable) {
      if (parentRaw == null || !Number.isFinite(parentRaw) || parentRaw === 0) {
        // parent missing or 0 — show raw so user sees the value rather
        // than a confusing "—".
        return formatValue(raw, v.field, v.agg);
      }
      return `${((raw / parentRaw) * 100).toFixed(1)}%`;
    }
    return formatValue(raw, v.field, v.agg);
  };

  // Data bar width (%) — proportional to |value| / peer-max. Only
  // shown in raw mode; in pct modes the % itself is the visual.
  const barWidth = (raw, valIdx, scale) => {
    if (valueMode !== "raw") return 0;
    const s = scale || scaleByCol[valIdx];
    if (!s || raw == null || !Number.isFinite(raw)) return 0;
    const m = Math.max(Math.abs(s.hi), Math.abs(s.lo), 1e-9);
    return Math.min(100, (Math.abs(raw) / m) * 100);
  };

  // Build a map pathKey → parent node (for pct_parent mode).
  // First pass: index flatRows by pathKey (O(n)). Second pass: lookup
  // parents (O(n)). Was O(n²) via Array.find — fine for 100 rows but
  // user could have 5000+ flat rows once cross-tab × deep hierarchies.
  const parentByPath = (() => {
    const byKey = new Map();
    for (const n of flatRows) byKey.set(n.pathKey, n);
    const m = {};
    for (const n of flatRows) {
      if (!n.path.length) continue;
      const parentKey = n.path.slice(0, -1).join(SEP);
      m[n.pathKey] = byKey.get(parentKey) || grandTotal;
    }
    return m;
  })();

  return (
    <div className="pivot-scroll" style={{
      border: `1px solid ${border}`, borderRadius: 8, overflow: "auto",
      background: panel, maxHeight: 720,
      // The scroll stays inside this panel: the page never gains a sideways
      // scrollbar because a pivot grew a 40th column.
      overscrollBehaviorX: "contain",
      maxWidth: "100%",
    }}>
      <table style={{
        width: "max-content", minWidth: "100%",
        borderCollapse: "separate", borderSpacing: 0,
        fontSize: "0.82rem",
      }}>
        <thead>
          {crossTab && (
            /* Top header row: col-field name spanning all per-col groups */
            <tr ref={headRow1Ref} style={{ textAlign: "center", color: dim, fontFamily: mono, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <th style={{ ...th, borderBottom: "none", position: "sticky", top: 0, left: 0, zIndex: 6 }} colSpan={2}></th>
              {colKeys.map(ck => (
                <th key={"ctop:" + ck} colSpan={effectiveValues.length}
                    style={{ ...th, color: accentInk, borderLeft: `1px solid ${border}`, borderBottom: `1px solid ${border}`,
                             position: "sticky", top: 0, zIndex: 3 }}>
                  <span style={{ opacity: 0.65 }}>{fieldLabel(colFields[0], lang)}:</span> <strong style={{ color: accentInk }}>{ck}</strong>
                </th>
              ))}
              {/* Grand totals across columns. When there are more distinct column
                  values than fit (MAX_COL_VALUES), Σ still counts ALL of them, so
                  flag the hidden ones — otherwise Σ silently exceeds the sum of the
                  visible columns. */}
              <th colSpan={effectiveValues.length}
                  style={{ ...th, color: dim, borderLeft: `2px solid color-mix(in srgb, var(--accent) 33%, transparent)`,
                           position: "sticky", top: 0, zIndex: 3 }}
                  title={colOverflow > 0 ? (lang === "sk" ? `Σ zahŕňa aj ${colOverflow} ďalších stĺpcov, ktoré sa nezmestili` : `Σ also includes ${colOverflow} more columns that didn't fit`) : undefined}>
                Σ {lang === "sk" ? "spolu" : "total"}
                {colOverflow > 0 && <span style={{ color: orangeInk, fontWeight: 400 }}> · +{colOverflow}</span>}
              </th>
            </tr>
          )}
          <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.64rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {/* Hierarchy label column — spans the row-fields, labelled with the
                chain (L1 Cast › L2 Developer › …) */}
            {/* The row-field chain can be long (L1 Mesto › L2 Developer › L3 Projekt).
                It gets the fixed label width like every other cell in this column and
                ellipsises rather than widening it; the full chain is in the tooltip. */}
            <th style={{ ...th, ...stickyLeft("label", 5, "var(--surface-2)"), top: row2Top, cursor: "pointer" }}
                title={rowFields.map((f, i) => `L${i + 1} ${fieldLabel(f, lang)}`).join(" › ")}
                onClick={() => clickSort("label")}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {rowFields.map((f, i) => (
                  <span key={f} style={{ color: i === 0 ? green : dim }}>
                    {i > 0 && <span style={{ color: dim, opacity: 0.5, margin: "0 0.3rem" }}>›</span>}
                    <span style={{ opacity: 0.65, marginRight: 3 }}>L{i + 1}</span>{fieldLabel(f, lang)}
                  </span>
                ))}
                {sortIndicator("label")}
              </div>
            </th>
            <th style={{ ...th, ...stickyLeft("count", 5, "var(--surface-2)"), top: row2Top, textAlign: "right", cursor: "pointer" }}
                onClick={() => clickSort("count")}>
              #{sortIndicator("count")}
            </th>
            {crossTab ? (
              <>
                {colKeys.map((ck) => (
                  effectiveValues.map((v, i) => (
                    <th key={`h:${ck}:${v.key}`}
                        style={{
                          ...th, position: "sticky", top: row2Top, zIndex: 2,
                          textAlign: "right", minWidth: 80, color: accentInk,
                          borderLeft: i === 0 ? `1px solid ${border}` : undefined,
                        }}>
                      {valueHeaderText(v)}
                    </th>
                  ))
                ))}
                {/* Σ total columns (across all col values) */}
                {effectiveValues.map((v, i) => (
                  <th key={`sum:${v.key}`}
                      style={{
                        ...th, position: "sticky", top: row2Top, zIndex: 2,
                        textAlign: "right", minWidth: 90, color: dim,
                        borderLeft: i === 0 ? `2px solid color-mix(in srgb, var(--accent) 33%, transparent)` : undefined,
                        cursor: "pointer",
                      }}
                      onClick={() => clickSort(i)}>
                    Σ {valueHeaderText(v)}{sortIndicator(i)}
                  </th>
                ))}
              </>
            ) : (
              effectiveValues.map((v, i) => (
                <th key={v.key} style={{ ...th, position: "sticky", top: row2Top, zIndex: 2, textAlign: "right", minWidth: 100, color: accentInk, cursor: "pointer" }} onClick={() => clickSort(i)}>
                  {valueHeaderText(v)}{sortIndicator(i)}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {flatRows.map((n, idx) => {
            const isSubtotal = !n.isLeaf;
            // Subtotal/group rows: a green-tinted ladder that deepens by level. rgba
            // accent over the card reads on BOTH themes (was a hardcoded near-black
            // ladder — a dark-theme leftover that rendered as a black bar in light).
            /* Every row background is OPAQUE — mixed against the panel colour, not
               against `transparent`. The frozen label/count cells inherit this colour,
               and a semi-transparent one would let the scrolling body show straight
               through them. Same shades on screen, just composited here instead of
               by the browser. */
            const shade = [
              "color-mix(in srgb, var(--accent) 15%, var(--surface-2))", "color-mix(in srgb, var(--accent) 10%, var(--surface-2))",
              "var(--surface-3)", "var(--surface-2)", "var(--surface-2)",
            ][Math.min(n.level, 4)];
            const indent = 0.4 + n.level * 0.8;
            const baseBg = isSubtotal ? shade
              : (idx % 2 ? "var(--surface-2)" : "color-mix(in srgb, var(--text) 3%, var(--surface-2))");
            // border-collapse:separate ignores borders on <tr>, so the row rule
            // rides on the cells instead.
            const rowRule = { borderTop: n.level === 0 ? `1px solid ${border}` : `1px solid var(--border-soft)` };
            // Is THIS row a navigable project? Only when the deepest
            // grouping is project_name, this is a leaf node, and we
            // can resolve a project_id from its records (any record
            // in the group has it since all records share the project).
            // A row IS a project whenever the deepest grouping is the project
            // name — whether or not the client happens to hold its records.
            const isProjectLabel = Boolean(deepestRowField === "project_name" && n.isLeaf);
            // Its id comes from the records when the pivot aggregated client-side,
            // and otherwise from the specifics map, which is keyed by name as well
            // as by id. Without that fallback every SERVER-aggregated pivot — the
            // common case — rendered project rows that could not be opened.
            const projectId = (n.records && n.records.length ? n.records[0]?.project_id : null)
                              || (isProjectLabel ? spec.data?.[n.label]?.id : null) || null;
            const canOpenProject = Boolean(projectRowsActive && isProjectLabel && projectId && onProjectOpen);
            const canToggle = Boolean(n.hasChildren);
            // Whole-row click target where it logically makes sense: a project
            // leaf opens the project, a group header expands/collapses.
            const rowInteractive = canOpenProject || canToggle;
            const rowAction = canOpenProject ? () => onProjectOpen(projectId)
                            : canToggle ? () => onToggle(n.pathKey)
                            : undefined;
            return (
              <tr key={n.pathKey + "|" + idx}
                /* data-pathkey lets the chart-click flash handler find this
                   row by tree path. The chart only emits paths for level-0
                   rows (always visible regardless of collapse state), so we
                   don't need to expand parents on click. */
                data-pathkey={n.pathKey}
                className={rowInteractive ? "pivot-row-int" : undefined}
                onClick={rowAction}
                title={canOpenProject ? (lang === "sk" ? `Otvoriť projekt ${n.label}` : `Open project ${n.label}`) : undefined}
                onMouseEnter={rowInteractive ? (e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 11%, transparent)"; } : undefined}
                onMouseLeave={rowInteractive ? (e) => { e.currentTarget.style.background = baseBg; } : undefined}
                style={{
                  background: baseBg,
                  transition: "background 0.12s",
                }}>
                <td style={{
                  ...td, ...rowRule, ...stickyLeft("label", 1),
                  paddingLeft: `${indent}rem`,
                  fontWeight: isSubtotal ? 700 : 400,
                  color: isSubtotal ? text : "var(--text-2)",
                }}>
                  {/* One flex line: the fixed-size affordances hold their width and
                      only the NAME shrinks (min-width:0 + ellipsis), so a 60-character
                      project title can never widen the column or push the row to two
                      lines. Full text stays available in the tooltip. */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0 }}>
                    {isSubtotal && (
                      <span style={{ color: dim, fontSize: "0.62rem", flex: "0 0 auto" }}>
                        L{n.level + 1}
                      </span>
                    )}
                    {n.hasChildren ? (
                      <button onClick={(e) => { e.stopPropagation(); onToggle(n.pathKey); }}
                        style={{ background: "transparent", border: "none", color: accentInk, cursor: "pointer", padding: 0, fontSize: "0.7rem", width: 12, flex: "0 0 auto" }}
                        title={n.isCollapsed ? "Expand" : "Collapse"}>
                        {n.isCollapsed ? "▸" : "▾"}
                      </button>
                    ) : (
                      <span style={{ display: "inline-block", width: 12, flex: "0 0 auto" }} />
                    )}
                    {/* Whole ROW is the click target (see <tr onClick>). The name
                        is the keyboard-focusable button + carries the underline
                        affordance (.pivot-row-int:hover .pivot-label-text). Its own
                        onClick stopPropagation's so a name-click opens once (not
                        twice via the row). Non-project rows stay plain text. */}
                    {canOpenProject ? (
                      <span
                        className="pivot-label-text"
                        role="button" tabIndex={0}
                        title={lang === "sk" ? `Otvoriť projekt ${n.label}` : `Open project ${n.label}`}
                        onClick={(e) => { e.stopPropagation(); onProjectOpen(projectId); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onProjectOpen(projectId); } }}
                        style={{ color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >{n.label}</span>
                    ) : (
                      <span title={n.label} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</span>
                    )}
                    {/* `flex: none` — this label truncates with an ellipsis, so an
                        inline mark would be the first thing clipped. */}
                    {isProjectLabel ? <SpecificsMark items={spec.project(projectId || n.label)} lang={lang} style={{ flex: "0 0 auto" }} /> : null}
                    {isSubtotal && n.isCollapsed && (
                      <span style={{ fontSize: "0.64rem", color: dim, fontFamily: mono, opacity: 0.7, flex: "0 0 auto" }}>
                        ({n.children.length} {lang === "sk" ? "pod" : "sub"})
                      </span>
                    )}
                  </div>
                </td>
                {/* # count — always clickable to drill down into records.
                    Cursor changed from outdated 'zoom-in' (browser-default
                    magnifier) to 'pointer' (universal, modern). */}
                <td style={{ ...td, ...rowRule, ...stickyLeft("count", 1), textAlign: "right", fontFamily: mono, color: isSubtotal ? "var(--text-2)" : dim, fontWeight: isSubtotal ? 600 : 400, cursor: onDrillDown ? "pointer" : "default" }}
                    title={onDrillDown ? (lang === "sk" ? "Zobraziť záznamy v tejto skupine" : "Show records in this group") : undefined}
                    onClick={onDrillDown ? (e) => { e.stopPropagation(); onDrillDown(n); } : undefined}>
                  {n.count.toLocaleString("en-US").replace(/,/g, " ")}
                  {(() => {
                    const sp = stavSplitOf(n);
                    if (!sp || sp.sold <= 0) return null;
                    const f = (x) => x.toLocaleString("en-US").replace(/,/g, " ");
                    return (
                      <div title={lang === "sk" ? `${f(sp.offer)} v ponuke · ${f(sp.sold)} predaných` : `${f(sp.offer)} on offer · ${f(sp.sold)} sold`}
                           style={{ fontSize: "0.58rem", fontWeight: 400, marginTop: 1, whiteSpace: "nowrap" }}>
                        <span style={{ color: accentInk }}>{f(sp.offer)}</span>
                        <span style={{ opacity: 0.4 }}> · </span>
                        <span style={{ opacity: 0.65 }}>{f(sp.sold)}</span>
                      </div>
                    );
                  })()}
                </td>
                {crossTab ? (
                  <>
                    {colKeys.map((ck) => (
                      effectiveValues.map((v, i) => {
                        const raw = n.colRollups ? n.colRollups[ck]?.[i] : null;
                        const parent = parentByPath[n.pathKey];
                        const parentRaw = parent?.colRollups ? parent.colRollups[ck]?.[i] : (parent?.rollups?.[i] ?? null);
                        const scale = scaleByCellKey[`${ck}::${i}`];
                        const bw = dataBars && n.isLeaf ? barWidth(raw, i, scale) : 0;
                        return (
                          <td
                            key={`c:${ck}:${v.key}`}
                            /* data-colkey: chart-click flash handler uses
                               this to highlight the specific cross-tab cell
                               within a row (e.g. clicking a stacked-bar
                               segment for "stav=V" in row "Ružinov" pulses
                               the V column cell of the Ružinov row, not the
                               whole row). Only the FIRST cell per (row, ck)
                               gets the data-attr — when there are multiple
                               value columns per ck, we flash just the first
                               so the highlight stays visually compact. */
                            data-colkey={i === 0 ? String(ck) : undefined}
                            style={{
                              ...td, ...rowRule, textAlign: "right", fontFamily: mono,
                              color: accentInk, fontWeight: isSubtotal ? 800 : 600,
                              borderLeft: i === 0 ? `1px solid ${border}` : undefined,
                              position: "relative",
                            }}>
                            {bw > 0 && (
                              <span aria-hidden style={{
                                position: "absolute", right: 0, bottom: 0, height: 3,
                                width: `${bw}%`, background: `linear-gradient(90deg, var(--accent-strong), var(--accent))`,
                                borderBottomRightRadius: 2, pointerEvents: "none",
                              }} />
                            )}
                            {renderCellValue(raw, i, parentRaw)}
                          </td>
                        );
                      })
                    ))}
                    {/* Σ total across cols — shows overall rollup */}
                    {effectiveValues.map((v, i) => {
                      const raw = n.rollups[i];
                      const parent = parentByPath[n.pathKey];
                      const parentRaw = parent ? parent.rollups[i] : null;
                      const bw = dataBars && n.isLeaf ? barWidth(raw, i) : 0;
                      return (
                        <td key={`sum:${v.key}`} style={{
                          ...td, ...rowRule, textAlign: "right", fontFamily: mono,
                          color: accentInk, fontWeight: isSubtotal ? 800 : 700,
                          borderLeft: i === 0 ? `2px solid color-mix(in srgb, var(--accent) 33%, transparent)` : undefined,
                          background: "color-mix(in srgb, var(--accent) 3%, transparent)",
                          position: "relative",
                        }}>
                          {bw > 0 && (
                            <span aria-hidden style={{
                              position: "absolute", right: 0, bottom: 0, height: 3,
                              width: `${bw}%`, background: `linear-gradient(90deg, var(--accent-strong), var(--accent))`,
                              borderBottomRightRadius: 2, pointerEvents: "none",
                            }} />
                          )}
                          {isSubtotal && <span style={{ opacity: 0.5, marginRight: "0.3rem" }}>Σ</span>}
                          {renderCellValue(raw, i, parentRaw)}
                        </td>
                      );
                    })}
                  </>
                ) : (
                  effectiveValues.map((v, i) => {
                    const raw = n.rollups[i];
                    const parent = parentByPath[n.pathKey];
                    const parentRaw = parent ? parent.rollups[i] : null;
                    const bw = dataBars && n.isLeaf ? barWidth(raw, i) : 0;
                    return (
                      <td key={v.key} style={{
                        ...td, ...rowRule, textAlign: "right", fontFamily: mono,
                        color: accentInk, fontWeight: isSubtotal ? 800 : 600,
                        position: "relative",
                      }}>
                        {bw > 0 && (
                          <span aria-hidden style={{
                            position: "absolute", right: 0, bottom: 0, height: 3,
                            width: `${bw}%`, background: `linear-gradient(90deg, var(--accent-strong), var(--accent))`,
                            borderBottomRightRadius: 2, pointerEvents: "none",
                          }} />
                        )}
                        {isSubtotal && <span style={{ opacity: 0.5, marginRight: "0.3rem" }}>Σ</span>}
                        {renderCellValue(raw, i, parentRaw)}
                      </td>
                    );
                  })
                )}
              </tr>
            );
          })}
          {/* Grand total — shows raw absolute numbers regardless of pct
              mode. In pct_total mode we COULD show "100%" everywhere but
              that's just visual noise; user wants to see the actual
              total they're percenting against. */}
          {/* Σ row: frozen to the BOTTOM as well as the left, so the total the user
              is reading against stays on screen however far down the pivot goes. */}
          <tr style={{ background: bg }}>
            <td style={{ ...td, ...stickyLeft("label", 3), ...totalRule, position: "sticky", left: 0, bottom: 0, zIndex: 4, background: bg, fontWeight: 700, color: accentInk, fontSize: "0.85rem" }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Σ {lang === "sk" ? "Spolu" : "Total"}
                {valueMode !== "raw" && (
                  <span style={{ fontSize: "0.65rem", color: dim, marginLeft: "0.4rem", fontWeight: 400 }}>
                    ({lang === "sk" ? "absolútne" : "absolute"})
                  </span>
                )}
              </div>
            </td>
            <td style={{ ...td, ...stickyLeft("count", 3), ...totalRule, position: "sticky", left: "var(--pv-label-w)", bottom: 0, zIndex: 4, background: bg, textAlign: "right", fontFamily: mono, color: accentInk, fontWeight: 700 }}>
              {grandTotal.count.toLocaleString("en-US").replace(/,/g, " ")}
            </td>
            {crossTab ? (
              <>
                {colKeys.map((ck) => (
                  effectiveValues.map((v, i) => (
                    <td key={`gt:${ck}:${v.key}`} style={{
                      ...td, ...totalRule, position: "sticky", bottom: 0, zIndex: 2, background: bg,
                      textAlign: "right", fontFamily: mono, color: accentInk,
                      fontWeight: 900, fontSize: "0.9rem",
                      borderLeft: i === 0 ? `1px solid ${border}` : undefined,
                    }}>
                      {formatValue(grandTotal.colRollups?.[ck]?.[i], v.field, v.agg)}
                    </td>
                  ))
                ))}
                {effectiveValues.map((v, i) => (
                  <td key={`gsum:${v.key}`} style={{
                    ...td, ...totalRule, position: "sticky", bottom: 0, zIndex: 2,
                    textAlign: "right", fontFamily: mono, color: accentInk,
                    fontWeight: 900, fontSize: "0.9rem",
                    borderLeft: i === 0 ? `2px solid color-mix(in srgb, var(--accent) 33%, transparent)` : undefined,
                    background: `color-mix(in srgb, var(--accent) 6%, ${bg})`,
                  }}>
                    {formatValue(grandTotal.rollups[i], v.field, v.agg)}
                  </td>
                ))}
              </>
            ) : (
              effectiveValues.map((v, i) => (
                <td key={v.key} style={{ ...td, ...totalRule, position: "sticky", bottom: 0, zIndex: 2, background: bg, textAlign: "right", fontFamily: mono, color: accentInk, fontWeight: 900, fontSize: "0.9rem" }}>
                  {formatValue(grandTotal.rollups[i], v.field, v.agg)}
                </td>
              ))
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ─── TABLE LAYOUT RULES ──────────────────────────────────────────
   Four rules, and between them the table cannot break however many rows,
   columns or values are dropped into it:

   1. NOTHING WRAPS.  Every cell is `white-space: nowrap`. A header like
      "Σ Priemer · Cena s DPH (€)" used to fold onto a second line and shove
      the row heights out of alignment — that is the "goes to 2 rows in one".

   2. THE TABLE IS AS WIDE AS ITS CONTENT, NOT AS WIDE AS THE BOX.
      `width: max-content; min-width: 100%`. With plain `width: 100%` the
      browser squeezed columns to fit the panel, which is what forced the
      wrapping and the mid-word clipping. Now columns take the width they
      need and the surplus becomes a horizontal scrollbar INSIDE the panel —
      the page itself never spills sideways.

   3. THE ROW IDENTITY IS FROZEN.  The label and the count column are
      `position: sticky` on the left, so scrolling right never leaves you
      staring at a grid of numbers with nothing to name them. That is why the
      label column has a FIXED width: the count column's sticky offset has to
      be an exact number of pixels. The name inside ellipsises (full text on
      hover) instead of stretching the column.

   4. THE HEADER IS FROZEN TOO — both rows of it in cross-tab mode, the
      second one offset by the measured height of the first.

   Sticky + `border-collapse: collapse` is a broken pair in every engine
   (borders detach from the cell and float), so the table is
   `border-collapse: separate; border-spacing: 0` and the row rules live on
   the cells. Sticky cells must also be opaque or the content scrolls THROUGH
   them, hence `background: inherit` — it picks up the <tr>'s own colour, and
   keeps picking it up when the hover handler changes it. */
/* The two frozen columns' widths live in CSS variables declared on .pivot-scroll in
   the page's stylesheet — NOT inline here. An inline custom property would win over
   the media query and the columns would still be 300px wide on a 375px phone. The
   count column's sticky offset IS the label width, which is exactly why the label
   column is a fixed size rather than content-sized. */

const th = {
  padding: "0.65rem 0.75rem", fontWeight: 700,
  borderBottom: `1px solid ${border}`,
  whiteSpace: "nowrap",
  background: "var(--surface-2)",   // a sticky cell must paint its own background
};
const td = {
  padding: "0.45rem 0.75rem", borderBottom: "none",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",   // digits line up column-wise
};
/* Frozen-pane styles. `zBase` keeps the header's corner cells above the body's. */
/* The Σ row's own top rule — again on the cells, not the <tr>. */
const totalRule = { borderTop: `2px solid color-mix(in srgb, var(--accent) 40%, transparent)` };
const stickyLeft = (which, zBase, opaque) => {
  const isCount = which === "count";
  const w = isCount ? "var(--pv-count-w)" : "var(--pv-label-w)";
  return {
    position: "sticky",
    left: isCount ? "var(--pv-label-w)" : 0,
    zIndex: zBase,
    background: opaque || "inherit",
    width: w, minWidth: w, maxWidth: w,
    // Only the outer edge of the frozen pair casts the shadow that says
    // "there is more table to the right of this".
    ...(isCount ? { boxShadow: "8px 0 10px -8px rgba(0,0,0,0.55)" } : null),
  };
};


/* ═══════════════════════════════════════════════════════════════════
   PIVOT CHART
   ═══════════════════════════════════════════════════════════════════

   A small SVG-only chart panel that renders the same data the pivot
   table is showing. Reads the top-level rows of the tree (level 0,
   first row dimension) and turns them into a bar / stacked-bar / line
   / pie / heatmap. No third-party charting lib — everything is plain
   <svg>, styled with the same green/orange palette as the rest of
   the app, so bundle size doesn't grow.

   Why these five chart types:
     · bar        — universal default for "compare a value across
                    categories" (e.g. avg €/m² per district).
     · stacked    — when there's a cross-tab column dimension, each
                    bar is segmented by colKey (e.g. unit count per
                    district, segmented by stav V/P/R).
     · line       — for ordinal row dimensions (snapshot_month, izby,
                    poschodie). Reads like a trend.
     · pie        — when the measure is additive (count / sum) AND
                    there are ≤ 8 categories. Communicates share-of-
                    total better than bars at small cardinality. We
                    block it for avg / median / min / max — adding
                    averages in a pie is meaningless.
     · heatmap    — for cross-tab where both row and col have many
                    values (e.g. district × izby with avg €/m²).
                    Encodes value as cell brightness.

   Auto-detect logic (chartType === 'auto'):
     · cross-tab present → 'stacked' (or 'heatmap' if many cols)
     · row dim is snapshot_month → 'line'
     · row dim is ordinal numeric (izby/poschodie) → 'line'
     · ≤ 8 categories + additive measure → keep 'bar' default
                    (pie is opt-in via the picker)
     · otherwise → 'bar'

   Truncation:
     · top 20 rows by absolute value, "+N more" indicator. The
       table shows everything; the chart's job is the eyeball-level
       comparison, which falls apart past ~20 bars.

   Edge cases handled:
     · 0 records / 0 rows → shows "Drag a field to see chart"
     · all values null/zero → "No values to chart yet"
     · 2+ values defined → user picks which one via dropdown (no
       grouped-bar — gets visually noisy fast)
     · negative values (rare in our domain) → handled by signed
       Y-axis; bars below zero work as expected
*/

const CHART_PALETTE = [
  "var(--accent)", "#f5a623", "#4a90e2", "#ff6b6b",
  "#9b59b6", "#1abc9c", "#e84393", "#fab1a0",
  "#74b9ff", "#a29bfe", "#fdcb6e", "#55efc4",
];

function PivotChart({ tree, rowFields, colFields: _colFields, effectiveValues, onSelect, lang }) {
  const [collapsed, setCollapsed] = useState(false);
  const [chartType, setChartType] = useState("auto");
  const [valueIdx, setValueIdx] = useState(0);

  // Reset valueIdx if the user removes the value it points to.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (valueIdx >= effectiveValues.length) setValueIdx(0);
  }, [effectiveValues.length, valueIdx]);

  // Persist the chart's view choices (type / which measure / folded) per-account,
  // across devices — alongside the pivot config itself. A stale valueIdx that points
  // past the current values is harmlessly re-clamped to 0 by the effect above.
  useAccountPrefState(
    "pivotChart",
    { chartType, valueIdx, collapsed },
    (s) => {
      if (typeof s.chartType === "string") setChartType(s.chartType);
      if (typeof s.valueIdx === "number") setValueIdx(s.valueIdx);
      if (typeof s.collapsed === "boolean") setCollapsed(s.collapsed);
    },
  );

  // Top-level rows = the first row dimension's groups. The chart is
  // intentionally one level deep — nested rollups would need a tree-
  // map / sunburst to be readable, and the table already shows the
  // hierarchy. Filter out nodes with no usable value.
  const topRows = (tree.children || []);
  const colKeys = tree.colKeys || null;
  const measure = effectiveValues[Math.min(valueIdx, effectiveValues.length - 1)];
  const measureField = measure?.field || null;
  const measureAgg = measure?.agg || "count";

  // Decide auto-default chart type based on shape.
  const rowFieldKey = rowFields[0] || null;
  const isOrdinalRow = rowFieldKey === "snapshot_month"
    || rowFieldKey === "datum"
    || rowFieldKey === "batch_timestamp"
    || rowFieldKey === "izby"
    || rowFieldKey === "poschodie";
  const isAdditiveAgg = measureAgg === "count"
    || measureAgg === "count_distinct"
    || measureAgg === "sum";

  const autoType = (() => {
    if (colKeys && colKeys.length > 0) {
      // Cross-tab: stacked is the natural default. Heatmap takes over
      // if both row and col have lots of values (table-of-numbers).
      if (colKeys.length >= 6 && topRows.length >= 6) return "heatmap";
      return "stacked";
    }
    if (isOrdinalRow) return "line";
    return "bar";
  })();

  const effectiveType = chartType === "auto" ? autoType : chartType;

  // Pie is only valid for additive aggregates with reasonable cardinality.
  const pieAvailable = isAdditiveAgg && topRows.length > 0 && topRows.length <= 12;
  // Heatmap needs a col dimension.
  const heatmapAvailable = !!(colKeys && colKeys.length > 0);
  // Stacked needs a col dimension.
  const stackedAvailable = !!(colKeys && colKeys.length > 0);

  // ── Empty / unchartable states ────────────────────────────────
  if (rowFields.length === 0) {
    return (
      <ChartHeader collapsed={collapsed} setCollapsed={setCollapsed} lang={lang}>
        <div style={{ padding: "1.25rem", color: dim, fontSize: "0.82rem", textAlign: "center", fontStyle: "italic" }}>
          {lang === "sk"
            ? "Pretiahni pole do Riadkov aby sa zobrazil graf."
            : "Drag a field into Rows to see the chart."}
        </div>
      </ChartHeader>
    );
  }

  // Collect numeric value for each top-level row (for non-stacked).
  // pathKey carries through so chart clicks can find the matching <tr>
  // in the table via the data-pathkey attribute.
  const dataPoints = topRows
    .map((node, i) => ({
      label: node.label || "—",
      pathKey: node.pathKey,
      value: node.rollups?.[valueIdx] ?? null,
      colRollups: node.colRollups || null,
      origIdx: i,
    }))
    .filter(d => d.value != null && Number.isFinite(d.value));

  if (dataPoints.length === 0) {
    return (
      <ChartHeader collapsed={collapsed} setCollapsed={setCollapsed} lang={lang}>
        <div style={{ padding: "1.25rem", color: dim, fontSize: "0.82rem", textAlign: "center", fontStyle: "italic" }}>
          {lang === "sk"
            ? "Žiadne hodnoty na zobrazenie. Skús inú mieru alebo upravi filtre."
            : "No values to plot. Try a different measure or adjust filters."}
        </div>
      </ChartHeader>
    );
  }

  // Sort + truncate to top 20 by |value|. Preserve original order if
  // the row dim is ordinal (line / months should stay in chronological
  // order).
  const TRUNCATE = 20;
  const sortedData = isOrdinalRow
    ? dataPoints  // keep tree order (already sorted by value or label)
    : [...dataPoints].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const truncated = sortedData.slice(0, TRUNCATE);
  const hiddenCount = sortedData.length - truncated.length;

  // Render
  return (
    <ChartHeader collapsed={collapsed} setCollapsed={setCollapsed} lang={lang}>
      <div style={{ padding: "0.85rem 1rem 1rem" }}>
        {/* Toolbar: chart type + which measure */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center",
          marginBottom: "0.85rem", fontSize: "0.75rem", color: dim,
        }}>
          <span style={{ fontFamily: mono, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "0.65rem" }}>
            {lang === "sk" ? "Typ" : "Type"}
          </span>
          <ChartTypeBtn active={chartType === "auto"}    onClick={() => setChartType("auto")}    label={`Auto (${labelForType(autoType, lang)})`} />
          <ChartTypeBtn active={chartType === "bar"}     onClick={() => setChartType("bar")}     label={lang === "sk" ? "Stĺpce" : "Bar"} />
          {stackedAvailable && (
            <ChartTypeBtn active={chartType === "stacked"} onClick={() => setChartType("stacked")} label={lang === "sk" ? "Skladané" : "Stacked"} />
          )}
          <ChartTypeBtn active={chartType === "line"}    onClick={() => setChartType("line")}    label={lang === "sk" ? "Čiarový" : "Line"} />
          {pieAvailable && (
            <ChartTypeBtn active={chartType === "pie"} onClick={() => setChartType("pie")} label={lang === "sk" ? "Koláč" : "Pie"} />
          )}
          {heatmapAvailable && (
            <ChartTypeBtn active={chartType === "heatmap"} onClick={() => setChartType("heatmap")} label={lang === "sk" ? "Heatmapa" : "Heatmap"} />
          )}
          {effectiveValues.length > 1 && (
            <>
              <span style={{ marginLeft: "0.5rem", fontFamily: mono, letterSpacing: "0.04em", textTransform: "uppercase", fontSize: "0.65rem" }}>
                {lang === "sk" ? "Miera" : "Measure"}
              </span>
              <Picker
                value={valueIdx}
                onChange={(v) => setValueIdx(Number(v))}
                width={170}
                sk={lang === "sk"}
                ariaLabel={lang === "sk" ? "Miera" : "Measure"}
                options={effectiveValues.map((v, i) => ({ value: i, label: labelForMeasure(v, lang) }))}
              />
            </>
          )}
          {hiddenCount > 0 && (
            <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: orangeInk }}>
              {lang === "sk"
                ? `Top 20 z ${sortedData.length} (+${hiddenCount} ďalších v tabuľke)`
                : `Top 20 of ${sortedData.length} (+${hiddenCount} more in table)`}
            </span>
          )}
        </div>

        {/* Click affordance hint — small italic line above the chart so
            users know why elements have a pointer cursor. */}
        <div style={{
          fontSize: "0.7rem", color: dim, fontStyle: "italic",
          marginBottom: "0.4rem", letterSpacing: "0.01em",
        }}>
          {lang === "sk"
            ? "Klikni na časť grafu — zoskočí na zodpovedajúci riadok v tabuľke vyššie."
            : "Click any chart element — jumps to the matching row in the table above."}
        </div>

        {/* Chart body */}
        {effectiveType === "bar" && (
          <BarChartSVG data={truncated} measureField={measureField} measureAgg={measureAgg} onSelect={onSelect} lang={lang} />
        )}
        {effectiveType === "stacked" && stackedAvailable && (
          <StackedBarSVG data={truncated} colKeys={colKeys} valueIdx={valueIdx} measureField={measureField} measureAgg={measureAgg} onSelect={onSelect} lang={lang} />
        )}
        {effectiveType === "stacked" && !stackedAvailable && (
          <BarChartSVG data={truncated} measureField={measureField} measureAgg={measureAgg} onSelect={onSelect} lang={lang} />
        )}
        {effectiveType === "line" && (
          <LineChartSVG data={truncated} measureField={measureField} measureAgg={measureAgg} onSelect={onSelect} lang={lang} />
        )}
        {effectiveType === "pie" && pieAvailable && (
          <PieChartSVG data={truncated} measureField={measureField} measureAgg={measureAgg} onSelect={onSelect} lang={lang} />
        )}
        {effectiveType === "pie" && !pieAvailable && (
          <BarChartSVG data={truncated} measureField={measureField} measureAgg={measureAgg} onSelect={onSelect} lang={lang} />
        )}
        {effectiveType === "heatmap" && heatmapAvailable && (
          <HeatmapSVG topRows={topRows.slice(0, TRUNCATE)} colKeys={colKeys} valueIdx={valueIdx} measureField={measureField} measureAgg={measureAgg} onSelect={onSelect} lang={lang} />
        )}
        {effectiveType === "heatmap" && !heatmapAvailable && (
          <BarChartSVG data={truncated} measureField={measureField} measureAgg={measureAgg} onSelect={onSelect} lang={lang} />
        )}
      </div>
    </ChartHeader>
  );
}

function labelForType(t, lang) {
  const sk = { bar: "Stĺpce", stacked: "Skladané", line: "Čiarový", pie: "Koláč", heatmap: "Heatmapa" };
  const en = { bar: "Bar", stacked: "Stacked", line: "Line", pie: "Pie", heatmap: "Heatmap" };
  return (lang === "sk" ? sk : en)[t] || t;
}
function labelForMeasure(v, lang) {
  const f = FIELDS[v.field];
  const fname = f?.label || v.field || (lang === "sk" ? "počet" : "count");
  return `${aggLabel(v)}(${fname})`;
}

function ChartHeader({ collapsed, setCollapsed, lang, children }) {
  return (
    <div style={{
      marginTop: "1rem", border: `1px solid ${border}`, borderRadius: 10,
      background: panel, overflow: "hidden",
    }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: "100%", textAlign: "left", padding: "0.65rem 0.95rem",
          background: collapsed ? panel : panelHi,
          border: "none", borderBottom: collapsed ? "none" : `1px solid ${border}`,
          color: text, cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem",
          fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem",
        }}
      >
        <span style={{ fontSize: "0.7rem", color: accentInk, transition: "transform 0.15s", transform: collapsed ? "rotate(-90deg)" : "none" }}>▾</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="20" x2="12" y2="10"/>
          <line x1="18" y1="20" x2="18" y2="4"/>
          <line x1="6"  y1="20" x2="6"  y2="14"/>
        </svg>
        <span>{lang === "sk" ? "Graf" : "Chart"}</span>
      </button>
      {!collapsed && children}
    </div>
  );
}

function ChartTypeBtn({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
        border: `1px solid ${active ? green : border}`,
        color: active ? green : text,
        padding: "0.3rem 0.6rem", borderRadius: 6,
        fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

/* ── Chart helpers ────────────────────────────────────────────────

   shortNum(n)
     Compact integer-ish formatter for axis ticks: 5,500 → "5.5k",
     12,000 → "12k", 1,200,000 → "1.2M". Keeps the Y axis legible at
     the chart sizes we use (~880 viewBox px, ~9-11 px font) where
     "10 000 €/m²" overflows / overlaps neighbouring tick labels.
     The unit moves out of the per-tick label and into a single
     axis title so the tick column stays narrow.

   fieldUnit(key, agg)
     Returns the display unit for an axis title: "€", "€/m²", "m²",
     "" (counts). Reads from the FIELDS registry so a new field with
     a unit declaration "just works".

   ChartTooltip
     Floating box anchored to the mouse position via position:fixed.
     Replaces the always-on per-bar value labels which collided with
     each other + with the Y-axis ticks at any reasonable bar count.
     pointerEvents: "none" so the tooltip can never intercept the
     mouse leaving the bar — cursor moves through the box, hover
     handlers fire normally on neighbouring bars. */

function shortNum(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000) {
    const v = n / 1_000_000;
    return (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")) + "M";
  }
  if (a >= 1_000) {
    const v = n / 1_000;
    return (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")) + "k";
  }
  if (a >= 100) return Math.round(n).toString();
  if (a >= 1)   return (Math.round(n * 10) / 10).toString();
  return (Math.round(n * 100) / 100).toString();
}

function fieldUnit(fieldKey, agg) {
  if (!fieldKey) {
    // count / count_distinct → unitless
    return agg === "count" || agg === "count_distinct" ? "" : "";
  }
  const f = FIELDS[fieldKey];
  const u = f?.unit || "";
  // Money axis titles follow the display currency ("€" → "Kč", "€/m²" → "Kč/m²").
  return isMoneyUnit(u) ? displayMoneyUnit(u) : u;
}

/** Axis/heatmap tick formatter: convert EUR→display currency for money
 *  measures before compacting, so labels match the (converted) axis title.
 *  Non-money measures (counts, m², %) pass through unchanged. */
function axisTick(value, measureField) {
  const f = measureField ? FIELDS[measureField] : null;
  return shortNum(isMoneyUnit(f?.unit) ? moneyFromEur(value) : value);
}

/* formatValueWhole — tooltip-grade formatter that rounds to WHOLE
   units (no decimals) for everything except percentages, which keep
   one decimal because "33%" loses too much information vs. "33.4%".
   Rationale: hover tooltips are an "exact value" affordance — the
   user already sees the bar height as the relative shape; the
   number on hover should be the integer that's easy to read aloud.
   Different from formatValue() (used in tables + axis ticks) which
   keeps 1 decimal for averages/medians of small-range fields like
   izby/poschodie. Tooltips trade that precision for legibility. */
function formatValueWhole(value, fieldKey, agg) {
  if (value == null || !Number.isFinite(value)) return "—";
  // Count aggregations are dimensionless row counts — bare integer, no unit,
  // no currency conversion (mirrors formatValue so a count-of-€ tooltip never
  // reads "300 €/m²"). Must precede the money/% branches below.
  if (agg === "count" || agg === "count_distinct") {
    return Math.round(value).toLocaleString("en-US").replace(/,/g, " ");
  }
  const f = FIELDS[fieldKey];
  // Money fields store EUR — convert to the display currency + swap the unit.
  if (isMoneyUnit(f?.unit)) value = moneyFromEur(value);
  const unit = f?.unit ? ` ${isMoneyUnit(f.unit) ? displayMoneyUnit(f.unit) : f.unit}` : "";
  if (f?.unit === "%") {
    return `${(Math.round(value * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/,/g, " ")}${unit}`;
  }
  // counts, sums, averages, prices, areas, €/m² — all displayed as
  // whole-unit integers in tooltips (no "5965.6 €/m²", just "5 966").
  const rounded = Math.round(value);
  return `${rounded.toLocaleString("en-US").replace(/,/g, " ")}${unit}`;
}

/* ChartTooltip — floating box anchored to the mouse position via
   position:fixed. Rendered into document.body via a portal because
   parent transforms (the .page-transition wrapper has a transform-
   based fade animation that creates a containing block) would
   otherwise re-anchor "fixed" positioning to the local frame, and
   our viewport-pixel mouse coords would land in the wrong place
   (often offscreen). The portal sidesteps the entire stacking-
   context / containing-block problem by rendering at the body
   level. pointerEvents:"none" keeps the tooltip from intercepting
   mouse events when the cursor moves through it. */
function ChartTooltip({ mouseX, mouseY, lines, accentColor }) {
  if (mouseX == null || mouseY == null) return null;
  if (typeof document === "undefined") return null;
  // Offset 14px down-right from cursor; flip left if cursor near right edge.
  const flipLeft = typeof window !== "undefined" && mouseX > window.innerWidth - 240;
  const flipUp   = typeof window !== "undefined" && mouseY > window.innerHeight - 140;
  const node = (
    <div style={{
      position: "fixed",
      left: flipLeft ? mouseX - 14 : mouseX + 14,
      top:  flipUp   ? mouseY - 14 : mouseY + 14,
      transform: `${flipLeft ? "translateX(-100%) " : ""}${flipUp ? "translateY(-100%)" : ""}`.trim(),
      background: "var(--surface)",
      border: `1px solid ${accentColor || green}`,
      borderRadius: 6,
      padding: "0.55rem 0.8rem",
      fontFamily: mono,
      fontSize: "0.78rem",
      color: text,
      pointerEvents: "none",
      zIndex: 10000,
      boxShadow: "0 6px 18px rgba(0,0,0,0.55)",
      whiteSpace: "nowrap",
      maxWidth: 320,
    }}>
      {lines.map((line, i) => (
        <div key={i} style={{
          color: line.muted ? dim : (line.accent ? (accentColor || green) : text),
          fontWeight: line.bold ? 600 : (line.accent ? 700 : 400),
          marginTop: i > 0 ? "0.22rem" : 0,
          fontSize: line.small ? "0.7rem" : (line.accent ? "0.92rem" : undefined),
        }}>
          {line.text}
        </div>
      ))}
    </div>
  );
  return createPortal(node, document.body);
}

/* ── BarChartSVG ──────────────────────────────────────────────────
   Single-series vertical bars. Y axis auto-scales, gridlines at 4
   ticks. X labels rotate when too cramped (>8 bars). Each bar carries
   the row's pathKey via onSelect — clicking jumps to the table row.
   Hover shows a floating tooltip with the full value (replaces the
   per-bar always-on labels which collided at any reasonable bar
   count). */
function BarChartSVG({ data, measureField, measureAgg, onSelect, lang }) {
  const W = 880, H = 340;
  // Wider left padding gives the (now-narrower) Y-axis tick column
  // breathing room; the unit label moves into a small axis title at
  // the top so the per-tick row stays just "5k", "10k", etc.
  const padL = 56, padR = 16, padT = 32, padB = data.length > 8 ? 110 : 64;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;

  const minVal = Math.min(0, ...data.map(d => d.value));  // include 0 baseline
  const maxVal = Math.max(0, ...data.map(d => d.value));
  const range = maxVal - minVal || 1;
  const yScale = (v) => padT + innerH - ((v - minVal) / range) * innerH;
  const barW = Math.max(2, (innerW / n) * 0.72);
  const xCenter = (i) => padL + (innerW / n) * (i + 0.5);

  const ticks = makeTicks(minVal, maxVal, 4);
  const rotate = n > 8;
  const unit = fieldUnit(measureField, measureAgg);

  // Hover state — replaces the always-on per-bar text labels which
  // overlapped each other + the Y axis. mouseX/mouseY in viewport
  // (page) coords so the floating tooltip can position with
  // position:fixed.
  const [hover, setHover] = useState(null);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
        {/* Y-axis title — shows the unit ONCE so each tick can be a
            short number ("5k", "10k") instead of "5 000 €/m²". */}
        {unit && (
          <text x={padL} y={padT - 14} fill={dim} fontSize="10" textAnchor="start" fontFamily={mono}>
            {unit}
          </text>
        )}
        {/* gridlines + Y labels (compact) */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yScale(t)} y2={yScale(t)} stroke={border} strokeDasharray="2,3"/>
            <text x={padL - 6} y={yScale(t)} fill={text} fontSize="10" textAnchor="end" dominantBaseline="middle" fontFamily={mono}>
              {axisTick(t, measureField)}
            </text>
          </g>
        ))}
        {/* zero baseline emphasis */}
        {minVal < 0 && (
          <line x1={padL} x2={W - padR} y1={yScale(0)} y2={yScale(0)} stroke={dim} strokeWidth="1"/>
        )}
        {/* bars */}
        {data.map((d, i) => {
          const y0 = yScale(0);
          const y1 = yScale(d.value);
          const top = Math.min(y0, y1);
          const h = Math.abs(y1 - y0);
          const onClick = () => onSelect && onSelect(d.pathKey);
          const onEnter = (e) => setHover({ d, mouseX: e.clientX, mouseY: e.clientY });
          const onMove  = (e) => setHover(h0 => h0 ? { ...h0, mouseX: e.clientX, mouseY: e.clientY } : h0);
          const onLeave = () => setHover(null);
          const isHovered = hover && hover.d === d;
          return (
            <g key={i}
               className="pivot-chart-target"
               onClick={onClick}
               onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}>
              {/* Invisible wider hit area so thin bars are still easy to click + hover */}
              <rect x={xCenter(i) - Math.max(barW, 18) / 2} y={padT}
                    width={Math.max(barW, 18)} height={innerH}
                    fill="transparent"/>
              <rect x={xCenter(i) - barW / 2} y={top} width={barW} height={h}
                    fill={green} opacity={isHovered ? 1 : 0.85} rx="2"
                    stroke={isHovered ? green : "transparent"} strokeWidth="1.5" />
            </g>
          );
        })}
        {/* X labels — clickable so even very short bars are still navigable */}
        {data.map((d, i) => {
          const x = xCenter(i);
          const y = padT + innerH + 16;
          const truncated = d.label.length > 18 ? d.label.slice(0, 17) + "…" : d.label;
          const onClick = () => onSelect && onSelect(d.pathKey);
          return (
            <text
              key={i} x={x} y={y} fill={text} fontSize="11"
              textAnchor={rotate ? "end" : "middle"} fontFamily={mono}
              transform={rotate ? `rotate(-35 ${x} ${y})` : undefined}
              className="pivot-chart-target"
              onClick={onClick}
            >
              <title>{d.label}</title>
              {truncated}
            </text>
          );
        })}
      </svg>
      {hover && (
        <ChartTooltip
          mouseX={hover.mouseX} mouseY={hover.mouseY}
          lines={[
            { text: hover.d.label, bold: true },
            { text: formatValueWhole(hover.d.value, measureField, measureAgg), accent: true },
            { text: lang === "sk" ? "klik → riadok v tabuľke" : "click → row in table", muted: true, small: true },
          ]}
        />
      )}
    </div>
  );
}

/* ── StackedBarSVG ────────────────────────────────────────────────
   For cross-tab: each row → one bar, segmented by colKey. Each colKey
   gets a distinct palette colour. Click a segment → flash the matching
   (row, colKey) cell in the table. Click outside any segment (X label)
   → flash just the row. */
function StackedBarSVG({ data, colKeys, valueIdx, measureField, measureAgg, onSelect, lang }) {
  const W = 880, H = 380;
  const padL = 56, padR = 16, padT = 32, padB = data.length > 8 ? 144 : 104;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;

  // Per-bar stack values: [colKey, value], filter nulls.
  const stacks = data.map(d => {
    const segs = colKeys.map(ck => {
      const rollup = d.colRollups?.[ck];
      const v = rollup?.[valueIdx];
      return { colKey: ck, value: Number.isFinite(v) ? v : 0 };
    });
    const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0);
    return { ...d, segs, total };
  });

  const maxTotal = Math.max(0, ...stacks.map(s => s.total)) || 1;
  const yScale = (v) => padT + innerH - (v / maxTotal) * innerH;
  const barW = Math.max(2, (innerW / n) * 0.72);
  const xCenter = (i) => padL + (innerW / n) * (i + 0.5);

  const ticks = makeTicks(0, maxTotal, 4);
  const rotate = n > 8;
  const legendY = padT + innerH + (rotate ? 84 : 44);
  const unit = fieldUnit(measureField, measureAgg);

  // Hover state for floating tooltip — segments AND row labels.
  const [hover, setHover] = useState(null);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
        {unit && (
          <text x={padL} y={padT - 14} fill={dim} fontSize="10" textAnchor="start" fontFamily={mono}>
            {unit}
          </text>
        )}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yScale(t)} y2={yScale(t)} stroke={border} strokeDasharray="2,3"/>
            <text x={padL - 6} y={yScale(t)} fill={text} fontSize="10" textAnchor="end" dominantBaseline="middle" fontFamily={mono}>
              {axisTick(t, measureField)}
            </text>
          </g>
        ))}
        {/* segments — each is clickable + hoverable */}
        {stacks.map((s, i) => {
          let cumY = yScale(0);
          return (
            <g key={i}>
              {s.segs.map((seg, j) => {
                if (seg.value <= 0) return null;
                const yTop = yScale(s.segs.slice(0, j + 1).reduce((a, x) => a + Math.max(0, x.value), 0));
                const h = cumY - yTop;
                cumY = yTop;
                const fill = CHART_PALETTE[j % CHART_PALETTE.length];
                const onClick = () => onSelect && onSelect(s.pathKey, seg.colKey);
                const onEnter = (e) => setHover({ s, seg, fill, mouseX: e.clientX, mouseY: e.clientY });
                const onMove  = (e) => setHover(h0 => h0 ? { ...h0, mouseX: e.clientX, mouseY: e.clientY } : h0);
                const onLeave = () => setHover(null);
                const isHovered = hover && hover.s === s && hover.seg === seg;
                return (
                  <rect
                    key={j} x={xCenter(i) - barW / 2} y={yTop} width={barW} height={h}
                    fill={fill} opacity={isHovered ? 1 : 0.88}
                    stroke={isHovered ? fill : "transparent"} strokeWidth="1.5"
                    className="pivot-chart-target" onClick={onClick}
                    onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}
                  />
                );
              })}
            </g>
          );
        })}
        {/* X labels */}
        {data.map((d, i) => {
          const x = xCenter(i);
          const y = padT + innerH + 16;
          const truncated = d.label.length > 18 ? d.label.slice(0, 17) + "…" : d.label;
          const onClick = () => onSelect && onSelect(d.pathKey);
          return (
            <text
              key={i} x={x} y={y} fill={text} fontSize="11"
              textAnchor={rotate ? "end" : "middle"} fontFamily={mono}
              transform={rotate ? `rotate(-35 ${x} ${y})` : undefined}
              className="pivot-chart-target"
              onClick={onClick}
            >
              <title>{d.label}</title>
              {truncated}
            </text>
          );
        })}
        {/* Legend */}
        {colKeys.map((ck, j) => {
          const cols = Math.max(1, Math.floor((W - padL - padR) / 140));
          const row = Math.floor(j / cols);
          const col = j % cols;
          const x = padL + col * 140;
          const y = legendY + row * 18;
          if (y + 12 > H) return null;
          const fill = CHART_PALETTE[j % CHART_PALETTE.length];
          const ckText = String(ck);
          const truncated = ckText.length > 18 ? ckText.slice(0, 17) + "…" : ckText;
          return (
            <g key={j}>
              <rect x={x} y={y - 9} width={12} height={12} fill={fill} rx="2"/>
              <text x={x + 18} y={y} fill={text} fontSize="11" dominantBaseline="middle" fontFamily={mono}>
                <title>{ckText}</title>
                {truncated}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <ChartTooltip
          mouseX={hover.mouseX} mouseY={hover.mouseY}
          accentColor={hover.fill}
          lines={[
            { text: hover.s.label, bold: true },
            { text: `${hover.seg.colKey}: ${formatValueWhole(hover.seg.value, measureField, measureAgg)}`, accent: true },
            { text: `${lang === "sk" ? "Spolu" : "Total"}: ${formatValueWhole(hover.s.total, measureField, measureAgg)}`, muted: true, small: true },
            { text: lang === "sk" ? "klik → bunka v tabuľke" : "click → cell in table", muted: true, small: true },
          ]}
        />
      )}
    </div>
  );
}

/* ── LineChartSVG ─────────────────────────────────────────────────
   Single line with circle markers. Useful for time / ordinal rows.
   Each marker is clickable + has a wider invisible hit-area so users
   don't have to aim for a 4-px dot. */
function LineChartSVG({ data, measureField, measureAgg, onSelect, lang }) {
  const W = 880, H = 340;
  const padL = 56, padR = 16, padT = 32, padB = data.length > 8 ? 110 : 64;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;

  const minVal = Math.min(0, ...data.map(d => d.value));
  const maxVal = Math.max(0, ...data.map(d => d.value));
  const range = maxVal - minVal || 1;
  const yScale = (v) => padT + innerH - ((v - minVal) / range) * innerH;
  const xPos = (i) => padL + (n === 1 ? innerW / 2 : (innerW / (n - 1)) * i);

  const ticks = makeTicks(minVal, maxVal, 4);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xPos(i)} ${yScale(d.value)}`).join(" ");
  const rotate = n > 8;
  const unit = fieldUnit(measureField, measureAgg);

  const [hover, setHover] = useState(null);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
        {unit && (
          <text x={padL} y={padT - 14} fill={dim} fontSize="10" textAnchor="start" fontFamily={mono}>
            {unit}
          </text>
        )}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yScale(t)} y2={yScale(t)} stroke={border} strokeDasharray="2,3"/>
            <text x={padL - 6} y={yScale(t)} fill={text} fontSize="10" textAnchor="end" dominantBaseline="middle" fontFamily={mono}>
              {axisTick(t, measureField)}
            </text>
          </g>
        ))}
        <path d={path} stroke={green} strokeWidth="2.5" fill="none"/>
        {data.map((d, i) => {
          const onClick = () => onSelect && onSelect(d.pathKey);
          const onEnter = (e) => setHover({ d, mouseX: e.clientX, mouseY: e.clientY });
          const onMove  = (e) => setHover(h0 => h0 ? { ...h0, mouseX: e.clientX, mouseY: e.clientY } : h0);
          const onLeave = () => setHover(null);
          const isHovered = hover && hover.d === d;
          return (
            <g key={i}
               className="pivot-chart-target"
               onClick={onClick}
               onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}>
              {/* Wider invisible hit area so 5-px dots are still easy targets */}
              <circle cx={xPos(i)} cy={yScale(d.value)} r="14" fill="transparent"/>
              <circle cx={xPos(i)} cy={yScale(d.value)} r={isHovered ? 7 : 5}
                      fill={green} stroke={bg} strokeWidth="1.5"/>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = xPos(i);
          const y = padT + innerH + 16;
          const truncated = d.label.length > 18 ? d.label.slice(0, 17) + "…" : d.label;
          const onClick = () => onSelect && onSelect(d.pathKey);
          return (
            <text
              key={i} x={x} y={y} fill={text} fontSize="11"
              textAnchor={rotate ? "end" : "middle"} fontFamily={mono}
              transform={rotate ? `rotate(-35 ${x} ${y})` : undefined}
              className="pivot-chart-target"
              onClick={onClick}
            >
              <title>{d.label}</title>
              {truncated}
            </text>
          );
        })}
      </svg>
      {hover && (
        <ChartTooltip
          mouseX={hover.mouseX} mouseY={hover.mouseY}
          lines={[
            { text: hover.d.label, bold: true },
            { text: formatValueWhole(hover.d.value, measureField, measureAgg), accent: true },
            { text: lang === "sk" ? "klik → riadok v tabuľke" : "click → row in table", muted: true, small: true },
          ]}
        />
      )}
    </div>
  );
}

/* ── PieChartSVG ──────────────────────────────────────────────────
   Donut with slice labels. Only enabled for additive measures + ≤ 12
   slices. Each slice is clickable; legend rows are too. */
function PieChartSVG({ data, measureField, measureAgg, onSelect, lang }) {
  const W = 880, H = 380;
  const cx = 240, cy = H / 2;
  const rOuter = 140, rInner = 64;

  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0);
  const [hover, setHover] = useState(null);

  if (total <= 0) {
    return <div style={{ padding: "1rem", color: dim, fontSize: "0.82rem", fontStyle: "italic" }}>
      {lang === "sk" ? "Súčet hodnôt = 0; koláč nemá zmysel." : "Total = 0; pie chart not meaningful."}
    </div>;
  }
  // Build slices via prefix sums so the linter's react-hooks/immutability
  // rule doesn't flag the running accumulator. Functionally identical to
  // the previous `let acc; data.map(...)` shape — each slice carries the
  // angular start/end of its arc.
  const cumulative = [0];
  for (let i = 0; i < data.length; i++) {
    cumulative.push(cumulative[i] + Math.max(0, data[i].value));
  }
  const slices = data.map((d, i) => {
    const v = Math.max(0, d.value);
    const startAng = (cumulative[i]     / total) * Math.PI * 2 - Math.PI / 2;
    const endAng   = (cumulative[i + 1] / total) * Math.PI * 2 - Math.PI / 2;
    return { ...d, startAng, endAng, share: v / total, fill: CHART_PALETTE[i % CHART_PALETTE.length] };
  });
  const arc = (s) => {
    const x0 = cx + rOuter * Math.cos(s.startAng);
    const y0 = cy + rOuter * Math.sin(s.startAng);
    const x1 = cx + rOuter * Math.cos(s.endAng);
    const y1 = cy + rOuter * Math.sin(s.endAng);
    const xi0 = cx + rInner * Math.cos(s.startAng);
    const yi0 = cy + rInner * Math.sin(s.startAng);
    const xi1 = cx + rInner * Math.cos(s.endAng);
    const yi1 = cy + rInner * Math.sin(s.endAng);
    const large = s.endAng - s.startAng > Math.PI ? 1 : 0;
    return [
      `M ${x0} ${y0}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
      `L ${xi1} ${yi1}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${xi0} ${yi0}`,
      "Z",
    ].join(" ");
  };

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {slices.map((s, i) => {
          const onClick = () => onSelect && onSelect(s.pathKey);
          const onEnter = (e) => setHover({ s, mouseX: e.clientX, mouseY: e.clientY });
          const onMove  = (e) => setHover(h0 => h0 ? { ...h0, mouseX: e.clientX, mouseY: e.clientY } : h0);
          const onLeave = () => setHover(null);
          const isHovered = hover && hover.s === s;
          return (
            <path
              key={i} d={arc(s)} fill={s.fill}
              opacity={isHovered ? 1 : 0.9}
              stroke={isHovered ? s.fill : "transparent"} strokeWidth="2"
              className="pivot-chart-target" onClick={onClick}
              onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}
            />
          );
        })}
        {/* Total label in donut hole */}
        <text x={cx} y={cy - 6} textAnchor="middle" fill={text} fontSize="15" fontWeight="700" fontFamily={mono}>
          {formatValue(total, measureField, measureAgg)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill={dim} fontSize="11" fontFamily={mono}>
          {lang === "sk" ? "spolu" : "total"}
        </text>
        {/* Legend right side */}
        {slices.map((s, i) => {
          const y = 36 + i * 24;
          if (y > H - 16) return null;
          const onClick = () => onSelect && onSelect(s.pathKey);
          const onEnter = (e) => setHover({ s, mouseX: e.clientX, mouseY: e.clientY });
          const onMove  = (e) => setHover(h0 => h0 ? { ...h0, mouseX: e.clientX, mouseY: e.clientY } : h0);
          const onLeave = () => setHover(null);
          return (
            <g key={i} className="pivot-chart-target" onClick={onClick}
               onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}>
              <rect x={W / 2 + 60} y={y - 9} width={14} height={14} fill={s.fill} rx="2"/>
              <text x={W / 2 + 80} y={y} fill={text} fontSize="12" dominantBaseline="middle" fontFamily={mono}>
                {(s.label.length > 22 ? s.label.slice(0, 21) + "…" : s.label)} — {(s.share * 100).toFixed(1)}%
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <ChartTooltip
          mouseX={hover.mouseX} mouseY={hover.mouseY}
          accentColor={hover.s.fill}
          lines={[
            { text: hover.s.label, bold: true },
            { text: `${formatValueWhole(hover.s.value, measureField, measureAgg)}  ·  ${(hover.s.share * 100).toFixed(1)}%`, accent: true },
            { text: lang === "sk" ? "klik → riadok v tabuľke" : "click → row in table", muted: true, small: true },
          ]}
        />
      )}
    </div>
  );
}

/* ── HeatmapSVG ───────────────────────────────────────────────────
   row × col grid with cell brightness encoding the value. Dim cells
   (null / 0) get a hatched look. Each cell is clickable → flashes the
   matching (row, colKey) cell in the table. Row labels are clickable
   too — flash the whole row. */
function HeatmapSVG({ topRows, colKeys, valueIdx, measureField, measureAgg, onSelect, lang }) {
  const W = 880, H = Math.max(240, 44 + topRows.length * 30 + 16);
  const padL = 220, padR = 16, padT = 44, padB = 16;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const cellW = innerW / Math.max(1, colKeys.length);
  const cellH = innerH / Math.max(1, topRows.length);

  // Find min/max across all valid cells.
  let minV = Infinity, maxV = -Infinity, anyValid = false;
  for (const row of topRows) {
    for (const ck of colKeys) {
      const v = row.colRollups?.[ck]?.[valueIdx];
      if (Number.isFinite(v)) {
        anyValid = true;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
  }
  if (!anyValid) { minV = 0; maxV = 1; }
  const range = (maxV - minV) || 1;

  // Color scale: low = panel bg, high = green. Linear interpolation.
  const colorFor = (v) => {
    if (!Number.isFinite(v)) return "transparent";
    const t = (v - minV) / range;
    const r = Math.round(0x14 + t * (0x00 - 0x14));
    const g = Math.round(0x14 + t * (0xe5 - 0x14));
    const b = Math.round(0x1a + t * (0xa0 - 0x1a));
    return `rgb(${r},${g},${b})`;
  };
  const textColorFor = (v) => {
    if (!Number.isFinite(v)) return dim;
    const t = (v - minV) / range;
    return t > 0.55 ? "var(--bg)" : text;
  };

  // Hover state — covers both row labels and cells.
  const [hover, setHover] = useState(null);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
        {/* col headers */}
        {colKeys.map((ck, j) => {
          const x = padL + j * cellW + cellW / 2;
          const ckText = String(ck);
          const truncated = ckText.length > 14 ? ckText.slice(0, 13) + "…" : ckText;
          return (
            <text key={j} x={x} y={padT - 8} fill={text} fontSize="11" fontWeight="600" textAnchor="middle" fontFamily={mono}>
              <title>{ckText}</title>
              {truncated}
            </text>
          );
        })}
        {/* rows */}
        {topRows.map((row, i) => {
          const y = padT + i * cellH;
          const rowText = String(row.label || "—");
          const truncated = rowText.length > 28 ? rowText.slice(0, 27) + "…" : rowText;
          const onRowClick = () => onSelect && onSelect(row.pathKey);
          return (
            <g key={i}>
              <text
                x={padL - 8} y={y + cellH / 2} fill={text} fontSize="11" fontWeight="500"
                textAnchor="end" dominantBaseline="middle" fontFamily={mono}
                className="pivot-chart-target"
                onClick={onRowClick}
              >
                <title>{rowText + (lang === "sk" ? "\n(klik → riadok v tabuľke)" : "\n(click → row in table)")}</title>
                {truncated}
              </text>
              {colKeys.map((ck, j) => {
                const v = row.colRollups?.[ck]?.[valueIdx];
                const x = padL + j * cellW;
                const onCellClick = () => onSelect && onSelect(row.pathKey, ck);
                const onEnter = (e) => setHover({ row, ck, v, mouseX: e.clientX, mouseY: e.clientY });
                const onMove  = (e) => setHover(h0 => h0 ? { ...h0, mouseX: e.clientX, mouseY: e.clientY } : h0);
                const onLeave = () => setHover(null);
                const isHovered = hover && hover.row === row && hover.ck === ck;
                return (
                  <g key={j}
                     className="pivot-chart-target"
                     onClick={onCellClick}
                     onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}>
                    <rect
                      x={x + 1} y={y + 1} width={cellW - 2} height={cellH - 2}
                      fill={colorFor(v)}
                      stroke={isHovered ? green : border}
                      strokeWidth={isHovered ? "1.5" : "0.5"}
                    />
                    {Number.isFinite(v) && cellW > 42 && (
                      <text x={x + cellW / 2} y={y + cellH / 2} fill={textColorFor(v)} fontSize="10" fontWeight="600" textAnchor="middle" dominantBaseline="middle" fontFamily={mono} pointerEvents="none">
                        {axisTick(v, measureField)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover && (
        <ChartTooltip
          mouseX={hover.mouseX} mouseY={hover.mouseY}
          lines={[
            { text: hover.row.label || "—", bold: true },
            { text: `${hover.ck}: ${formatValueWhole(hover.v, measureField, measureAgg)}`, accent: true },
            { text: lang === "sk" ? "klik → bunka v tabuľke" : "click → cell in table", muted: true, small: true },
          ]}
        />
      )}
    </div>
  );
}

/* Make 4-5 evenly-spaced "nice" tick values for a numeric axis.
   Picks a step from {1,2,2.5,5}×10^k that lands ~targetCount ticks
   between min and max. Returns sorted ascending including 0 if the
   range crosses zero. */
function makeTicks(min, max, targetCount = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }
  const span = max - min;
  const rough = span / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const niceMul = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const step = niceMul * mag;
  const startTick = Math.ceil(min / step) * step;
  const endTick = Math.floor(max / step) * step;
  const ticks = [];
  for (let v = startTick; v <= endTick + 1e-9; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  // Always include the actual min/max as boundary if they're not on the grid
  if (ticks[0] > min) ticks.unshift(min);
  if (ticks[ticks.length - 1] < max) ticks.push(max);
  return ticks;
}


/* ─── FILTER POPOVER ─────────────────────────────────────────────
   Floats next to the clicked filter chip. Two render modes driven by
   the field type:
     · text / date → checkbox list of distinct values + include/exclude
     · number      → range inputs + "include (prázdne)" toggle + optional
                     checkbox list when cardinality is small (<=40).
   Closes on Esc / outside click.                                   */
function FilterPopover({ fieldKey, filter, anchorEl, records, distinctOverride = null, statsOverride = null, loading = false, fellBack = false, otherFilterCount = 0, onChange, onClear, onClose, lang }) {
  const field = FIELDS[fieldKey];
  // Money range filters are stored + compared in EUR (analytics engine + records
  // both use price_s_dph_eur), and report_field_stats now returns EUR bounds. But
  // the input the user SEES/types follows the currency toggle. So convert at the
  // edges only: EUR→display for hints/inputs, display→EUR on apply. Non-money
  // fields (area/rooms/floor) pass through unchanged.
  const isMoney = isMoneyUnit(field?.unit);
  const eurToDisp = (v) => (isMoney && Number.isFinite(Number(v))) ? moneyFromEur(Number(v)) : v;
  const dispToEur = (v) => { if (!isMoney || !Number.isFinite(Number(v))) return v; const rate = moneyFromEur(1) || 1; return Number(v) / rate; };
  const computed = useMemo(
    () => distinctValuesForField(records, fieldKey),
    [records, fieldKey]
  );
  // Server-side fast paths override the records-derived list:
  //  · distinctOverride (grain) → categorical value checkboxes ("in" mode).
  //  · statsOverride (report_field_stats) → numeric range bounds ("between" mode),
  //    no value list; nNull drives the "(prázdne)" toggle + the "X bez hodnoty" note.
  let distinct, hasEmpty, isNumber, stats;
  if (distinctOverride) {
    distinct = distinctOverride.values; hasEmpty = distinctOverride.hasEmpty; isNumber = false; stats = null;
  } else if (statsOverride) {
    distinct = EMPTY_RECORDS; isNumber = true;
    hasEmpty = (statsOverride.nNull || 0) > 0;
    stats = statsOverride.min == null ? null
      : { min: statsOverride.min, max: statsOverride.max, median: statsOverride.median,
          count: statsOverride.count, distinct: 0, nNull: statsOverride.nNull };
  } else {
    ({ values: distinct, hasEmpty, isNumber, stats } = computed);
  }

  // Local draft state so Apply commits and Cancel discards
  const initialMode = filter?.mode || (isNumber ? "between" : "in");
  const [mode, setMode]           = useState(initialMode);
  const [selected, setSelected]   = useState(() => new Set(filter?.values || []));
  const dispInit = (v) => v == null ? "" : String(isMoney ? Math.round(eurToDisp(v)) : v);
  const [minV, setMinV]           = useState(dispInit(filter?.min));
  const [maxV, setMaxV]           = useState(dispInit(filter?.max));
  const [inclEmpty, setInclEmpty] = useState(!!filter?.includeEmpty);
  const [search, setSearch]       = useState("");

  // Re-sync if user re-opens on a different field
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMode(filter?.mode || (isNumber ? "between" : "in"));
    setSelected(new Set(filter?.values || []));
    setMinV(dispInit(filter?.min));
    setMaxV(dispInit(filter?.max));
    setInclEmpty(!!filter?.includeEmpty);
    setSearch("");
  }, [fieldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  // Close on outside click / Esc
  useEffect(() => {
    const onDown = (e) => {
      const pop = document.getElementById("pivotv2-filter-pop");
      if (!pop) return;
      if (pop.contains(e.target)) return;
      if (anchorEl && anchorEl.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorEl, onClose]);

  // Anchor positioning — absolute (document-relative), not fixed
  // (viewport-relative). With fixed, the popover stayed glued to the
  // viewport while the page scrolled, making it impossible to reach
  // the bottom of a tall popover on a short viewport (user reported:
  // "okno je stuck s obrazovkou, nikdy sa neviem dostať na spodok").
  // Absolute positioning pins the popover under the cell that opened
  // it, so scrolling the page scrolls the popover together with the
  // cell — natural, predictable, and the user can scroll past the
  // popover's bottom if it overflows the viewport.
  //
  // Flip-above logic: when there isn't room below the cell (within
  // the CURRENT viewport) but there is room above, flip. Coordinates
  // still need window.scrollX/Y added because rect is viewport-local
  // while absolute positioning is document-local.
  const rect = anchorEl?.getBoundingClientRect();
  const popW = Math.min(360, (typeof window !== "undefined" ? window.innerWidth : 400) - 16);
  const popMaxH = Math.min(560, Math.floor((typeof window !== "undefined" ? window.innerHeight : 600) * 0.75));
  const style = (() => {
    if (!rect) return { display: "none" };
    const scrollX = typeof window !== "undefined" ? (window.scrollX || window.pageXOffset || 0) : 0;
    const scrollY = typeof window !== "undefined" ? (window.scrollY || window.pageYOffset || 0) : 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipAbove  = spaceBelow < popMaxH && rect.top > popMaxH;
    const top  = flipAbove
      ? Math.max(scrollY + 8, scrollY + rect.top - popMaxH - 8)
      : scrollY + rect.bottom + 8;
    const left = Math.max(scrollX + 8, Math.min(scrollX + rect.left, scrollX + window.innerWidth - popW - 8));
    return { position: "absolute", top, left, zIndex: 1000 };
  })();

  const q = search.trim().toLowerCase();
  const shown = q ? distinct.filter(v => String(v).toLowerCase().includes(q)) : distinct;

  const toggle = (v) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(v)) n.delete(v); else n.add(v);
      return n;
    });
  };

  const apply = () => {
    const modeIsRange = isNumber && mode === "between";
    const modeIsValueList = mode === "in" || mode === "not_in";
    if (mode === "empty" || mode === "not_empty") {
      onChange({ mode, values: [], min: null, max: null });
    } else if (modeIsRange) {
      const min = minV === "" ? null : dispToEur(Number(minV));
      const max = maxV === "" ? null : dispToEur(Number(maxV));
      onChange({ mode: "between", min, max, includeEmpty: inclEmpty, values: [] });
    } else if (modeIsValueList) {
      onChange({ mode, values: Array.from(selected), min: null, max: null });
    }
    onClose();
  };

  // Use a range-specific quick-select: "top 25%" range bounds from stats
  const quickRange = (lo, hi) => { setMinV(lo); setMaxV(hi); };

  const fmt = (n) => {
    if (!Number.isFinite(n)) return "—";
    return Number.isInteger(n)
      ? n.toLocaleString("en-US").replace(/,/g, " ")
      : (Math.round(n * 100) / 100).toLocaleString("en-US").replace(/,/g, " ");
  };
  // Money-field display helpers: convert the EUR stat/bound into the current
  // currency for what the user sees (dispNum) and label it (fmtStat).
  const dispNum = (v) => isMoney && Number.isFinite(Number(v)) ? Math.round(eurToDisp(v)) : v;
  const fmtStat = (n) => isMoney && Number.isFinite(n)
    ? `${fmt(Math.round(eurToDisp(n)))} ${displayMoneyUnit(field.unit)}`
    : fmt(n);

  // Render through a portal attached to document.body so the popover
  // escapes any transform'd ancestor (.page-transition uses animation:
  // pageFade which leaves a transform on the wrapper — that creates a
  // containing block for position:fixed descendants, and our popover
  // was getting positioned relative to the wrong origin). Portal puts
  // the popover as a direct child of <body>, where position:fixed
  // resolves against the viewport as intended.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      id="pivotv2-filter-pop"
      style={{
        ...style, width: popW, maxHeight: "72vh", overflow: "auto",
        background: "var(--surface)",
        border: `1px solid ${border}`,
        borderRadius: 10,
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        padding: "1rem 1.1rem",
        color: text, fontSize: "0.88rem",
      }}
    >
      {/* Header — just the field name, nothing else */}
      <div style={{ fontWeight: 600, fontSize: "1rem", color: text, marginBottom: "0.8rem" }}>
        {field?.label || fieldKey}
      </div>

      {/* Loading notice — raw records are still streaming in to back this
          popover's value list (server-side mode loads them lazily on open).
          Shown so an in-flight popover never looks like a broken empty list. */}
      {loading && (
        <div style={{
          marginBottom: "0.85rem", padding: "0.5rem 0.7rem",
          background: "color-mix(in srgb, var(--accent) 6%, transparent)", border: `1px solid color-mix(in srgb, var(--accent) 20%, transparent)`,
          borderRadius: 6, fontSize: "0.78rem", color: dim, lineHeight: 1.4,
        }}>
          {lang === "sk" ? "Načítavam hodnoty…" : "Loading values…"}
        </div>
      )}

      {/* Fallback notice — shown only when we reverted to the full
          record set because other filters were too narrow. Tells the
          user the values they see come from ALL data, so picking one
          may further conflict with their existing filters. Without
          this message a user would just see "no values" and be stuck. */}
      {fellBack && (
        <div style={{
          marginBottom: "0.85rem",
          padding: "0.5rem 0.7rem",
          background: "rgba(245,166,35,0.08)",
          border: `1px solid ${orange}33`,
          borderRadius: 6,
          fontSize: "0.74rem", color: text, lineHeight: 1.4,
        }}>
          <span style={{ color: orangeInk, fontWeight: 700 }}>ⓘ </span>
          {lang === "sk"
            ? `Tvoje ostatné filtre (${otherFilterCount}) zužujú výber na 0 riadkov. Zobrazujem hodnoty z celej databázy — keď tu niečo zaškrtneš, výber sa znova prepočíta.`
            : `Your other filters (${otherFilterCount}) narrow the dataset to 0 rows. Showing values from the full data — picking here will re-evaluate the result set.`}
        </div>
      )}

      {/* Mode picker — clean pills, plain labels */}
      <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.9rem", flexWrap: "wrap" }}>
        {isNumber && (
          <ModeBtn active={mode === "between"} onClick={() => setMode("between")}>{lang === "sk" ? "rozsah" : "range"}</ModeBtn>
        )}
        <ModeBtn active={mode === "in"}        onClick={() => setMode("in")}>{lang === "sk" ? "zahrnúť" : "include"}</ModeBtn>
        <ModeBtn active={mode === "not_in"}    onClick={() => setMode("not_in")}>{lang === "sk" ? "vylúčiť" : "exclude"}</ModeBtn>
        <ModeBtn active={mode === "empty"}     onClick={() => setMode("empty")}>{lang === "sk" ? "len prázdne" : "empty only"}</ModeBtn>
        <ModeBtn active={mode === "not_empty"} onClick={() => setMode("not_empty")}>{lang === "sk" ? "má hodnotu" : "has value"}</ModeBtn>
      </div>

      {/* Range inputs */}
      {mode === "between" && isNumber && (
        <div style={{ marginBottom: "0.6rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.75rem", color: dim }}>{lang === "sk" ? "od" : "from"}</span>
              <input type="number" value={minV} onChange={(e) => setMinV(e.target.value)}
                placeholder={stats ? fmtStat(stats.min) : ""} style={inpS} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <span style={{ fontSize: "0.75rem", color: dim }}>{lang === "sk" ? "do" : "to"}</span>
              <input type="number" value={maxV} onChange={(e) => setMaxV(e.target.value)}
                placeholder={stats ? fmtStat(stats.max) : ""} style={inpS} />
            </label>
          </div>
          {stats && (
            <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
              <QuickBtn onClick={() => quickRange(dispNum(stats.min), dispNum(stats.median))}>{lang === "sk" ? "dolná polovica" : "lower half"}</QuickBtn>
              <QuickBtn onClick={() => quickRange(dispNum(stats.median), dispNum(stats.max))}>{lang === "sk" ? "horná polovica" : "upper half"}</QuickBtn>
              <QuickBtn onClick={() => quickRange("", "")}>{lang === "sk" ? "vyčistiť" : "clear"}</QuickBtn>
            </div>
          )}
          {/* Stats as a muted one-liner below the inputs, no box */}
          {stats && (
            <div style={{ marginTop: "0.65rem", fontSize: "0.74rem", color: dim, lineHeight: 1.5 }}>
              {lang === "sk" ? "V dátach od " : "In data from "}<strong style={{ color: text, fontWeight: 500 }}>{fmtStat(stats.min)}</strong>{lang === "sk" ? " do " : " to "}<strong style={{ color: text, fontWeight: 500 }}>{fmtStat(stats.max)}</strong>,
              {lang === "sk" ? " medián " : " median "}<strong style={{ color: text, fontWeight: 500 }}>{fmtStat(stats.median)}</strong>.
              {hasEmpty && <> {Math.max(0, stats.nNull != null ? stats.nNull : records.length - stats.count)} {lang === "sk" ? "záznamov bez hodnoty." : "records without a value."}</>}
            </div>
          )}
          {hasEmpty && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.65rem", cursor: "pointer", fontSize: "0.82rem", color: "var(--text-2)" }}>
              <input type="checkbox" checked={inclEmpty} onChange={(e) => setInclEmpty(e.target.checked)}
                style={{ accentColor: green, width: 14, height: 14 }} />
              {lang === "sk" ? "zahrnúť aj byty bez ceny" : "include units without a value"}
            </label>
          )}
        </div>
      )}

      {/* Value list — for in/not_in */}
      {(mode === "in" || mode === "not_in") && (
        <div>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === "sk" ? "Hľadať…" : "Search…"}
            style={{ ...inpS, width: "100%", marginBottom: "0.55rem" }}
          />
          <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.5rem", alignItems: "center" }}>
            <QuickBtn onClick={() => {
              const all = [...distinct];
              if (hasEmpty) all.push(EMPTY_SENTINEL);
              setSelected(new Set(all));
            }}>{lang === "sk" ? "všetko" : "all"}</QuickBtn>
            <QuickBtn onClick={() => setSelected(new Set())}>{lang === "sk" ? "nič" : "none"}</QuickBtn>
            <QuickBtn onClick={() => {
              setSelected(prev => {
                const all = [...distinct];
                if (hasEmpty) all.push(EMPTY_SENTINEL);
                const inv = new Set();
                for (const v of all) if (!prev.has(v)) inv.add(v);
                return inv;
              });
            }}>{lang === "sk" ? "prevrátiť" : "invert"}</QuickBtn>
            <span style={{ marginLeft: "auto", color: dim, fontSize: "0.76rem" }}>
              {lang === "sk" ? `${selected.size} vybraných` : `${selected.size} selected`}
            </span>
          </div>
          <div style={{
            maxHeight: 280, overflowY: "auto",
            border: `1px solid ${border}`, borderRadius: 6, background: "var(--bg)",
            padding: "0.25rem",
          }}>
            {hasEmpty && (
              <CheckboxRow
                checked={selected.has(EMPTY_SENTINEL)}
                onChange={() => toggle(EMPTY_SENTINEL)}
                label={<span style={{ fontStyle: "italic", color: dim }}>{lang === "sk" ? "(bez hodnoty)" : "(no value)"}</span>}
              />
            )}
            {shown.length === 0 ? (
              <div style={{ padding: "0.75rem", fontSize: "0.8rem", color: dim, textAlign: "center" }}>
                {loading ? (lang === "sk" ? "Načítavam…" : "Loading…") : (lang === "sk" ? "Žiadne zhody." : "No matches.")}
              </div>
            ) : shown.map(v => (
              <CheckboxRow
                key={String(v)}
                checked={selected.has(v)}
                onChange={() => toggle(v)}
                label={String(v)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer: Clear / Cancel / Apply */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", gap: "0.5rem" }}>
        <button onClick={() => { onClear(); onClose(); }}
          style={{ background: "transparent", border: "none", color: dim, cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit", textDecoration: "underline", padding: "0.45rem 0" }}>
          vymazať
        </button>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button onClick={onClose}
            style={{ background: "transparent", border: `1px solid ${border}`, color: text, borderRadius: 6, padding: "0.45rem 0.9rem", cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>
            zrušiť
          </button>
          <button onClick={apply}
            style={{ background: green, border: "none", color: "var(--bg)", borderRadius: 6, padding: "0.45rem 1.1rem", cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit", fontWeight: 600 }}>
            použiť
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const inpS = {
  padding: "0.5rem 0.65rem",
  background: "var(--bg)", border: `1px solid ${border}`, borderRadius: 6,
  color: text, fontSize: "0.88rem", fontFamily: "inherit",
  outline: "none", width: "100%", minWidth: 0, boxSizing: "border-box",
};

function ModeBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
        border: `1px solid ${active ? green : border}`,
        color: active ? green : "var(--text-2)",
        padding: "0.38rem 0.7rem", borderRadius: 6,
        cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem",
        fontWeight: active ? 600 : 400,
      }}>
      {children}
    </button>
  );
}
function QuickBtn({ onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        background: "transparent", border: `1px solid ${border}`,
        color: dim, padding: "0.3rem 0.6rem", borderRadius: 6,
        cursor: "pointer", fontFamily: "inherit", fontSize: "0.74rem",
        transition: "border-color 0.1s, color 0.1s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 67%, transparent)"; e.currentTarget.style.color = text; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = dim; }}>
      {children}
    </button>
  );
}
function CheckboxRow({ checked, onChange, label }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: "0.55rem",
      padding: "0.35rem 0.55rem", cursor: "pointer", borderRadius: 4,
      fontSize: "0.86rem", color: checked ? text : "var(--text-2)",
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-2)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ accentColor: green, width: 15, height: 15 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </label>
  );
}


/* ─── DRILL-DOWN MODAL ────────────────────────────────────────────
   Click a count or subtotal to see the underlying flat records that
   contributed to that cell. Showing 12 cols by default, scrollable. */
function DrillDownModal({ title, records, loading, onClose, lang }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Columns shown in drill-down — the most-useful flat-level fields
  const DRILL_COLS = [
    { key: "project_name", label: "Projekt",   en: "Project" },
    { key: "unit_id",      label: "Byt",       en: "Unit" },
    { key: "typ",          label: "Typ",       en: "Type" },
    { key: "izby",         label: "Izby",      en: "Rooms" },
    { key: "poschodie",    label: "Posch.",    en: "Floor" },
    { key: "obytna_plocha",label: "Plocha",    en: "Area" },
    { key: "cena_s_dph",   label: "Cena",      en: "Price" },
    { key: "stav",         label: "Stav",      en: "Status" },
    { key: "city",         label: "Mesto",     en: "City" },
    { key: "district",     label: "Časť",      en: "District" },
    { key: "developer",    label: "Developer", en: "Developer" },
  ];
  // Drill-col key → FIELDS registry key (identical except district→cast). Labels come
  // from the single field registry via fieldLabel(), so a rename (e.g. "Mestská časť")
  // propagates here automatically; the inline label/en is only a fallback.
  const DRILL_FIELD_KEY = { district: "cast" };
  const drillColLabel = (c) => {
    const fk = DRILL_FIELD_KEY[c.key] || c.key;
    return FIELDS[fk] ? fieldLabel(fk, lang) : (lang === "sk" ? c.label : c.en);
  };

  const cena_m2 = (r) => {
    // num() guards null/"" (Number(null)===0); an unpriced unit must be "—", not €0/m².
    const p = num(r.cena_s_dph), m = num(r.obytna_plocha);
    return (p != null && p > 0 && m != null && m > 0) ? Math.round(p / m) : null;
  };

  const downloadCSV = () => {
    const esc = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [...DRILL_COLS.map(drillColLabel), "€/m²"];
    const lines = [headers.map(esc).join(",")];
    for (const r of records) {
      lines.push([...DRILL_COLS.map(c => r[c.key] ?? ""), cena_m2(r) ?? ""].map(esc).join(","));
    }
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drilldown-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Portal to <body> so the fullscreen overlay escapes any ancestor
  // that has `transform` (creates a new containing block for fixed).
  // Without this the modal can be clipped / shifted by .page-transition.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, left: "var(--platform-content-left, 0px)",
        background: "rgba(0,0,0,0.65)", zIndex: 1200,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "clamp(0.5rem, 2vw, 2rem)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)", border: `1px solid color-mix(in srgb, var(--accent) 33%, transparent)`, borderRadius: 10,
          width: "min(1200px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column",
          boxShadow: "0 20px 64px rgba(0,0,0,0.9)",
        }}
      >
        <div style={{ padding: "0.9rem 1.1rem", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <span style={{ fontFamily: mono, fontSize: "0.62rem", color: accentInk, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {lang === "sk" ? "Záznamy" : "Records"}
          </span>
          <strong style={{ color: text, fontSize: "0.9rem" }}>{title}</strong>
          <span style={{ color: dim, fontFamily: mono, fontSize: "0.72rem", marginLeft: "auto" }}>
            {records.length.toLocaleString("en-US").replace(/,/g, " ")}
          </span>
          <button onClick={downloadCSV} style={{
            background: "transparent", border: `1px solid color-mix(in srgb, var(--accent) 33%, transparent)`, color: accentInk,
            borderRadius: 4, padding: "0.3rem 0.6rem", cursor: "pointer",
            fontFamily: mono, fontSize: "0.7rem",
          }}>⬇ CSV</button>
          <button onClick={onClose} style={{
            background: "transparent", border: `1px solid ${border}`, color: dim,
            borderRadius: 4, padding: "0.3rem 0.6rem", cursor: "pointer",
            fontFamily: mono, fontSize: "0.7rem",
          }}>✕</button>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {loading && records.length === 0 && (
            <div style={{ padding: "2rem", textAlign: "center", color: dim, fontFamily: mono, fontSize: "0.8rem" }}>
              {lang === "sk" ? "Načítavam záznamy…" : "Loading records…"}
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--surface-2)", zIndex: 1 }}>
              <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {DRILL_COLS.map(c => (
                  <th key={c.key} style={{ padding: "0.55rem 0.7rem", fontWeight: 700, borderBottom: `1px solid ${border}`, whiteSpace: "nowrap" }}>{drillColLabel(c)}</th>
                ))}
                <th style={{ padding: "0.55rem 0.7rem", fontWeight: 700, borderBottom: `1px solid ${border}`, color: accentInk, textAlign: "right" }}>{moneySymbol()}/m²</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 1000).map((r, i) => (
                <tr key={(r.id ?? i) + "|" + i} style={{ background: i % 2 ? "transparent" : "var(--surface-2)" }}>
                  {DRILL_COLS.map(c => {
                    // cena_s_dph is EUR-denominated money — convert to display
                    // currency. Other columns (text / counts / areas) pass through.
                    const raw = r[c.key];
                    const isEmpty = raw == null || raw === "";
                    const cellText = c.key === "cena_s_dph" && !isEmpty && Number.isFinite(Number(raw))
                      ? `${Math.round(moneyFromEur(Number(raw))).toLocaleString("en-US").replace(/,/g, " ")} ${moneySymbol()}`   // price → whole
                      : c.key === "obytna_plocha" && !isEmpty && Number.isFinite(Number(raw))
                      ? `${_fmtDec1(Number(raw))} m²`                                                                          // area → 1 decimal
                      : (isEmpty ? null : String(raw));
                    return (
                      <td key={c.key} style={{ padding: "0.35rem 0.7rem", color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}
                          title={cellText == null ? "" : cellText}>
                        {cellText == null ? <span style={{ color: dim, opacity: 0.6 }}>—</span> : cellText}
                      </td>
                    );
                  })}
                  <td style={{ padding: "0.35rem 0.7rem", textAlign: "right", fontFamily: mono, color: accentInk }}>
                    {cena_m2(r) != null ? Math.round(moneyFromEur(cena_m2(r))).toLocaleString("en-US").replace(/,/g, " ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {records.length > 1000 && (
            <div style={{ padding: "0.75rem 1rem", color: dim, fontSize: "0.72rem", textAlign: "center", fontFamily: mono }}>
              {lang === "sk" ? `Zobrazených prvých 1 000 z ${records.length} (stiahni CSV pre kompletný výber).` : `Showing first 1,000 of ${records.length} (download CSV for the full set).`}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
