/**
 * SortableTable — the platform's ONE way to make a table column sortable.
 *
 * Every table on the platform sorts, and every one of them had invented its own: the
 * Projects list kept a `SortableTh` private to LivePages, the Unit database and Predaje
 * each wrote their own `<th onClick={toggleSort}>`, the Pivot a third, and the Usage
 * dashboard — ten columns of "who uses this most" — simply had none, so you could not
 * rank your own users by sessions or by time spent.
 *
 * Two pieces, deliberately separate:
 *   · useTableSort  — the state and the comparator. Numbers open DESCENDING (the biggest
 *     first is what anyone means by "sort by sessions"), text opens ascending, and the
 *     comparator uses the reader's locale so Č lands after C rather than after Z.
 *   · SortableTh    — the header cell: the click target, the keyboard handling, and the
 *     arrow that says which column is doing the work.
 *
 * Nulls always sort LAST regardless of direction. A missing value is not a small value,
 * and putting the blanks on top of a "highest first" ranking hides the answer.
 */
import { useState, useMemo } from "react";
import { localeTag } from "../lib/locale";

/**
 * @param cols  { [key]: { kind: "num" | "text" | "date", get: (row) => value } }
 * @param initial  { key, dir } — the column the table opens on
 */
export function useTableSort(cols, initial, lang = "sk") {
  const [sort, setSort] = useState(initial);

  const onHeaderClick = (key) => {
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: cols[key]?.kind === "num" || cols[key]?.kind === "date" ? "desc" : "asc" }));
  };

  const sortArrow = (key) => (sort.key !== key
    ? <span style={{ opacity: 0.25, marginLeft: 4, fontSize: "0.65rem" }}>↕</span>
    : <span style={{ color: "var(--accent-ink)", marginLeft: 4, fontSize: "0.7rem" }}>{sort.dir === "asc" ? "▴" : "▾"}</span>);

  const sortRows = useMemo(() => {
    const col = cols[sort.key];
    const locale = localeTag(lang);
    return (arr) => {
      if (!col || !Array.isArray(arr)) return arr || [];
      const dir = sort.dir === "desc" ? -1 : 1;
      return [...arr].sort((a, b) => {
        const av = col.get(a), bv = col.get(b);
        // A blank is not a small number — it goes last either way.
        const an = av == null || av === "", bn = bv == null || bv === "";
        if (an && bn) return 0;
        if (an) return 1;
        if (bn) return -1;
        if (col.kind === "num") return (Number(av) - Number(bv)) * dir;
        if (col.kind === "date") return (new Date(av) - new Date(bv)) * dir;
        return String(av).localeCompare(String(bv), locale, { sensitivity: "base" }) * dir;
      });
    };
  }, [cols, sort, lang]);

  return { sort, setSort, onHeaderClick, sortArrow, sortRows };
}

/** One sortable header cell. `style` is the table's own <th> styling, passed in. */
export function SortableTh({ sortKey, align = "left", current, onClick, arrow, title, style, children }) {
  const active = current?.key === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(sortKey); } }}
      tabIndex={0}
      title={title}
      aria-sort={active ? (current.dir === "asc" ? "ascending" : "descending") : "none"}
      style={{
        ...style,
        textAlign: align,
        cursor: "pointer",
        color: active ? "var(--text)" : "var(--text-dim)",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}{arrow(sortKey)}
    </th>
  );
}
