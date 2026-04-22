import { useState, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════
   Pivot v2 — clean-slate rebuild of the pivot UI along the same mental
   model as Excel / Google Sheets pivot tables.

   Layout:
     ┌────────────────────────────────┬─────────────────────┐
     │  LEFT — drop targets           │  RIGHT — fields     │
     │                                │                     │
     │  Riadky   (rows / group-by)    │  🔍 search          │
     │  Hodnoty  (values / measures)  │  ─────────          │
     │  Filtre   (filters)            │  Datum              │
     │                                │  Batch ID           │
     │                                │  Import status      │
     │                                │  Project name       │
     │                                │  …                  │
     │                                │  (scrollable)       │
     └────────────────────────────────┴─────────────────────┘
     ┌────────────────────────────────────────────────────────┐
     │  RESULT PREVIEW (empty until user drops fields)        │
     └────────────────────────────────────────────────────────┘

   Drag & drop: every field on the right is draggable; each of the 3
   zones on the left accepts drops. Chips in a zone can be dragged
   between zones. Dragging a chip back to the palette (or clicking ×)
   removes it.

   This file is the SKELETON only — no compute logic yet. Next iteration
   will wire it to Clean Master data + run actual aggregation. Kept
   side-by-side with the legacy AnalyticsPivot while the UX is iterated.
*/

const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#0a0a0b";
const panel = "#0e0e12";
const panelHi = "#14141a";
const text = "#e8e8ed";

/* Canonical Clean Master header list — matches columns A..AH in the
   Clean Master sheet exactly, in the same order. This is the single
   source of truth for which fields the pivot exposes. */
const CLEAN_MASTER_FIELDS = [
  { key: "datum",              label: "Datum",                      type: "text",    group: "meta" },
  { key: "batch_id",           label: "Batch ID",                   type: "text",    group: "meta" },
  { key: "import_status",      label: "Import status",              type: "text",    group: "meta" },
  { key: "project_name",       label: "Project name",               type: "text",    group: "identity" },
  { key: "unit_id",            label: "Unit ID",                    type: "text",    group: "identity" },
  { key: "typ",                label: "Typ",                        type: "text",    group: "identity" },
  { key: "etapa",              label: "Etapa",                      type: "text",    group: "identity" },
  { key: "budova",             label: "Budova",                     type: "text",    group: "identity" },
  { key: "unit_detail",        label: "Unit/detail",                type: "text",    group: "identity" },
  { key: "poschodie",          label: "Poschodie",                  type: "number",  group: "spec" },
  { key: "izby",               label: "#izieb",                     type: "number",  group: "spec" },
  { key: "obytna_plocha",      label: "Obytna plocha",              type: "number",  group: "spec" },
  { key: "balkon",             label: "Balkon",                     type: "number",  group: "spec" },
  { key: "loggia",             label: "Loggia",                     type: "number",  group: "spec" },
  { key: "terasa",             label: "Terasa",                     type: "number",  group: "spec" },
  { key: "zahrada",            label: "Zahrada",                    type: "number",  group: "spec" },
  { key: "exterier",           label: "Exterier",                   type: "number",  group: "spec" },
  { key: "kobka",              label: "Kobka",                      type: "number",  group: "spec" },
  { key: "celkova_plocha",     label: "Celkova plocha",             type: "number",  group: "spec" },
  { key: "cena_bez_dph",       label: "Cena bez DPH",               type: "number",  group: "price" },
  { key: "cena_s_dph",         label: "Cena s DPH",                 type: "number",  group: "price" },
  { key: "dph",                label: "DPH",                        type: "number",  group: "price" },
  { key: "cennikova_cena",     label: "Cennikova cena",             type: "number",  group: "price" },
  { key: "zlava",              label: "Zlava",                      type: "number",  group: "price" },
  { key: "stav",               label: "Stav",                       type: "text",    group: "status" },
  { key: "kolaudacia",         label: "Kolaudacia",                 type: "text",    group: "status" },
  { key: "orientacia",         label: "Orientacia",                 type: "text",    group: "status" },
  { key: "cast_mesta_kod",     label: "CastMesta(kod)",             type: "text",    group: "location" },
  { key: "cast",               label: "Cast",                       type: "text",    group: "location" },
  { key: "interna_klas_zona",  label: "InternaKlasifikacia(zona)",  type: "text",    group: "location" },
  { key: "ulica_detail",       label: "Ulica/Detail",               type: "text",    group: "location" },
  { key: "budova_stav",        label: "Budova/stav",                type: "text",    group: "location" },
  { key: "standard",           label: "Standard",                   type: "text",    group: "location" },
  { key: "cena_na_m2_obytnej", label: "Cena na m2 obytnej",         type: "number",  group: "derived" },
];

/* DnD payload — single source of truth for which field is being
   dragged + where from. Using a module-level ref (via a tiny custom
   hook) isn't necessary here; we lift drag state to the parent. */
export default function PivotV2({ lang = "sk" }) {
  const [rows,    setRows]    = useState([]);    // array of field keys
  const [values,  setValues]  = useState([]);    // array of { key, agg }
  const [filters, setFilters] = useState([]);    // array of { key, … }
  const [search,  setSearch]  = useState("");
  const [drag,    setDrag]    = useState(null);  // { fromZone, fieldKey } | null
  const [hoverZone, setHoverZone] = useState(null);

  // A field is "used" if it appears in any zone — greyed out in the palette.
  const usedKeys = useMemo(() => new Set([
    ...rows,
    ...values.map(v => v.key),
    ...filters.map(f => f.key),
  ]), [rows, values, filters]);

  const fieldByKey = useMemo(() => {
    const m = {};
    for (const f of CLEAN_MASTER_FIELDS) m[f.key] = f;
    return m;
  }, []);

  // Add to a zone. Removes from other zones first (a field lives in only
  // one zone at a time; Excel allows duplicates, we keep it simple).
  const addToZone = (fieldKey, zone) => {
    const removeEverywhere = () => {
      setRows(r => r.filter(k => k !== fieldKey));
      setValues(v => v.filter(x => x.key !== fieldKey));
      setFilters(f => f.filter(x => x.key !== fieldKey));
    };
    if (zone === "rows") {
      removeEverywhere();
      setRows(r => r.includes(fieldKey) ? r : [...r, fieldKey]);
    } else if (zone === "values") {
      removeEverywhere();
      const fld = fieldByKey[fieldKey];
      const defaultAgg = fld?.type === "number" ? "sum" : "count";
      setValues(v => [...v, { key: fieldKey, agg: defaultAgg }]);
    } else if (zone === "filters") {
      removeEverywhere();
      setFilters(f => [...f, { key: fieldKey }]);
    } else if (zone === "palette") {
      removeEverywhere();
    }
  };

  const removeFromZone = (zone, fieldKey) => {
    if (zone === "rows")    setRows(r => r.filter(k => k !== fieldKey));
    if (zone === "values")  setValues(v => v.filter(x => x.key !== fieldKey));
    if (zone === "filters") setFilters(f => f.filter(x => x.key !== fieldKey));
  };

  const reorderInZone = (zone, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    const move = (arr) => {
      const c = [...arr];
      const [it] = c.splice(fromIdx, 1);
      c.splice(toIdx, 0, it);
      return c;
    };
    if (zone === "rows")    setRows(move);
    if (zone === "values")  setValues(move);
    if (zone === "filters") setFilters(move);
  };

  return (
    <div style={{
      background: `linear-gradient(135deg, #0e0e12 0%, #0a0a0c 100%)`,
      border: `1px solid ${green}30`,
      borderRadius: 12, padding: "1.25rem",
      boxShadow: "0 0 28px rgba(0,229,160,0.04)",
    }}>
      {/* Top banner: title + WIP flag */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <span style={{ padding: "3px 8px", background: green, color: "#0a0a0b", borderRadius: 3, fontSize: "0.68rem", fontWeight: 800, fontFamily: mono, letterSpacing: "0.1em" }}>PIVOT v2</span>
          <span style={{ fontSize: "0.74rem", color: dim, fontFamily: mono, letterSpacing: "0.05em" }}>
            {lang === "sk" ? "Excel-style · drag & drop" : "Excel-style · drag & drop"}
          </span>
        </div>
        <span style={{ padding: "3px 8px", background: "rgba(245,166,35,0.12)", color: "#f5a623", borderRadius: 3, fontSize: "0.66rem", fontFamily: mono, letterSpacing: "0.1em", border: "1px solid rgba(245,166,35,0.4)" }}>
          WIP — kostra
        </span>
      </div>

      {/* Main grid: left (drop zones) + right (field palette) */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 280px",
        gap: "1rem",
        marginBottom: "1rem",
      }} className="pivotv2-grid">
        <LeftPanel
          rows={rows} values={values} filters={filters}
          fieldByKey={fieldByKey}
          drag={drag} setDrag={setDrag}
          hoverZone={hoverZone} setHoverZone={setHoverZone}
          onDropToZone={(zone) => {
            if (!drag) return;
            addToZone(drag.fieldKey, zone);
            setDrag(null); setHoverZone(null);
          }}
          removeFromZone={removeFromZone}
          lang={lang}
        />
        <RightPanel
          fields={CLEAN_MASTER_FIELDS}
          usedKeys={usedKeys}
          search={search}
          setSearch={setSearch}
          drag={drag} setDrag={setDrag}
          hoverZone={hoverZone} setHoverZone={setHoverZone}
          onDropBack={() => {
            if (drag && drag.fromZone !== "palette") {
              addToZone(drag.fieldKey, "palette");
            }
            setDrag(null); setHoverZone(null);
          }}
          lang={lang}
        />
      </div>

      {/* Result preview — empty until there's something to compute */}
      <ResultPreview rows={rows} values={values} filters={filters} fieldByKey={fieldByKey} lang={lang} />

      <style>{`
        @media (max-width: 820px) {
          .pivotv2-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

/* ── LEFT PANEL — 3 drop zones ────────────────────────────── */
function LeftPanel({ rows, values, filters, fieldByKey, drag, setDrag, hoverZone, setHoverZone, onDropToZone, removeFromZone, lang }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <DropZone
        zoneKey="rows"
        title={lang === "sk" ? "Riadky" : "Rows"}
        hint={lang === "sk" ? "Potiahni pole sem — bude group-by os (hierarchia)." : "Drop a field here — it becomes a group-by axis (hierarchy)."}
        icon="↓"
        chips={rows.map(k => ({ key: k, label: fieldByKey[k]?.label || k, sub: fieldByKey[k]?.type }))}
        hoverZone={hoverZone} setHoverZone={setHoverZone}
        drag={drag} setDrag={setDrag}
        onDrop={() => onDropToZone("rows")}
        onRemove={(k) => removeFromZone("rows", k)}
      />
      <DropZone
        zoneKey="values"
        title={lang === "sk" ? "Hodnoty" : "Values"}
        hint={lang === "sk" ? "Potiahni pole sem — bude sa agregovať (sum / avg / count…)." : "Drop a field here — it will be aggregated (sum / avg / count…)."}
        icon="Σ"
        chips={values.map(v => ({ key: v.key, label: fieldByKey[v.key]?.label || v.key, sub: v.agg }))}
        hoverZone={hoverZone} setHoverZone={setHoverZone}
        drag={drag} setDrag={setDrag}
        onDrop={() => onDropToZone("values")}
        onRemove={(k) => removeFromZone("values", k)}
      />
      <DropZone
        zoneKey="filters"
        title={lang === "sk" ? "Filtre" : "Filters"}
        hint={lang === "sk" ? "Potiahni pole sem — pridá sa filter. Hodnoty vyberieš po pustení." : "Drop a field here — adds a filter. Values will be pickable after drop."}
        icon="⚑"
        chips={filters.map(f => ({ key: f.key, label: fieldByKey[f.key]?.label || f.key }))}
        hoverZone={hoverZone} setHoverZone={setHoverZone}
        drag={drag} setDrag={setDrag}
        onDrop={() => onDropToZone("filters")}
        onRemove={(k) => removeFromZone("filters", k)}
      />
    </div>
  );
}

/* A single drop zone (Rows / Values / Filters). Highlights when the
   current drag target is this zone. */
function DropZone({ zoneKey, title, hint, icon, chips, hoverZone, setHoverZone, drag, setDrag, onDrop, onRemove }) {
  const isHover = hoverZone === zoneKey && drag;
  const isDraggingSomething = drag != null;
  return (
    <div
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        setHoverZone(zoneKey);
      }}
      onDragLeave={(e) => {
        // Only clear if leaving the whole zone — not when crossing into a child
        if (!e.currentTarget.contains(e.relatedTarget)) {
          if (hoverZone === zoneKey) setHoverZone(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      style={{
        background: isHover ? "rgba(0,229,160,0.07)" : panel,
        border: `1px dashed ${isHover ? green : (isDraggingSomething ? "#2c2c36" : border)}`,
        borderRadius: 8,
        padding: "0.75rem 0.9rem",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: chips.length ? "0.55rem" : "0.3rem", gap: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 4,
            background: "rgba(0,229,160,0.12)", color: green,
            fontFamily: mono, fontSize: "0.76rem", fontWeight: 800,
          }}>{icon}</span>
          <span style={{ fontFamily: mono, fontSize: "0.8rem", color: text, fontWeight: 700, letterSpacing: "0.04em" }}>
            {title}
          </span>
          <span style={{ fontFamily: mono, fontSize: "0.66rem", color: dim }}>
            ({chips.length})
          </span>
        </div>
      </div>

      {chips.length === 0 ? (
        <div style={{ fontSize: "0.74rem", color: dim, fontStyle: "italic", lineHeight: 1.45 }}>
          {hint}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
          {chips.map((c) => (
            <ChipInZone
              key={c.key}
              label={c.label}
              sub={c.sub}
              onDragStart={() => setDrag({ fromZone: zoneKey, fieldKey: c.key })}
              onDragEnd={() => setDrag(null)}
              onRemove={() => onRemove(c.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* A chip living inside a drop zone — draggable (so user can move between
   zones) and dismissible via × button. */
function ChipInZone({ label, sub, onDragStart, onDragEnd, onRemove }) {
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", label);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.35rem",
        padding: "0.3rem 0.5rem 0.3rem 0.6rem", borderRadius: 100,
        background: "rgba(0,229,160,0.14)", border: `1px solid ${green}`,
        color: green, fontFamily: mono, fontSize: "0.72rem",
        cursor: "grab", userSelect: "none",
      }}
      onMouseDown={(e) => e.currentTarget.style.cursor = "grabbing"}
      onMouseUp={(e) => e.currentTarget.style.cursor = "grab"}
    >
      <span style={{ fontWeight: 600 }}>{label}</span>
      {sub && <span style={{ opacity: 0.65, fontSize: "0.62rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>{sub}</span>}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove"
        style={{ background: "transparent", border: "none", color: green, cursor: "pointer", padding: 0, fontSize: "0.95rem", lineHeight: 1 }}
      >×</button>
    </span>
  );
}

/* ── RIGHT PANEL — scrollable field palette ────────────────── */
function RightPanel({ fields, usedKeys, search, setSearch, drag, setDrag, hoverZone, setHoverZone, onDropBack, lang }) {
  const q = search.trim().toLowerCase();
  const filtered = q ? fields.filter(f => f.label.toLowerCase().includes(q)) : fields;
  // Group fields for subtle visual separators in the palette
  const groups = useMemo(() => {
    const out = {};
    for (const f of filtered) {
      (out[f.group] = out[f.group] || []).push(f);
    }
    return out;
  }, [filtered]);

  const isHover = hoverZone === "palette" && drag && drag.fromZone !== "palette";

  return (
    <div
      onDragOver={(e) => {
        if (drag && drag.fromZone !== "palette") {
          e.preventDefault(); e.dataTransfer.dropEffect = "move";
          setHoverZone("palette");
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          if (hoverZone === "palette") setHoverZone(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropBack();
      }}
      style={{
        background: isHover ? "rgba(255,107,107,0.06)" : panel,
        border: `1px solid ${isHover ? "#ff6b6b" : border}`,
        borderRadius: 8,
        padding: "0.75rem",
        display: "flex", flexDirection: "column",
        minHeight: 440,
        maxHeight: 600,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.55rem" }}>
        <span style={{ fontFamily: mono, fontSize: "0.7rem", color: text, fontWeight: 700, letterSpacing: "0.06em" }}>
          {lang === "sk" ? "POLIA" : "FIELDS"}
        </span>
        <span style={{ fontFamily: mono, fontSize: "0.6rem", color: dim }}>
          {filtered.length}/{fields.length}
        </span>
        {isHover && (
          <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: "0.62rem", color: "#ff6b6b", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            ↓ pusti pre odstránenie
          </span>
        )}
      </div>

      {/* Search */}
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
          onFocus={(e) => e.currentTarget.style.borderColor = green + "aa"}
          onBlur={(e) => e.currentTarget.style.borderColor = border}
        />
        <span style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: dim, fontSize: "0.9rem", pointerEvents: "none" }}>🔍</span>
      </div>

      {/* Scrollable field list, grouped with thin dividers */}
      <div style={{
        flex: 1, overflowY: "auto",
        background: bg, border: `1px solid ${border}`, borderRadius: 5,
        padding: "0.3rem",
      }}>
        {Object.entries(groups).map(([groupKey, items], gi) => (
          <div key={groupKey} style={{ marginBottom: gi < Object.keys(groups).length - 1 ? "0.4rem" : 0 }}>
            <div style={{
              fontFamily: mono, fontSize: "0.58rem", color: dim,
              letterSpacing: "0.1em", textTransform: "uppercase",
              padding: "0.3rem 0.45rem 0.2rem",
            }}>
              {groupLabel(groupKey, lang)}
            </div>
            {items.map(f => (
              <PaletteField
                key={f.key}
                field={f}
                used={usedKeys.has(f.key)}
                onDragStart={() => setDrag({ fromZone: "palette", fieldKey: f.key })}
                onDragEnd={() => setDrag(null)}
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

/* A single field row in the palette — draggable, compact, with a tiny
   type badge (t for text, # for number) so user knows at a glance what
   kind of aggregation will make sense. */
function PaletteField({ field, used, onDragStart, onDragEnd }) {
  return (
    <div
      draggable={!used}
      onDragStart={(e) => {
        if (used) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", field.key);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      title={used
        ? "Už je v jednej zo zón — odstráň ho tam, alebo potiahni späť sem."
        : "Potiahni do Riadky / Hodnoty / Filtre."}
      style={{
        display: "flex", alignItems: "center", gap: "0.45rem",
        padding: "0.32rem 0.55rem",
        borderRadius: 4,
        background: used ? "transparent" : "transparent",
        color: used ? "#4a4a55" : text,
        fontSize: "0.78rem",
        cursor: used ? "not-allowed" : "grab",
        userSelect: "none",
        borderLeft: `2px solid ${used ? "transparent" : "transparent"}`,
        transition: "background 0.1s, border-color 0.1s",
      }}
      onMouseEnter={(e) => {
        if (used) return;
        e.currentTarget.style.background = panelHi;
        e.currentTarget.style.borderLeftColor = green;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderLeftColor = "transparent";
      }}
    >
      <span style={{
        fontFamily: mono, fontSize: "0.62rem", width: 16, textAlign: "center",
        color: field.type === "number" ? "#f5a623" : green,
        opacity: used ? 0.35 : 1,
        fontWeight: 700,
      }}>
        {field.type === "number" ? "#" : "T"}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {field.label}
      </span>
      {used && <span style={{ fontFamily: mono, fontSize: "0.58rem", color: dim, opacity: 0.6 }}>✓</span>}
      {!used && <span style={{ fontFamily: mono, fontSize: "0.55rem", color: dim, opacity: 0.5 }}>⋮⋮</span>}
    </div>
  );
}

function groupLabel(g, lang) {
  const labels = {
    meta:     lang === "sk" ? "Meta"             : "Meta",
    identity: lang === "sk" ? "Identifikácia"    : "Identity",
    spec:     lang === "sk" ? "Špecifikácia bytu": "Unit spec",
    price:    lang === "sk" ? "Cena"             : "Price",
    status:   lang === "sk" ? "Stav"             : "Status",
    location: lang === "sk" ? "Lokalita"         : "Location",
    derived:  lang === "sk" ? "Vypočítané"       : "Derived",
  };
  return labels[g] || g;
}

/* ── RESULT PREVIEW — placeholder for the skeleton phase ───── */
function ResultPreview({ rows, values, filters, fieldByKey, lang }) {
  const hasAnything = rows.length + values.length + filters.length > 0;
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 8,
      padding: "1.25rem",
      minHeight: 160,
      textAlign: "center",
      color: dim,
      fontSize: "0.8rem",
    }}>
      {!hasAnything ? (
        <>
          <div style={{ fontFamily: mono, fontSize: "0.68rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.6rem" }}>
            {lang === "sk" ? "Výsledok" : "Result"}
          </div>
          <div style={{ fontSize: "0.82rem", color: text, marginBottom: "0.3rem" }}>
            {lang === "sk"
              ? "Potiahni polia do Riadky a Hodnoty — pivot sa zobrazí tu."
              : "Drag fields into Rows and Values — the pivot will appear here."}
          </div>
          <div style={{ fontSize: "0.72rem", color: dim, lineHeight: 1.55 }}>
            {lang === "sk"
              ? "Napr. Riadky = Cast + Developer, Hodnoty = Cena s DPH (avg), Filtre = Stav (len V)."
              : "Example: Rows = District + Developer, Values = Price (avg), Filters = Status (only V)."}
          </div>
        </>
      ) : (
        <div style={{ textAlign: "left" }}>
          <div style={{ fontFamily: mono, fontSize: "0.68rem", color: green, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.6rem" }}>
            {lang === "sk" ? "Kostra konfigurácie" : "Config skeleton"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.4rem 1rem", alignItems: "baseline", fontSize: "0.8rem", color: text, fontFamily: mono }}>
            <span style={{ color: dim }}>Riadky:</span>
            <span>{rows.length > 0 ? rows.map(k => fieldByKey[k]?.label).join("  →  ") : <em style={{ color: dim }}>—</em>}</span>
            <span style={{ color: dim }}>Hodnoty:</span>
            <span>{values.length > 0 ? values.map(v => `${v.agg}(${fieldByKey[v.key]?.label})`).join("  ·  ") : <em style={{ color: dim }}>—</em>}</span>
            <span style={{ color: dim }}>Filtre:</span>
            <span>{filters.length > 0 ? filters.map(f => fieldByKey[f.key]?.label).join("  ·  ") : <em style={{ color: dim }}>—</em>}</span>
          </div>
          <div style={{ marginTop: "1rem", padding: "0.75rem", background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.3)", borderRadius: 6, fontSize: "0.74rem", color: "#f5a623", textAlign: "center" }}>
            {lang === "sk"
              ? "🛠 Výpočet pivotu pridáme v ďalšom kroku — najprv doladíme kostru."
              : "🛠 Pivot computation coming in the next iteration — we're aligning the skeleton first."}
          </div>
        </div>
      )}
    </div>
  );
}
