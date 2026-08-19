/**
 * MapFilterBuilder — the composable filter panel for Mapa 2.
 *
 * Stack any number of conditions: pick a column → an operator (is any of /
 * is none of / has a value / is empty / between / ≥ / ≤ / contains) → values.
 * Conditions AND together. All logic lives in ../lib/mapFilters (unit-tested);
 * this is just the editor.
 */
import { createPortal } from "react-dom";
import useDismiss from "../lib/useDismiss";
import {
  FIELDS, FIELD_BY_KEY, opsForField, defaultOpForField, fieldOptions,
} from "../lib/mapFilters";
import Picker from "./Picker";

import { accent as green, accentInk, dim, text as textLight, surfaceDark as bg2, mono } from "../lib/theme";
const border = "var(--border)";
const panel = "var(--surface)";

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

export default function MapFilterBuilder({ conditions, setConditions, projects, matchCount, totalCount, sk, onClose, asModal = false, triggerRef }) {
  // Clicking anywhere outside the panel — the map, the page, another control —
  // closes it, and so does Esc (shared lib/useDismiss). `triggerRef` is the
  // "⚙ Filtre" chip that opened it: a pointer-down there must NOT auto-close,
  // or its own onClick would immediately re-open and the chip would look dead.
  // The Pickers inside render in portals and carry data-popover-layer, so using
  // one never closes the panel underneath it.
  const panelRef = useDismiss(true, onClose, triggerRef ? [triggerRef] : undefined);
  const update = (id, patch) => setConditions(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id) => setConditions(conditions.filter((c) => c.id !== id));
  const onField = (id, fieldKey) => { const f = FIELD_BY_KEY[fieldKey]; const op = defaultOpForField(f); update(id, { field: fieldKey, op, value: defaultValueFor(f, op) }); };
  const onOp = (id, opKey) => { const c = conditions.find((x) => x.id === id); update(id, { op: opKey, value: defaultValueFor(FIELD_BY_KEY[c.field], opKey) }); };

  // asModal: a compact, centered modal portaled to <body> (used on the dashboard,
  // where the big absolute overlay covered half the screen). Default: the original
  // absolute panel anchored top-left (used over the map).
  const rootStyle = asModal
    ? { width: "100%", background: panel, border: `1px solid ${border}`, borderRadius: 14, boxShadow: "0 20px 52px rgba(15,23,42,0.28)" }
    : { position: "absolute", top: 8, left: "1.25rem", zIndex: 40, width: 700, maxWidth: "calc(100% - 2.5rem)", background: panel, border: `1px solid ${border}`, borderRadius: 14, boxShadow: "0 18px 48px rgba(15,23,42,0.26)" };
  const body = (
    <div ref={panelRef} style={rootStyle}>
      <div style={{ display: "flex", alignItems: "center", padding: "15px 18px", borderBottom: `1px solid ${border}` }}>
        <span style={{ color: textLight, fontWeight: 600, fontSize: "1rem" }}>{sk ? "Filtre" : "Filters"}</span>
        <span style={{ marginLeft: 12, fontSize: "0.82rem", color: dim, fontFamily: mono }}>
          <strong style={{ color: accentInk, fontSize: "0.95rem" }}>{matchCount}</strong>{totalCount != null ? <span style={{ color: dim }}> / {totalCount}</span> : null} {sk ? "vyhovuje zadaným kritériám" : "match your criteria"}
        </span>
        <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "1.3rem", lineHeight: 1 }} aria-label="Close">×</button>
      </div>

      <div style={{ maxHeight: "min(72vh, 580px)", overflowY: "auto", padding: "14px 18px" }}>
        {conditions.length === 0 && (
          <div style={{ color: dim, fontSize: "0.86rem", padding: "10px 2px 16px", lineHeight: 1.65 }}>
            {sk ? "Žiadne filtre. Pridaj podmienku — vyber stĺpec, operátor a hodnoty. Viac podmienok sa kombinuje (A zároveň)." : "No filters yet. Add a condition — pick a column, an operator, and values. Multiple conditions combine with AND."}
          </div>
        )}
        {conditions.map((c, i) => (
          <Row key={c.id} c={c} i={i} projects={projects} sk={sk} onField={onField} onOp={onOp} update={update} remove={remove} />
        ))}
        <button onClick={() => setConditions([...conditions, makeCondition()])} style={addBtn}>+ {sk ? "Pridať filter" : "Add filter"}</button>
      </div>

      {conditions.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderTop: `1px solid ${border}` }}>
          <button onClick={() => setConditions([])} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.82rem" }}>{sk ? "Vyčistiť všetko" : "Clear all"}</button>
          <button onClick={onClose} style={{ marginLeft: "auto", background: green, color: "#06140f", border: "none", borderRadius: 9, padding: "10px 22px", fontSize: "0.84rem", fontWeight: 600, cursor: "pointer" }}>{sk ? "Hotovo" : "Done"}</button>
        </div>
      )}
    </div>
  );

  if (asModal) {
    return createPortal(
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "7vh 1rem 4vh", overflowY: "auto" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560 }}>{body}</div>
      </div>,
      document.body
    );
  }
  return body;
}

function Row({ c, i, projects, sk, onField, onOp, update, remove }) {
  const f = FIELD_BY_KEY[c.field];
  const ops = opsForField(f);
  const op = ops.find((o) => o.key === c.op);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
      <span style={{ fontSize: "0.62rem", color: dim, width: 34, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{i === 0 ? (sk ? "kde" : "where") : (sk ? "a" : "and")}</span>
      <Picker value={c.field} onChange={(v) => onField(c.id, v)} options={FIELDS.map((ff) => ({ value: ff.key, label: sk ? ff.label_sk : ff.label }))} width={184} searchable ariaLabel="Field" sk={sk} />
      <Picker value={c.op} onChange={(v) => onOp(c.id, v)} options={ops.map((o) => ({ value: o.key, label: sk ? o.label_sk : o.label }))} width={150} ariaLabel="Operator" sk={sk} />
      <ValueEditor field={f} op={op} value={c.value} onChange={(v) => update(c.id, { value: v })} projects={projects} sk={sk} />
      <button onClick={() => remove(c.id)} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "1.25rem", flexShrink: 0, padding: "0 4px", lineHeight: 1 }} aria-label="Remove">×</button>
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
  if (op.needsValue === "multi") return <Picker multi searchable value={value || []} onChange={onChange} options={fieldOptions(projects, field).map((o) => ({ value: o, label: field.optionLabel ? field.optionLabel(o) : o }))} placeholder={sk ? "vyber…" : "select…"} ariaLabel="Values" sk={sk} />;
  return <div style={{ flex: 1 }} />;
}

const num = { boxSizing: "border-box", padding: "9px 11px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: "0.84rem", outline: "none", minWidth: 0 };
const addBtn = { marginTop: 8, background: "none", border: `1px dashed ${border}`, color: accentInk, borderRadius: 9, padding: "11px 14px", fontSize: "0.84rem", cursor: "pointer", width: "100%", fontWeight: 600 };
