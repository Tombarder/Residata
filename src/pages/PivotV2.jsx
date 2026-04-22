import { useState, useMemo, useEffect } from "react";
import { useAllFlats, useProjects } from "../lib/useData";

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
const green   = "#00e5a0";
const orange  = "#f5a623";
const dim     = "#8a8a96";
const border  = "#222228";
const bg      = "#0a0a0b";
const panel   = "#0e0e12";
const panelHi = "#14141a";
const text    = "#e8e8ed";

/* ─── Field registry ─────────────────────────────────────────────
   Single source of truth for which fields exist, what type they are,
   how to read them from an enriched flat row, and which group they
   belong to in the palette. Adding a field = one entry here.                 */
const FIELDS = {
  // Meta
  datum:             { label: "Datum",                      group: "meta",     type: "date",   accessor: (r) => r.last_seen },
  batch_id:          { label: "Batch ID",                   group: "meta",     type: "text",   accessor: (r) => r.batch_id },
  import_status:     { label: "Import status",              group: "meta",     type: "text",   accessor: (r) => r.project_status || "active" },

  // Identity
  project_name:      { label: "Project name",               group: "identity", type: "text",   accessor: (r) => r.project_name },
  unit_id:           { label: "Unit ID",                    group: "identity", type: "text",   accessor: (r) => r.unit_id },
  typ:               { label: "Typ",                        group: "identity", type: "text",   accessor: (r) => r.typ },
  etapa:             { label: "Etapa",                      group: "identity", type: "text",   accessor: (r) => r.etapa },
  budova:            { label: "Budova",                     group: "identity", type: "text",   accessor: (r) => r.budova },
  unit_detail:       { label: "Unit/detail",                group: "identity", type: "text",   accessor: (r) => r.unit_detail },
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

  // Price
  cena_bez_dph:      { label: "Cena bez DPH",               group: "price",    type: "number", unit: "€",    accessor: (r) => num(r.cena_bez_dph) },
  cena_s_dph:        { label: "Cena s DPH",                 group: "price",    type: "number", unit: "€",    accessor: (r) => num(r.cena_s_dph) },
  dph:               { label: "DPH",                        group: "price",    type: "number", unit: "€", derived: true, accessor: (r) => {
                        const s = num(r.cena_s_dph), b = num(r.cena_bez_dph);
                        return (s != null && b != null) ? s - b : null;
                      }},
  cennikova_cena:    { label: "Cennikova cena",             group: "price",    type: "number", unit: "€",    accessor: (r) => num(r.cennikova_cena) },
  zlava:             { label: "Zlava",                      group: "price",    type: "number", unit: "€", derived: true, accessor: (r) => {
                        const c = num(r.cennikova_cena), s = num(r.cena_s_dph);
                        return (c != null && s != null) ? c - s : null;
                      }},

  // Status / attrs
  stav:              { label: "Stav",                       group: "status",   type: "text",   accessor: (r) => r.stav },
  kolaudacia:        { label: "Kolaudacia",                 group: "status",   type: "text",   accessor: (r) => r.kolaudacia },
  orientacia:        { label: "Orientacia",                 group: "status",   type: "text",   accessor: (r) => r.orientacia },

  // Location — uses enriched projects-table metadata
  cast:              { label: "Cast",                       group: "location", type: "text",   accessor: (r) => r.district },
  cast_mesta_kod:    { label: "CastMesta(kod)",             group: "location", type: "text",   accessor: (r) => r.cast_mesta_kod },
  interna_klas_zona: { label: "InternaKlasifikacia(zona)",  group: "location", type: "text",   accessor: (r) => r.interna_klas_zona },
  ulica_detail:      { label: "Ulica/Detail",               group: "location", type: "text",   accessor: (r) => r.ulica_detail },
  budova_stav:       { label: "Budova/stav",                group: "location", type: "text",   accessor: (r) => r.budova_stav },
  standard:          { label: "Standard",                   group: "location", type: "text",   accessor: (r) => r.standard },

  // Derived metric
  cena_na_m2_obytnej:{ label: "Cena na m2 obytnej",         group: "derived",  type: "number", unit: "€/m²", derived: true, accessor: (r) => {
                        const p = num(r.cena_s_dph), m = num(r.obytna_plocha);
                        return (p != null && m != null && m > 0) ? p / m : null;
                      }},
};

/* Order of fields in the palette. Mirrors Clean Master column order so the
   user's mental model stays intact when they switch between Residata and
   their Excel pivot. */
const FIELD_ORDER = [
  "datum", "batch_id", "import_status",
  "project_name", "unit_id", "typ", "etapa", "budova", "unit_detail",
  "poschodie", "izby", "obytna_plocha", "balkon", "loggia", "terasa",
  "zahrada", "exterier", "kobka", "celkova_plocha",
  "cena_bez_dph", "cena_s_dph", "dph", "cennikova_cena", "zlava",
  "stav", "kolaudacia", "orientacia",
  "cast_mesta_kod", "cast", "interna_klas_zona", "ulica_detail", "budova_stav", "standard",
  "cena_na_m2_obytnej",
];

/* Which aggregations are valid per field type. Numbers get the full numeric
   suite; text columns only count / count_distinct. */
const AGGS_TEXT   = ["count", "count_distinct"];
const AGGS_NUMBER = ["count", "count_distinct", "sum", "avg", "min", "max", "median"];
const AGG_LABEL = {
  count:          "count",
  count_distinct: "count distinct",
  sum:            "sum",
  avg:            "avg",
  min:            "min",
  max:            "max",
  median:         "median",
};

/* Max row hierarchy depth — Excel lets you go deep but the UI breaks
   down quickly past 6 columns in the result table. */
const MAX_ROWS = 6;
const MAX_VALUES = 4;

/* Path separator: unicode char unlikely to appear in any real value. */
const SEP = "\u2016";

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

/* Compute one aggregated value from a set of records. Returns a number
   (or null when the aggregation has no defined value, e.g., avg of empty). */
function compute(field, agg, records) {
  if (!field) return null;
  if (agg === "count") return records.length;

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

/* Build the pivot tree. Rolls up rollups[] per node from its own records
   — NOT from children — so every aggregation stays mathematically
   correct (avg of 10k flats ≠ avg of group averages). */
function buildTree(records, rowFields, valueDefs) {
  const rollupsFor = (recs) =>
    valueDefs.map((v) => compute(FIELDS[v.field], v.agg, recs));

  if (rowFields.length === 0) {
    return {
      label: "Total", path: [], pathKey: "",
      level: -1,
      records, count: records.length,
      rollups: rollupsFor(records),
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
        children: isDeepest ? [] : rec(items, depth + 1, path),
        isLeaf: isDeepest,
      });
    }
    return out;
  };

  return {
    label: "Total", path: [], pathKey: "",
    level: -1,
    records, count: records.length,
    rollups: rollupsFor(records),
    children: rec(records, 0, []),
    isLeaf: false,
  };
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
    // Nulls sort to the end regardless of direction
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
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
function formatValue(value, fieldKey, agg) {
  if (value == null || !Number.isFinite(value)) return "—";
  const f = FIELDS[fieldKey];
  const unit = f?.unit ? ` ${f.unit}` : "";

  // Counts — always integer, no unit
  if (agg === "count" || agg === "count_distinct") {
    return Math.round(value).toLocaleString("en-US").replace(/,/g, " ");
  }
  // AVG / MEDIAN of small-range numbers (izby, poschodie) → 1 decimal
  const oneDecAggs = new Set(["avg", "median"]);
  if (oneDecAggs.has(agg)) {
    const rounded = Math.round(value * 10) / 10;
    const isInt = Math.abs(rounded - Math.round(rounded)) < 1e-9;
    const txt = isInt
      ? Math.round(rounded).toLocaleString("en-US").replace(/,/g, " ")
      : rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/,/g, " ");
    return `${txt}${unit}`;
  }
  // SUM / MIN / MAX → integer with unit
  const rounded = Math.round(value);
  return `${rounded.toLocaleString("en-US").replace(/,/g, " ")}${unit}`;
}

function aggLabel(v) {
  return AGG_LABEL[v.agg] || v.agg;
}

/* Sensible default aggregation for a field just dropped into Values.
   User asked for COUNT default across the board — numbers start there
   too, then the user upgrades to avg/sum when they're ready. */
function defaultAggFor(_field) {
  return "count";
}

/* ══════════════════════════ Main component ════════════════════════ */
export default function PivotV2({ lang = "sk" }) {
  const { flats } = useAllFlats();
  const { projects } = useProjects();

  // Enrich flats with their project's metadata once so every accessor
  // can read off a single flat row.
  const projectById = useMemo(() => {
    const m = {};
    for (const p of projects || []) m[p.id] = p;
    return m;
  }, [projects]);

  const records = useMemo(() => {
    if (!flats?.length) return [];
    return flats.map((f) => {
      const p = projectById[f.project_id];
      return {
        ...f,
        project_name:      p?.name || f.project_id,
        project_status:    p?.status || "active",
        developer:         p?.developer || null,
        district:          p?.district || null,
        sub_district:      p?.sub_district || null,
        cast_mesta_kod:    p?.cast_mesta_kod || null,
        interna_klas_zona: p?.interna_klas_zona || null,
        ulica_detail:      p?.ulica_detail || null,
        budova_stav:       p?.budova_stav || null,
        standard:          p?.standard || null,
      };
    });
  }, [flats, projectById]);

  // ── State ─────────────────────────────────────────────────────
  // Pre-filled demo: Cast → Developer → Project name in Rows, Count only.
  // First-time visitors see the pivot computing real numbers immediately.
  const [rows,    setRows]    = useState(["cast", "developer", "project_name"]);
  const [values,  setValues]  = useState([]);
  const [filters, setFilters] = useState([]);
  const [search,  setSearch]  = useState("");
  const [drag,    setDrag]    = useState(null);
  const [hoverZone, setHoverZone] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  // Sort state: { col: "label" | "count" | valueIdx (0..n-1), dir: "asc"|"desc" }
  const [sort, setSort] = useState({ col: "count", dir: "desc" });

  const usedKeys = useMemo(() => new Set([
    ...rows,
    ...values.map(v => v.key),
    ...filters.map(f => f.key),
  ]), [rows, values, filters]);

  // ── Actions ───────────────────────────────────────────────────
  const addToZone = (fieldKey, zone) => {
    const removeEverywhere = () => {
      setRows(r => r.filter(k => k !== fieldKey));
      setValues(v => v.filter(x => x.key !== fieldKey));
      setFilters(f => f.filter(x => x.key !== fieldKey));
    };
    removeEverywhere();
    if (zone === "rows") {
      setRows(r => {
        if (r.includes(fieldKey)) return r;
        if (r.length >= MAX_ROWS) return r;
        return [...r, fieldKey];
      });
    } else if (zone === "values") {
      setValues(v => {
        if (v.length >= MAX_VALUES) return v;
        const fld = FIELDS[fieldKey];
        return [...v, { key: fieldKey, field: fieldKey, agg: defaultAggFor(fld) }];
      });
    } else if (zone === "filters") {
      setFilters(f => [...f, { key: fieldKey }]);
    }
    // zone === "palette" → just removal (done above)
  };

  const removeFromZone = (zone, fieldKey) => {
    if (zone === "rows")    setRows(r => r.filter(k => k !== fieldKey));
    if (zone === "values")  setValues(v => v.filter(x => x.key !== fieldKey));
    if (zone === "filters") setFilters(f => f.filter(x => x.key !== fieldKey));
  };

  const changeValueAgg = (fieldKey, newAgg) => {
    setValues(vs => vs.map(v => v.key === fieldKey ? { ...v, agg: newAgg } : v));
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
  const effectiveValues = values.length > 0
    ? values
    : [{ key: "__count__", field: null, agg: "count" }];

  const rawTree = useMemo(
    () => buildTree(records, rows, effectiveValues),
    [records, rows, effectiveValues]
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
  return (
    <div style={{
      background: `linear-gradient(135deg, #0e0e12 0%, #0a0a0c 100%)`,
      border: `1px solid ${green}40`, borderRadius: 12, padding: "1.25rem",
      boxShadow: "0 0 28px rgba(0,229,160,0.05)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <span style={{ padding: "3px 8px", background: green, color: bg, borderRadius: 3, fontSize: "0.68rem", fontWeight: 800, fontFamily: mono, letterSpacing: "0.1em" }}>PIVOT v2</span>
          <span style={{ fontSize: "0.74rem", color: dim, fontFamily: mono, letterSpacing: "0.05em" }}>
            {records.length.toLocaleString("en-US").replace(/,/g, " ")} {lang === "sk" ? "bytov v datasete" : "units in dataset"}
          </span>
        </div>
        {rows.length >= 2 && (
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button onClick={expandAll}   style={miniBtn}>▾ {lang === "sk" ? "Rozbaliť" : "Expand"}</button>
            <button onClick={collapseAll} style={miniBtn}>▸ {lang === "sk" ? "Zbaliť" : "Collapse"}</button>
          </div>
        )}
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 280px", gap: "1rem",
        marginBottom: "1rem",
      }} className="pivotv2-grid">
        <LeftPanel
          rows={rows} values={values} filters={filters}
          drag={drag} setDrag={setDrag}
          hoverZone={hoverZone} setHoverZone={setHoverZone}
          onDropToZone={(zone) => { if (!drag) return; addToZone(drag.fieldKey, zone); setDrag(null); setHoverZone(null); }}
          removeFromZone={removeFromZone}
          changeValueAgg={changeValueAgg}
          lang={lang}
        />
        <RightPanel
          usedKeys={usedKeys}
          search={search} setSearch={setSearch}
          drag={drag} setDrag={setDrag}
          hoverZone={hoverZone} setHoverZone={setHoverZone}
          onDropBack={() => {
            if (drag && drag.fromZone !== "palette") addToZone(drag.fieldKey, "palette");
            setDrag(null); setHoverZone(null);
          }}
          lang={lang}
        />
      </div>

      {/* Result table */}
      <ResultTable
        rowFields={rows}
        effectiveValues={effectiveValues}
        flatRows={flatRows}
        collapsed={collapsed}
        onToggle={toggleCollapse}
        sort={sort} setSort={setSort}
        grandTotal={sortedTree}
        lang={lang}
      />

      <style>{`
        @media (max-width: 820px) { .pivotv2-grid { grid-template-columns: 1fr !important; } }
      `}</style>
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
function LeftPanel({ rows, values, filters, drag, setDrag, hoverZone, setHoverZone, onDropToZone, removeFromZone, changeValueAgg, lang }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <DropZone
        zoneKey="rows"
        title={lang === "sk" ? "Riadky" : "Rows"}
        hint={lang === "sk" ? "Potiahni pole sem — bude group-by os (hierarchia)." : "Drop a field here — becomes a group-by axis."}
        icon="↓"
        chips={rows.map(k => ({ key: k, label: FIELDS[k]?.label || k, type: FIELDS[k]?.type }))}
        drag={drag} setDrag={setDrag}
        hoverZone={hoverZone} setHoverZone={setHoverZone}
        onDrop={() => onDropToZone("rows")}
        onRemove={(k) => removeFromZone("rows", k)}
      />
      <DropZone
        zoneKey="values"
        title={lang === "sk" ? "Hodnoty" : "Values"}
        hint={lang === "sk" ? "Potiahni pole sem — bude sa agregovať (default: count; zmeň kliknutím na chip)." : "Drop a field here — aggregated (default: count; click the chip to change)."}
        icon="Σ"
        chips={values.map(v => ({ key: v.key, label: FIELDS[v.key]?.label || v.key, type: FIELDS[v.key]?.type, agg: v.agg }))}
        drag={drag} setDrag={setDrag}
        hoverZone={hoverZone} setHoverZone={setHoverZone}
        onDrop={() => onDropToZone("values")}
        onRemove={(k) => removeFromZone("values", k)}
        onChangeAgg={changeValueAgg}
      />
      <DropZone
        zoneKey="filters"
        title={lang === "sk" ? "Filtre" : "Filters"}
        hint={lang === "sk" ? "Potiahni pole sem — filtre prídu v ďalšom kroku." : "Drop a field here — filter UI coming next."}
        icon="⚑"
        chips={filters.map(f => ({ key: f.key, label: FIELDS[f.key]?.label || f.key, type: FIELDS[f.key]?.type }))}
        drag={drag} setDrag={setDrag}
        hoverZone={hoverZone} setHoverZone={setHoverZone}
        onDrop={() => onDropToZone("filters")}
        onRemove={(k) => removeFromZone("filters", k)}
      />
    </div>
  );
}

function DropZone({ zoneKey, title, hint, icon, chips, drag, hoverZone, setHoverZone, onDrop, onRemove, onChangeAgg }) {
  const isHover = hoverZone === zoneKey && drag;
  const isDragging = drag != null;
  return (
    <div
      onDragOver={(e) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setHoverZone(zoneKey); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && hoverZone === zoneKey) setHoverZone(null); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      style={{
        background: isHover ? "rgba(0,229,160,0.07)" : panel,
        border: `1px dashed ${isHover ? green : (isDragging ? "#2c2c36" : border)}`,
        borderRadius: 8, padding: "0.75rem 0.9rem",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: chips.length ? "0.55rem" : "0.3rem" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 22, height: 22, borderRadius: 4,
          background: "rgba(0,229,160,0.12)", color: green,
          fontFamily: mono, fontSize: "0.76rem", fontWeight: 800,
        }}>{icon}</span>
        <span style={{ fontFamily: mono, fontSize: "0.8rem", color: text, fontWeight: 700, letterSpacing: "0.04em" }}>{title}</span>
        <span style={{ fontFamily: mono, fontSize: "0.66rem", color: dim }}>({chips.length})</span>
      </div>
      {chips.length === 0 ? (
        <div style={{ fontSize: "0.74rem", color: dim, fontStyle: "italic", lineHeight: 1.45 }}>{hint}</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
          {chips.map((c, idx) => (
            <ChipInZone
              key={c.key}
              label={c.label}
              type={c.type}
              agg={c.agg}
              level={zoneKey === "rows" ? idx : null}
              onDragStart={() => setHoverZone(null)}
              onDragStartPayload={() => ({ fromZone: zoneKey, fieldKey: c.key })}
              onRemove={() => onRemove(c.key)}
              onChangeAgg={onChangeAgg ? (a) => onChangeAgg(c.key, a) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* A chip inside a drop zone. In Values zone the chip carries an agg
   dropdown directly — click to cycle or pick from a menu. */
function ChipInZone({ label, type, agg, level, onDragStart, onDragStartPayload, onRemove, onChangeAgg }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const aggs = type === "number" ? AGGS_NUMBER : AGGS_TEXT;
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", label);
        const payload = onDragStartPayload();
        // Expose via parent callback — we mutate via onDragStart side effect
        if (onDragStart) onDragStart();
        // Use global state — set via parent through drag dispatch
        window.__pivotv2_drag = payload;
        // Trigger the parent state by re-dispatching via custom event
        window.dispatchEvent(new CustomEvent("pivotv2-drag-start", { detail: payload }));
      }}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.35rem",
        padding: "0.3rem 0.45rem 0.3rem 0.55rem", borderRadius: 100,
        background: "rgba(0,229,160,0.14)", border: `1px solid ${green}`,
        color: green, fontFamily: mono, fontSize: "0.72rem",
        cursor: "grab", userSelect: "none", position: "relative",
      }}
    >
      {level != null && (
        <span style={{ opacity: 0.65, fontSize: "0.58rem", padding: "0 2px" }}>L{level + 1}</span>
      )}
      <span style={{ fontWeight: 600 }}>{label}</span>
      {agg != null && onChangeAgg && (
        <>
          <span style={{ color: dim, opacity: 0.5, fontSize: "0.58rem" }}>·</span>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
            onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
            style={{
              background: "transparent", border: "none",
              color: green, cursor: "pointer", padding: 0,
              fontFamily: mono, fontSize: "0.7rem",
            }}
            title="Zmeň agregáciu"
          >
            {AGG_LABEL[agg] || agg} ▾
          </button>
          {menuOpen && (
            <div style={{
              position: "absolute", top: "100%", left: 0, marginTop: 4,
              background: "#0b0b0e", border: `1px solid ${green}`,
              borderRadius: 6, padding: "0.25rem",
              boxShadow: "0 12px 32px rgba(0,0,0,0.8)",
              zIndex: 900, minWidth: 140,
            }}>
              {aggs.map(a => (
                <button
                  key={a}
                  onClick={() => { onChangeAgg(a); setMenuOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "0.3rem 0.55rem", borderRadius: 3,
                    background: a === agg ? "rgba(0,229,160,0.14)" : "transparent",
                    color: a === agg ? green : text,
                    border: "none", fontFamily: mono, fontSize: "0.72rem",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { if (a !== agg) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
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
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove"
        style={{ background: "transparent", border: "none", color: green, cursor: "pointer", padding: 0, fontSize: "0.95rem", lineHeight: 1 }}
      >×</button>
    </span>
  );
}

/* ─── RIGHT PANEL (palette) ─────────────────────────────────── */
function RightPanel({ usedKeys, search, setSearch, drag, setDrag, hoverZone, setHoverZone, onDropBack, lang }) {
  // Wire drag events from chips via a DOM-level custom event (chips live
  // in siblings, easier than prop-drilling a setDrag everywhere).
  useEffect(() => {
    const h = (e) => setDrag({ ...e.detail });
    window.addEventListener("pivotv2-drag-start", h);
    return () => window.removeEventListener("pivotv2-drag-start", h);
  }, [setDrag]);

  const q = search.trim().toLowerCase();
  const filtered = FIELD_ORDER
    .map(k => ({ key: k, ...FIELDS[k] }))
    .filter(f => !q || f.label.toLowerCase().includes(q));

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
          <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: "0.62rem", color: "#ff6b6b", letterSpacing: "0.08em", textTransform: "uppercase" }}>
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
          onFocus={(e) => e.currentTarget.style.borderColor = green + "aa"}
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

function PaletteField({ field, used, onDragStart }) {
  const typeBadge = field.type === "number" ? "#" : (field.type === "date" ? "📅" : "T");
  const typeColor = field.type === "number" ? orange : green;
  return (
    <div
      draggable={!used}
      onDragStart={(e) => {
        if (used) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", field.key);
        onDragStart();
      }}
      title={used ? "Už v jednej zo zón" : "Potiahni do Riadky / Hodnoty / Filtre"}
      style={{
        display: "flex", alignItems: "center", gap: "0.45rem",
        padding: "0.32rem 0.55rem", borderRadius: 4,
        color: used ? "#4a4a55" : text, fontSize: "0.78rem",
        cursor: used ? "not-allowed" : "grab", userSelect: "none",
        borderLeft: "2px solid transparent", transition: "background 0.1s, border-color 0.1s",
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
      <span style={{ fontFamily: mono, fontSize: "0.62rem", width: 16, textAlign: "center", color: typeColor, opacity: used ? 0.35 : 1, fontWeight: 700 }}>
        {typeBadge}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{field.label}</span>
      {used && <span style={{ fontFamily: mono, fontSize: "0.58rem", color: dim, opacity: 0.6 }}>✓</span>}
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
  };
  return labels[g] || g;
}

/* ─── RESULT TABLE ────────────────────────────────────────────── */
function ResultTable({ rowFields, effectiveValues, flatRows, collapsed, onToggle, sort, setSort, grandTotal, lang }) {
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
    return `${AGG_LABEL[v.agg]} · ${FIELDS[v.field]?.label || v.field}`;
  };

  const clickSort = (col) => {
    setSort(cur => {
      if (cur.col === col) return { col, dir: cur.dir === "desc" ? "asc" : "desc" };
      return { col, dir: "desc" };
    });
  };
  const sortIndicator = (col) => {
    if (sort.col !== col) return null;
    return <span style={{ marginLeft: 4, color: green }}>{sort.dir === "desc" ? "▾" : "▴"}</span>;
  };

  return (
    <div style={{
      border: `1px solid ${border}`, borderRadius: 8, overflow: "auto",
      background: panel, maxHeight: 720,
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead style={{ background: "#0e0e10", position: "sticky", top: 0, zIndex: 2 }}>
          <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.64rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {/* Hierarchy label column — spans the row-fields, labelled with the
                chain (L1 Cast › L2 Developer › …) */}
            <th style={{ ...th, minWidth: 260, cursor: "pointer" }} onClick={() => clickSort("label")}>
              {rowFields.map((f, i) => (
                <span key={f} style={{ color: i === 0 ? green : dim }}>
                  {i > 0 && <span style={{ color: dim, opacity: 0.5, margin: "0 0.3rem" }}>›</span>}
                  <span style={{ opacity: 0.65, marginRight: 3 }}>L{i + 1}</span>{FIELDS[f]?.label}
                </span>
              ))}
              {sortIndicator("label")}
            </th>
            <th style={{ ...th, textAlign: "right", minWidth: 60, cursor: "pointer" }} onClick={() => clickSort("count")}>
              #{sortIndicator("count")}
            </th>
            {effectiveValues.map((v, i) => (
              <th key={v.key} style={{ ...th, textAlign: "right", minWidth: 100, color: green, cursor: "pointer" }} onClick={() => clickSort(i)}>
                {valueHeaderText(v)}{sortIndicator(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flatRows.map((n, idx) => {
            const isSubtotal = !n.isLeaf;
            const shade = ["#12121a", "#0f0f14", "#0c0c0f", "#0b0b0c", "#0a0a0b"][Math.min(n.level, 4)];
            const indent = 0.4 + n.level * 0.8;
            return (
              <tr key={n.pathKey + "|" + idx} style={{
                background: isSubtotal ? shade : (idx % 2 ? "transparent" : "rgba(255,255,255,0.015)"),
                borderTop: n.level === 0 ? `1px solid ${border}` : `1px solid #16161a`,
              }}>
                <td style={{
                  ...td, paddingLeft: `${indent}rem`,
                  fontWeight: isSubtotal ? 700 : 400,
                  color: isSubtotal ? text : "#c4c4cc",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {isSubtotal && (
                    <span style={{ fontFamily: mono, fontSize: "0.55rem", color: green, opacity: 0.7, marginRight: "0.4rem", padding: "1px 4px", border: `1px solid ${green}33`, borderRadius: 3, verticalAlign: "middle" }}>
                      L{n.level + 1}
                    </span>
                  )}
                  {n.hasChildren ? (
                    <button onClick={() => onToggle(n.pathKey)}
                      style={{ background: "transparent", border: "none", color: green, cursor: "pointer", padding: 0, marginRight: "0.35rem", fontSize: "0.7rem", width: 12, display: "inline-block", verticalAlign: "middle" }}
                      title={n.isCollapsed ? "Expand" : "Collapse"}>
                      {n.isCollapsed ? "▸" : "▾"}
                    </button>
                  ) : (
                    <span style={{ display: "inline-block", width: 12, marginRight: "0.35rem" }} />
                  )}
                  <span title={n.label}>{n.label}</span>
                  {isSubtotal && n.isCollapsed && (
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.64rem", color: dim, fontFamily: mono, opacity: 0.7 }}>
                      ({n.children.length} {lang === "sk" ? "pod" : "sub"})
                    </span>
                  )}
                </td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono, color: isSubtotal ? "#c4c4cc" : dim, fontWeight: isSubtotal ? 600 : 400 }}>
                  {n.count.toLocaleString("en-US").replace(/,/g, " ")}
                </td>
                {effectiveValues.map((v, i) => (
                  <td key={v.key} style={{ ...td, textAlign: "right", fontFamily: mono, color: green, fontWeight: isSubtotal ? 800 : 600 }}>
                    {isSubtotal && <span style={{ opacity: 0.5, marginRight: "0.3rem" }}>Σ</span>}
                    {formatValue(n.rollups[i], v.field, v.agg)}
                  </td>
                ))}
              </tr>
            );
          })}
          {/* Grand total */}
          <tr style={{ background: bg, borderTop: `2px solid ${green}66` }}>
            <td style={{ ...td, fontWeight: 800, color: green, fontFamily: mono, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: "0.74rem" }}>
              Σ {lang === "sk" ? "CELKOM" : "TOTAL"}
            </td>
            <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green, fontWeight: 700 }}>
              {grandTotal.count.toLocaleString("en-US").replace(/,/g, " ")}
            </td>
            {effectiveValues.map((v, i) => (
              <td key={v.key} style={{ ...td, textAlign: "right", fontFamily: mono, color: green, fontWeight: 900, fontSize: "0.9rem" }}>
                {formatValue(grandTotal.rollups[i], v.field, v.agg)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const th = { padding: "0.65rem 0.75rem", fontWeight: 700, borderBottom: `1px solid ${border}` };
const td = { padding: "0.45rem 0.75rem", borderBottom: "none" };
