/**
 * MapFilterBuilder — the composable filter panel for Mapa 2.
 *
 * Stack any number of conditions: pick a column → an operator (is any of /
 * is none of / has a value / is empty / between / ≥ / ≤ / contains) → values.
 * Conditions AND together. All logic lives in ../lib/mapFilters (unit-tested);
 * this is just the editor.
 */
import {
  FIELDS, FIELD_BY_KEY, opsForField, defaultOpForField, fieldOptions,
} from "../lib/mapFilters";

const green = "#00e5a0";
const dim = "#8a8a96";
const textLight = "#e8e8ed";
const border = "#26262d";
const bg2 = "#0e0e10";
const panel = "#161619";
const mono = "'JetBrains Mono', monospace";

let _cid = 0;
const newId = () => "c" + (++_cid);

function defaultValueFor(field, opKey) {
  const op = opsForField(field).find((o) => o.key === opKey);
  if (!op || !op.needsValue) return null;
  if (op.needsValue === "multi") return [];
  if (op.needsValue === "range") return ["", ""];
  return "";
}

function makeCondition(fieldKey = FIELDS[0].key) {
  const f = FIELD_BY_KEY[fieldKey];
  const op = defaultOpForField(f);
  return { id: newId(), field: fieldKey, op, value: defaultValueFor(f, op) };
}

export default function MapFilterBuilder({ conditions, setConditions, projects, matchCount, totalCount, sk, onClose }) {
  const update = (id, patch) => setConditions(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id) => setConditions(conditions.filter((c) => c.id !== id));
  const onField = (id, fieldKey) => { const f = FIELD_BY_KEY[fieldKey]; const op = defaultOpForField(f); update(id, { field: fieldKey, op, value: defaultValueFor(f, op) }); };
  const onOp = (id, opKey) => { const c = conditions.find((x) => x.id === id); update(id, { op: opKey, value: defaultValueFor(FIELD_BY_KEY[c.field], opKey) }); };

  return (
    <div style={{ position: "absolute", top: 8, left: "1.25rem", zIndex: 40, width: 540, maxWidth: "calc(100% - 2.5rem)", background: panel, border: `1px solid ${border}`, borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,0.6)" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderBottom: `1px solid ${border}` }}>
        <span style={{ color: textLight, fontWeight: 600, fontSize: "0.86rem" }}>{sk ? "Filtre" : "Filters"}</span>
        <span style={{ marginLeft: 10, fontSize: "0.72rem", color: dim, fontFamily: mono }}>
          <strong style={{ color: green }}>{matchCount}</strong>{totalCount != null ? <span style={{ color: dim }}> / {totalCount}</span> : null} {sk ? "vyhovuje" : "match"}
        </span>
        <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "1.05rem" }} aria-label="Close">×</button>
      </div>

      <div style={{ maxHeight: "min(56vh, 420px)", overflowY: "auto", padding: "10px 14px" }}>
        {conditions.length === 0 && (
          <div style={{ color: dim, fontSize: "0.8rem", padding: "8px 2px 12px", lineHeight: 1.6 }}>
            {sk ? "Žiadne filtre. Pridaj podmienku — vyber stĺpec, operátor a hodnoty. Viac podmienok sa kombinuje (A zároveň)." : "No filters yet. Add a condition — pick a column, an operator, and values. Multiple conditions combine with AND."}
          </div>
        )}
        {conditions.map((c, i) => (
          <Row key={c.id} c={c} i={i} projects={projects} sk={sk} onField={onField} onOp={onOp} update={update} remove={remove} />
        ))}
        <button onClick={() => setConditions([...conditions, makeCondition()])} style={addBtn}>+ {sk ? "Pridať filter" : "Add filter"}</button>
      </div>

      {conditions.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", padding: "9px 14px", borderTop: `1px solid ${border}` }}>
          <button onClick={() => setConditions([])} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.74rem" }}>{sk ? "Vyčistiť všetko" : "Clear all"}</button>
          <button onClick={onClose} style={{ marginLeft: "auto", background: green, color: "#06140f", border: "none", borderRadius: 7, padding: "6px 16px", fontSize: "0.76rem", fontWeight: 600, cursor: "pointer" }}>{sk ? "Hotovo" : "Done"}</button>
        </div>
      )}
    </div>
  );
}

function Row({ c, i, projects, sk, onField, onOp, update, remove }) {
  const f = FIELD_BY_KEY[c.field];
  const ops = opsForField(f);
  const op = ops.find((o) => o.key === c.op);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
      <span style={{ fontSize: "0.62rem", color: dim, width: 26, flexShrink: 0 }}>{i === 0 ? (sk ? "kde" : "where") : (sk ? "a" : "and")}</span>
      <select value={c.field} onChange={(e) => onField(c.id, e.target.value)} style={{ ...sel, flex: "0 0 130px" }}>
        {FIELDS.map((ff) => <option key={ff.key} value={ff.key}>{sk ? ff.label_sk : ff.label}</option>)}
      </select>
      <select value={c.op} onChange={(e) => onOp(c.id, e.target.value)} style={{ ...sel, flex: "0 0 116px" }}>
        {ops.map((o) => <option key={o.key} value={o.key}>{sk ? o.label_sk : o.label}</option>)}
      </select>
      <ValueEditor field={f} op={op} value={c.value} onChange={(v) => update(c.id, { value: v })} projects={projects} sk={sk} />
      <button onClick={() => remove(c.id)} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "1rem", flexShrink: 0, padding: "0 2px" }} aria-label="Remove">×</button>
    </div>
  );
}

function ValueEditor({ field, op, value, onChange, projects, sk }) {
  if (!op || !op.needsValue) return <div style={{ flex: 1 }} />;
  if (op.needsValue === "range") {
    return (
      <div style={{ display: "flex", gap: 4, flex: 1, alignItems: "center" }}>
        <input type="number" value={value?.[0] ?? ""} onChange={(e) => onChange([e.target.value, value?.[1] ?? ""])} placeholder={sk ? "od" : "min"} style={{ ...num, width: 0, flex: 1 }} />
        <span style={{ color: dim }}>–</span>
        <input type="number" value={value?.[1] ?? ""} onChange={(e) => onChange([value?.[0] ?? "", e.target.value])} placeholder={sk ? "do" : "max"} style={{ ...num, width: 0, flex: 1 }} />
      </div>
    );
  }
  if (op.needsValue === "one") return <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="—" style={{ ...num, flex: 1 }} />;
  if (op.needsValue === "text") return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={sk ? "text…" : "text…"} style={{ ...num, flex: 1 }} />;
  if (op.needsValue === "multi") return <MultiSelect field={field} value={value || []} onChange={onChange} projects={projects} sk={sk} />;
  return <div style={{ flex: 1 }} />;
}

function MultiSelect({ field, value, onChange, projects, sk }) {
  const label = (v) => (field.optionLabel ? field.optionLabel(v) : v);
  const opts = fieldOptions(projects, field).filter((o) => !value.includes(o));
  return (
    <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", minWidth: 0 }}>
      {value.map((v) => (
        <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: `${green}1a`, color: green, borderRadius: 5, padding: "2px 6px", fontSize: "0.72rem", maxWidth: 140 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(v)}</span>
          <span onClick={() => onChange(value.filter((x) => x !== v))} style={{ cursor: "pointer" }}>×</span>
        </span>
      ))}
      <select value="" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }} style={{ ...sel, minWidth: 88, maxWidth: 160 }}>
        <option value="">{value.length ? (sk ? "+ ďalšie" : "+ more") : (sk ? "vyber…" : "select…")}</option>
        {opts.map((o) => <option key={o} value={o}>{label(o)}</option>)}
      </select>
    </div>
  );
}

const sel = { padding: "6px 7px", background: bg2, border: `1px solid ${border}`, borderRadius: 6, color: textLight, fontSize: "0.74rem", outline: "none", cursor: "pointer", minWidth: 0 };
const num = { boxSizing: "border-box", padding: "6px 8px", background: bg2, border: `1px solid ${border}`, borderRadius: 6, color: textLight, fontSize: "0.74rem", outline: "none", minWidth: 0 };
const addBtn = { marginTop: 4, background: "none", border: `1px dashed ${border}`, color: green, borderRadius: 7, padding: "7px 12px", fontSize: "0.76rem", cursor: "pointer", width: "100%" };
