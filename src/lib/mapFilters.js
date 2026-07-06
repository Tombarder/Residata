/**
 * mapFilters — a composable filter engine for the developer map (Mapa 2).
 *
 * Built around the questions a developer actually asks of a competitive set:
 *   "show me projects in these districts but NOT this developer, priced
 *    €4–6k/m², 200+ units, that still have availability and complete in 2027."
 *
 * So every project column is a FIELD, and each field type supports the operators
 * the user asked for: is any of / is none of / has a value / is empty / between /
 * ≥ / ≤ / contains. Conditions AND together. Pure + unit-tested (no React).
 */
import { ppm2Of, completionBucket, COMPLETION } from "./mapMetrics.js";

const norm = (s) => (s == null ? "" : String(s)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const num = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// label: English · label_sk: Slovak. `get` reads the value from a projects_live row.
export const FIELDS = [
  { key: "country",         label: "Country",         label_sk: "Krajina",      type: "category", get: (p) => p.country || "" },
  { key: "city",            label: "City",            label_sk: "Mesto",        type: "category", get: (p) => p.city || "" },
  { key: "district",        label: "District",        label_sk: "Mestská časť", type: "category", get: (p) => p.district || "" },
  { key: "sub_district",    label: "Sub-district",    label_sk: "Podčasť",      type: "category", get: (p) => p.sub_district || "" },
  { key: "developer",       label: "Developer",       label_sk: "Developer",    type: "category", get: (p) => (p.developer || "").trim() },
  { key: "status",          label: "Project status",  label_sk: "Stav projektu",type: "category", get: (p) => p.status || "" },
  { key: "completion",      label: "Completion",      label_sk: "Dokončenie",   type: "category", get: (p) => completionBucket(p),
    options: ["ready", "soon", "mid", "far", "unknown"], optionLabel: (v) => COMPLETION[v]?.label || v },
  { key: "is_top20",        label: "Top 20 (by availability)", label_sk: "Top 20 (podľa ponuky)", type: "boolean", get: (p) => !!p.is_top20 },
  { key: "is_manual",       label: "Manually maintained",      label_sk: "Ručne udržiavaný",      type: "boolean", get: (p) => !!p.is_manual },
  { key: "ppm2",            label: "Price €/m²",      label_sk: "Cena €/m²",    type: "number", get: (p) => ppm2Of(p) || null, fmt: (v) => "€" + Math.round(v) },
  { key: "min_price",       label: "Cheapest unit €", label_sk: "Najlacnejší byt €", type: "number", get: (p) => num(p.min_price), fmt: (v) => "€" + Math.round(v) },
  { key: "max_price",       label: "Priciest unit €", label_sk: "Najdrahší byt €",   type: "number", get: (p) => num(p.max_price), fmt: (v) => "€" + Math.round(v) },
  { key: "total_units",     label: "Total units",     label_sk: "Počet bytov",  type: "number", get: (p) => num(p.total_units) },
  { key: "available_units", label: "Available units", label_sk: "Voľné byty",   type: "number", get: (p) => Number(p.available_units) || 0 },
  { key: "sold_units",      label: "Sold units",      label_sk: "Predané byty", type: "number", get: (p) => Number(p.sold_units) || 0 },
  { key: "reserved_units",  label: "Reserved units",  label_sk: "Rezervované",  type: "number", get: (p) => (Number(p.reserved_units) || 0) + (Number(p.prereserved_units) || 0) },
  { key: "sold_percentage", label: "Absorption %",    label_sk: "Vypredanosť %",type: "number", get: (p) => num(p.sold_percentage), fmt: (v) => Math.round(v) + "%" },
  { key: "sold_last_month", label: "Sold last month", label_sk: "Predané za mesiac", type: "number", get: (p) => Number(p.sold_last_month) || 0 },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const OPS = {
  category: [
    { key: "in",    label: "is any of",   label_sk: "je jedno z",  needsValue: "multi" },
    { key: "nin",   label: "is none of",  label_sk: "nie je z",    needsValue: "multi" },
    { key: "set",   label: "has a value", label_sk: "má hodnotu",  needsValue: null },
    { key: "empty", label: "is empty",    label_sk: "je prázdne",  needsValue: null },
  ],
  boolean: [
    { key: "true",  label: "is yes", label_sk: "áno", needsValue: null },
    { key: "false", label: "is no",  label_sk: "nie", needsValue: null },
  ],
  number: [
    { key: "between", label: "is between", label_sk: "je medzi",    needsValue: "range" },
    { key: "gte",     label: "is at least",label_sk: "aspoň",       needsValue: "one" },
    { key: "lte",     label: "is at most", label_sk: "najviac",     needsValue: "one" },
    { key: "set",     label: "has a value",label_sk: "má hodnotu",  needsValue: null },
    { key: "empty",   label: "is empty",   label_sk: "je prázdne",  needsValue: null },
  ],
  text: [
    { key: "contains",  label: "contains",        label_sk: "obsahuje",     needsValue: "text" },
    { key: "ncontains", label: "does not contain",label_sk: "neobsahuje",   needsValue: "text" },
  ],
};

export const opsForField = (field) => OPS[field?.type] || [];
export const defaultOpForField = (field) => opsForField(field)[0]?.key;

/** Distinct, sorted values present in the data for a category field. */
export function fieldOptions(projects, field) {
  if (!field || field.type !== "category") return [];
  if (field.options) return field.options;
  const seen = new Set();
  for (const p of projects || []) { const v = field.get(p); if (v != null && String(v).trim() !== "") seen.add(v); }
  return Array.from(seen).sort((a, b) => String(a).localeCompare(String(b), "sk", { sensitivity: "base" }));
}

const hasValue = (v) => v != null && v !== "";

export function matchCond(p, field, cond) {
  const v = field.get(p);
  switch (cond.op) {
    case "in":    return Array.isArray(cond.value) && cond.value.includes(v);
    case "nin":   return !(Array.isArray(cond.value) && cond.value.includes(v));
    case "set":   return hasValue(v);
    case "empty": return !hasValue(v);
    case "true":  return v === true;
    case "false": return v === false;
    case "between": {
      if (v == null) return false;
      const a = num(Array.isArray(cond.value) ? cond.value[0] : null);
      const b = num(Array.isArray(cond.value) ? cond.value[1] : null);
      return (a == null || v >= a) && (b == null || v <= b);
    }
    case "gte":   { const a = num(cond.value); return v != null && a != null && v >= a; }
    case "lte":   { const a = num(cond.value); return v != null && a != null && v <= a; }
    case "contains":  return norm(v).includes(norm(cond.value));
    case "ncontains": return !norm(v).includes(norm(cond.value));
    default: return true;
  }
}

/** Keep a project only if it satisfies EVERY (complete) condition. */
export function applyFilters(projects, conditions) {
  const active = (conditions || []).filter(isComplete);
  if (!active.length) return projects;
  return projects.filter((p) => active.every((c) => { const f = FIELD_BY_KEY[c.field]; return f ? matchCond(p, f, c) : true; }));
}

/** A condition only filters once it has the value its operator needs. */
export function isComplete(c) {
  const f = FIELD_BY_KEY[c?.field];
  if (!f) return false;
  const op = opsForField(f).find((o) => o.key === c.op);
  if (!op) return false;
  if (op.needsValue === "multi") return Array.isArray(c.value) && c.value.length > 0;
  if (op.needsValue === "range") return Array.isArray(c.value) && (hasValue(c.value[0]) || hasValue(c.value[1]));
  if (op.needsValue === "one" || op.needsValue === "text") return hasValue(c.value);
  return true; // set / empty / boolean
}

/** Short human label for an active condition (for the collapsed chips). */
export function describe(c, sk = false) {
  const f = FIELD_BY_KEY[c.field];
  if (!f) return "";
  const fl = sk ? f.label_sk : f.label;
  const op = opsForField(f).find((o) => o.key === c.op);
  const ol = op ? (sk ? op.label_sk : op.label) : c.op;
  const optLabel = (v) => (f.optionLabel ? f.optionLabel(v) : v);
  const fnum = (v) => (f.fmt ? f.fmt(v) : v);
  if (c.op === "in" || c.op === "nin") return `${fl} ${ol} ${(c.value || []).map(optLabel).join(", ")}`;
  if (c.op === "between") return `${fl} ${fnum(c.value?.[0] ?? "…")}–${fnum(c.value?.[1] ?? "…")}`;
  if (c.op === "gte") return `${fl} ≥ ${fnum(c.value)}`;
  if (c.op === "lte") return `${fl} ≤ ${fnum(c.value)}`;
  if (c.op === "contains" || c.op === "ncontains") return `${fl} ${ol} "${c.value}"`;
  return `${fl} ${ol}`;
}
