/* useFlatFilters — the filter half of FlatWorkbench, for any page that holds its flats
 * in the browser (a project's flat list, the Byt-v-čase grid).
 *
 * State, the FieldPanel callbacks, and the filtered rows. Filtering is
 * filterModel.matchesFilters — the ENGINE's rules — over flatFields' registry keys, so a
 * filter means here exactly what it means on Databáza bytov. Persistence is the caller's:
 * a page saves `filters` under its own preference key and hands them back through
 * `restoreFilters`.
 */
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useAnalyticsRegistry } from "./useData";
import { useCurrency } from "./useCurrency";
import { moneyFromEur, moneySymbol } from "./money";
import { formatDimNumber } from "./locale";
import { statusLabel } from "./unitStatus";
import { unitKindLabel } from "./unitKinds";
import {
  EMPTY_SENTINEL, newFilter, sanitizeFilter, isFilterActive, convertMoneyBounds, matchesFilters,
} from "./filterModel";
import {
  FLAT_FIELDS, FLAT_FIELD_BY_KEY, flatValue, isMoneyField, isDateField, capsSetsFor, flatCapsOf,
  distinctFlatValues,
} from "./flatFields";

/* A value as the reader should see it in a list or a cell. The stored value is what a
   filter compares; this is only its face ("2", not "2.0"; "Voľný", not "V"). */
export function flatValueLabel(key, v, lang) {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "stav") return statusLabel(v, lang, "one");
  if (key === "typ") return unitKindLabel(v, lang);
  if (FLAT_FIELD_BY_KEY[key]?.type === "numeric") return String(formatDimNumber(v));
  return String(v);
}

export function useFlatFilters(rows, { lang = "sk" } = {}) {
  useCurrency(); // re-render (and re-convert money bounds) on a currency switch
  const { dimensions, measures } = useAnalyticsRegistry();
  const sets = useMemo(() => capsSetsFor({ dimensions, measures }), [dimensions, measures]);
  const capsOf = useCallback((k) => flatCapsOf(k, sets), [sets]);

  const [filters, setFilters] = useState([]);
  const fId = useRef(0);

  const addFilter = (key) => {
    const caps = capsOf(key);
    if (!caps.modes.length) return;
    setFilters((a) => (a.some((f) => f.key === key) ? a : [...a, newFilter(key, caps, ++fId.current)]));
  };
  const patchFilter = (id, patch) => setFilters((a) => a.map((f) => {
    if (f.id !== id) return f;
    const next = { ...f, ...patch };
    /* A new operator must not carry the old operand: a values list left on a range, or
       bounds left on an "is", makes a filter that reads one way and acts another. */
    if (patch.mode && patch.mode !== f.mode) {
      if (patch.mode === "between") next.values = [];
      else if (patch.mode === "in" || patch.mode === "not_in") { next.min = ""; next.max = ""; }
      else { next.values = []; next.min = ""; next.max = ""; }
    }
    return next;
  }));
  const removeFilter = (id) => setFilters((a) => a.filter((f) => f.id !== id));
  /* Restore a saved list (from any page's preferences). User-writable, so sanitised, and
     a filter on a field this list does not know is dropped rather than shown dead. */
  const restoreFilters = useCallback((saved) => {
    if (!Array.isArray(saved)) return;
    const clean = saved.map((f, i) => sanitizeFilter(f, i + 1)).filter((f) => f && FLAT_FIELD_BY_KEY[f.key]);
    setFilters(clean);
    fId.current = clean.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0);
  }, []);

  /* A typed "300 000" is a PRICE. Switch € → Kč and the bound converts with every other
     money figure, or the same filter silently asks a different question. */
  const money1 = moneyFromEur(1) || 1;
  const rateRef = useRef(money1);
  useEffect(() => {
    const prev = rateRef.current;
    rateRef.current = money1;
    if (prev && money1 && prev !== money1) setFilters((a) => convertMoneyBounds(a, money1 / prev, isMoneyField));
  }, [money1]);

  const filtered = useMemo(
    () => (rows || []).filter((r) => matchesFilters(r, filters, {
      valueOf: flatValue, isMoneyKey: isMoneyField, isDateKey: isDateField, toEur: (v) => v / money1,
    })),
    [rows, filters, money1],
  );

  /* The panel's value lists come from THESE rows, so a project's building filter offers
     that project's buildings — not every building in the market. A hook by contract:
     FieldPanel calls it once per filter card, every render. */
  const useValues = (key, enabled) => useMemo(() => {
    if (!enabled) return { values: [], loading: false };
    const values = distinctFlatValues(rows, key, lang)
      .filter((v) => v.value !== EMPTY_SENTINEL)   // the panel offers (empty) itself
      .map((v) => ({ value: v.value, label: flatValueLabel(key, v.value, lang) }));
    return { values, loading: false };
  }, [rows, key, enabled, lang]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Labels are the live registry's, with the currency symbol following the toggle, so a
     column reading "Cena s DPH (Kč)" never sits beside a filter card saying "(€)". */
  const sym = moneySymbol();
  const regLabel = useMemo(() => {
    const m = new Map();
    for (const d of dimensions) m.set(d.key, d);
    for (const x of measures) if (!m.has(x.key)) m.set(x.key, x);
    return m;
  }, [dimensions, measures]);
  const labelFor = useCallback((key, l) => {
    const f = FLAT_FIELD_BY_KEY[key];
    const r = regLabel.get(key);
    const raw = (l === "sk" ? (r?.label_sk || f?.label_sk) : (r?.label_en || f?.label_en)) || key;
    return (f?.fmt === "eur" || f?.fmt === "per_m2") && sym !== "€" ? raw.replace(/€/g, sym) : raw;
  }, [regLabel, sym]);
  const panelFields = useMemo(
    () => FLAT_FIELDS.map((f) => ({ key: f.key, type: f.type, label_sk: labelFor(f.key, "sk"), label_en: labelFor(f.key, "en") })),
    [labelFor],
  );
  const unitOf = (k) => {
    const fmt = FLAT_FIELD_BY_KEY[k]?.fmt;
    if (fmt === "eur") return sym;
    if (fmt === "per_m2") return `${sym}/m²`;
    if (fmt === "area") return "m²";
    return "";
  };

  return {
    rows: rows || [],
    filters, setFilters, restoreFilters, addFilter, patchFilter, removeFilter,
    capsOf, useValues, filtered, panelFields, unitOf,
    lbl: (k) => labelFor(k, lang === "sk" ? "sk" : "en"),
    valueLabel: (k, v) => flatValueLabel(k, v, lang),
    activeCount: filters.filter(isFilterActive).length,
  };
}
