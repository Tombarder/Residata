/**
 * Picker — THE dropdown of the platform (single / multi / searchable). Every
 * screen uses this one, never a native <select>: the native menu paints itself
 * with the OS palette and can only show plain text, so option rows can't carry
 * the live facet counts the app relies on.
 *
 * Options are `{ value, label, hint? }` — `hint` renders right-aligned and dim
 * (used for live facet counts) and is deliberately not searched.
 *
 * The menu renders in a PORTAL with fixed positioning, so it floats above
 * everything and is never clipped by a scrolling/overflow container (the filter
 * panel). It flips upward when there isn't room below, follows the trigger on
 * scroll/resize, and closes on outside-click or Escape (shared `useDismiss`).
 *
 * `data-popover-layer` on the portal marks it as a nested layer: clicking inside
 * it must not dismiss the filter panel that opened it (see lib/useDismiss.js).
 *
 * Styling lives in styles/ui.css (`.rd-field`, `.rd-menu*`) so it themes with
 * the rest of the app in both light and dark.
 */
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import useDismiss from "../lib/useDismiss";

const norm = (s) => (s == null ? "" : String(s)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export default function Picker({ value, onChange, options, placeholder = "select…", multi = false, searchable = false, width, ariaLabel, sk = false, small = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const close = () => { setOpen(false); setQ(""); };
  const rootRef = useDismiss(open, close, [popRef]);
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(Math.max(b.width, 280), 460, vw - 16);
    const left = Math.max(8, Math.min(b.left, vw - w - 8));
    const below = vh - b.bottom, above = b.top;
    const up = below < 280 && above > below;
    const maxH = Math.max(200, Math.min((up ? above : below) - 13, 560));
    setPos({ left, top: up ? null : Math.round(b.bottom + 5), bottom: up ? Math.round(vh - b.top + 5) : null, w, maxH });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const opts = searchable && q ? options.filter((o) => norm(o.label).includes(norm(q))) : options;
  const sel = (v) => (multi ? (value || []).includes(v) : value === v);
  const pick = (v) => {
    if (multi) { const cur = value || []; onChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]); }
    else { onChange(v); close(); }
  };

  const arr = value || [];
  const empty = multi ? arr.length === 0 : (value == null || value === "");
  let label;
  if (multi) {
    if (!arr.length) label = placeholder;
    else { const first = options.find((o) => o.value === arr[0])?.label ?? arr[0]; label = arr.length > 1 ? `${first} +${arr.length - 1}` : first; }
  } else label = options.find((o) => o.value === value)?.label ?? placeholder;

  const menu = open && pos ? createPortal(
    <div ref={popRef} data-popover-layer className="rd-menu" role="listbox" aria-multiselectable={multi || undefined}
      style={{ position: "fixed", left: pos.left, top: pos.top ?? undefined, bottom: pos.bottom ?? undefined, width: pos.w, maxHeight: pos.maxH, zIndex: 1000 }}>
      {searchable && (
        <div className="rd-menu__head">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={sk ? "hľadať…" : "search…"}
            className="rd-field" style={{ width: "100%", background: "var(--bg)" }} />
        </div>
      )}
      <div className="rd-menu__opts">
        {opts.length === 0 && <div className="rd-menu__empty">{sk ? "žiadne výsledky" : "no matches"}</div>}
        {opts.map((o) => {
          const on = sel(o.value);
          return (
            <div key={String(o.value)} role="option" aria-selected={on} className="rd-menu__opt" onClick={() => pick(o.value)}>
              {multi && <span className="rd-menu__box">{on ? "✓" : ""}</span>}
              <span className="rd-menu__opt-label">{o.label}</span>
              {/* `hint` is a secondary right-aligned note (e.g. how many rows an option still
                  matches). Kept OUT of `label` on purpose so the search box matches names only. */}
              {o.hint != null && o.hint !== "" && <span className="rd-menu__hint">{o.hint}</span>}
              {!multi && on && <span style={{ flexShrink: 0, color: "var(--accent-ink)" }}>✓</span>}
            </div>
          );
        })}
      </div>
      {multi && (
        <div className="rd-menu__foot">
          <button className="rd-btn rd-btn--ghost" style={{ flex: 1, borderRadius: 0, height: 36 }} onClick={() => onChange([])}>
            {sk ? "Zrušiť výber" : "Clear"}{arr.length ? ` (${arr.length})` : ""}
          </button>
          <button className="rd-btn rd-btn--ghost" style={{ flex: 1, borderRadius: 0, height: 36, borderLeft: "1px solid var(--border-soft)", color: "var(--accent-ink)", fontWeight: 600 }} onClick={close}>
            {sk ? "Hotovo" : "Done"}
          </button>
        </div>
      )}
    </div>, document.body) : null;

  return (
    <div ref={rootRef} style={{ position: "relative", width, flex: width ? "0 0 auto" : "1 1 auto", minWidth: width ? undefined : 0 }}>
      <button ref={btnRef} type="button" onClick={() => (open ? close() : setOpen(true))} aria-label={ariaLabel}
        aria-expanded={open} aria-haspopup="listbox"
        className={`rd-field${small ? " rd-field--sm" : ""}${empty ? "" : " rd-field--on"}`}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left",
          color: empty ? "var(--text-faint)" : undefined,
          borderColor: open ? "var(--accent)" : undefined,
          boxShadow: open ? "0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent)" : undefined,
        }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ color: "var(--text-faint)", fontSize: small ? "0.5rem" : "0.58rem", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>
      {menu}
    </div>
  );
}
