/* flatFields — what a single FLAT can be filtered and shown by, on the pages that
 * already hold their rows in the browser: a project's flat list and the Byt-v-čase grid.
 *
 * WHY IT EXISTS (Boss, 2026-09-28): the filters and the column chooser he uses on
 * Predaje and Databáza bytov should be everywhere a list of flats appears. Those two
 * pages ask the server; a project page and the timeline grid already have their rows, so
 * they filter locally — and a filter has to mean the same thing in both places. So:
 *
 *   · the KEYS are the analytics registry's own (analytics.dim_registry and
 *     measure_registry), which is what Databáza bytov is built on, so a field is named,
 *     typed and offered the same operators everywhere;
 *   · the labels, formats and capability flags below are the registry's as of
 *     2026-09-28 and serve only as the FALLBACK before the live registry has loaded —
 *     the page passes the live registry in and it wins (see capsSetsFor);
 *   · filtering itself is filterModel.matchesFilters, the engine's rules applied in the
 *     browser.
 *
 * `get` reads a flats_current-shaped row. Money is EUR: the loading hooks overlay the
 * EUR price over the native one (useData._toEurDisplay), and the display currency is
 * applied only when a value is drawn.
 */
import { EMPTY_SENTINEL, capabilitiesOf } from "./filterModel.js";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v) => (v === null || v === undefined || v === "" ? null : String(v));

/* dim / measure mirror the registry: a DIMENSION can be filtered by a value list, a
   MEASURE by a range. Rooms and floor are both (the registry lists them twice), so they
   offer "is 2 or 3" AND "from 2 to 4". */
export const FLAT_FIELDS = [
  { key: "unit_id",         cat: "unit",  type: "text",    dim: true,  measure: false, label_sk: "ID bytu",                   label_en: "Unit ID",                      get: (r) => txt(r.unit_detail) || txt(r.unit_id) },
  { key: "typ",             cat: "unit",  type: "text",    dim: true,  measure: false, label_sk: "Typ",                       label_en: "Type",                         get: (r) => txt(r.typ) },
  { key: "etapa",           cat: "unit",  type: "text",    dim: true,  measure: false, label_sk: "Etapa",                     label_en: "Phase",                        get: (r) => txt(r.etapa) },
  { key: "budova",          cat: "unit",  type: "text",    dim: true,  measure: false, label_sk: "Budova",                    label_en: "Building",                     get: (r) => txt(r.budova) },
  { key: "poschodie",       cat: "unit",  type: "numeric", dim: true,  measure: true,  label_sk: "Poschodie",                 label_en: "Floor",                        get: (r) => num(r.poschodie) },
  { key: "izby",            cat: "unit",  type: "numeric", dim: true,  measure: true,  label_sk: "Izby",                      label_en: "Rooms",                        get: (r) => num(r.izby) },
  { key: "stav",            cat: "unit",  type: "text",    dim: true,  measure: false, label_sk: "Stav",                      label_en: "Status",                       get: (r) => txt(r.stav) },
  { key: "orientacia",      cat: "unit",  type: "text",    dim: true,  measure: false, label_sk: "Orientácia",                label_en: "Orientation",                  get: (r) => txt(r.orientacia) },
  { key: "cena_s_dph",      cat: "price", type: "numeric", dim: false, measure: true,  fmt: "eur",    label_sk: "Cena s DPH (€)",      label_en: "Price incl. VAT (€)",   get: (r) => num(r.cena_s_dph) },
  { key: "cena_bez_dph",    cat: "price", type: "numeric", dim: false, measure: true,  fmt: "eur",    label_sk: "Cena bez DPH (€)",    label_en: "Price excl. VAT (€)",   get: (r) => num(r.cena_bez_dph) },
  { key: "price_per_m2",    cat: "price", type: "numeric", dim: false, measure: true,  fmt: "per_m2", label_sk: "€/m² (obytná)",       label_en: "€/m² (living)",
    get: (r) => { const p = num(r.cena_s_dph), a = num(r.obytna_plocha); return p !== null && a !== null && a > 0 ? p / a : null; } },
  { key: "fitout_level",    cat: "price", type: "text",    dim: true,  measure: false, label_sk: "Štandard (čo cena zahŕňa)", label_en: "Fit-out (what the price buys)", get: (r) => txt(r.fitout_level) },
  { key: "obytna_plocha",   cat: "area",  type: "numeric", dim: false, measure: true,  fmt: "area", label_sk: "Obytná plocha (m²)",   label_en: "Living area (m²)",       get: (r) => num(r.obytna_plocha) },
  { key: "exterier",        cat: "area",  type: "numeric", dim: false, measure: true,  fmt: "area", label_sk: "Exteriér (m²)",        label_en: "Exterior (m²)",          get: (r) => num(r.exterier_plocha) },
  { key: "celkova_plocha",  cat: "area",  type: "numeric", dim: false, measure: true,  fmt: "area", label_sk: "Celková plocha (m²)",  label_en: "Total area (m²)",        get: (r) => num(r.celkova_plocha) },
  { key: "balkon",          cat: "area",  type: "numeric", dim: false, measure: true,  fmt: "area", label_sk: "Balkón (m²)",          label_en: "Balcony (m²)",           get: (r) => num(r.balkon_plocha) },
  { key: "loggia",          cat: "area",  type: "numeric", dim: false, measure: true,  fmt: "area", label_sk: "Loggia (m²)",          label_en: "Loggia (m²)",            get: (r) => num(r.loggia_plocha) },
  { key: "terasa",          cat: "area",  type: "numeric", dim: false, measure: true,  fmt: "area", label_sk: "Terasa (m²)",          label_en: "Terrace (m²)",           get: (r) => num(r.terasa_plocha) },
  { key: "zahrada",         cat: "area",  type: "numeric", dim: false, measure: true,  fmt: "area", label_sk: "Záhrada (m²)",         label_en: "Garden (m²)",            get: (r) => num(r.zahrada_plocha) },
  { key: "kobka",           cat: "area",  type: "numeric", dim: false, measure: true,  fmt: "area", label_sk: "Kobka (m²)",           label_en: "Storage (m²)",           get: (r) => num(r.kobka_plocha) },
  { key: "kolaudacia",      cat: "time",  type: "text",    dim: true,  measure: false, label_sk: "Kolaudácia",                label_en: "Completion",                   get: (r) => txt(r.kolaudacia) },
  { key: "kolaudacia_date", cat: "time",  type: "date",    dim: true,  measure: false, label_sk: "Kolaudácia (dátum)",        label_en: "Completion (date)",            get: (r) => txt(r.kolaudacia_date) },
];

export const FLAT_FIELD_BY_KEY = Object.fromEntries(FLAT_FIELDS.map((f) => [f.key, f]));

export const FLAT_CAT_ORDER = ["unit", "price", "area", "time"];
export const FLAT_CAT_LABEL = {
  sk: { unit: "Byt", price: "Cena", area: "Plochy", time: "Čas", other: "Ostatné" },
  en: { unit: "Unit", price: "Price", area: "Areas", time: "Time", other: "Other" },
};

/** The raw value of one field on one row (money in EUR), or undefined for an unknown key. */
export function flatValue(row, key) {
  const f = FLAT_FIELD_BY_KEY[key];
  return f ? f.get(row) : undefined;
}

export const isMoneyField = (key) => {
  const fmt = FLAT_FIELD_BY_KEY[key]?.fmt;
  return fmt === "eur" || fmt === "per_m2";
};
export const isDateField = (key) => FLAT_FIELD_BY_KEY[key]?.type === "date";

/**
 * The capability sets filterModel.capabilitiesOf expects. The LIVE registry wins when it
 * has loaded (so a field the registry stops filtering stops being filterable here too);
 * before that, the flags above stand in — the page is usable from the first frame.
 */
export function capsSetsFor(registry) {
  const dims = registry?.dimensions?.length ? registry.dimensions : null;
  const meas = registry?.measures?.length ? registry.measures : null;
  const ours = new Set(FLAT_FIELDS.map((f) => f.key));
  return {
    dimensionKeys: new Set(dims
      ? dims.filter((d) => d.filterable !== false && ours.has(d.key)).map((d) => d.key)
      : FLAT_FIELDS.filter((f) => f.dim).map((f) => f.key)),
    measureKeys: new Set(meas
      ? meas.filter((m) => ours.has(m.key)).map((m) => m.key)
      : FLAT_FIELDS.filter((f) => f.measure).map((f) => f.key)),
    dateKeys: new Set(dims
      ? dims.filter((d) => d.data_type === "date" && ours.has(d.key)).map((d) => d.key)
      : FLAT_FIELDS.filter((f) => f.type === "date").map((f) => f.key)),
  };
}

export const flatCapsOf = (key, sets) => capabilitiesOf(key, sets);

/**
 * Every distinct value of a field across the rows, for an "is / is not" list — with how
 * many rows carry it, blanks folded into one (empty) entry at the end. Numbers sort as
 * numbers ("2" before "10"), text in the reader's locale.
 */
export function distinctFlatValues(rows, key, locale = "sk") {
  const counts = new Map();
  let blanks = 0;
  for (const r of rows || []) {
    const v = flatValue(r, key);
    if (v === null || v === undefined || v === "") { blanks++; continue; }
    const s = String(v);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const numeric = FLAT_FIELD_BY_KEY[key]?.type === "numeric";
  const out = [...counts.entries()].map(([value, n]) => ({ value, n }));
  out.sort(numeric
    ? (a, b) => Number(a.value) - Number(b.value)
    : (a, b) => a.value.localeCompare(b.value, locale, { numeric: true, sensitivity: "base" }));
  if (blanks) out.push({ value: EMPTY_SENTINEL, n: blanks });
  return out;
}

/** The project page's columns before anyone chooses — the twelve it always showed. */
export const DEFAULT_FLAT_COLS = [
  "unit_id", "budova", "poschodie", "izby", "obytna_plocha", "exterier",
  "celkova_plocha", "cena_s_dph", "price_per_m2", "orientacia", "kolaudacia", "stav",
];
