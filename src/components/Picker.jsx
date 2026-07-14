/**
 * Picker — a dark, on-theme dropdown (single / multi / searchable) that replaces
 * the native <select> on the map so the menu colours match the rest of the app.
 *
 * The menu renders in a PORTAL with fixed positioning, so it floats above
 * everything and is never clipped by a scrolling/overflow container (the filter
 * panel). It flips upward when there isn't room below, follows the trigger on
 * scroll/resize, and closes on outside-click or Escape.
 */
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

import { accent as green, dim, text as textLight, surfaceDark as bg2 } from "../lib/theme";
const border = "#23232a";
const popBg = "var(--surface)";
const hover = "#23232a";

const norm = (s) => (s == null ? "" : String(s)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export default function Picker({ value, onChange, options, placeholder = "select…", multi = false, searchable = false, width, ariaLabel, sk = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const close = () => { setOpen(false); setQ(""); };
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
    const onDown = (e) => { if (!btnRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
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
    <div ref={popRef} style={{ position: "fixed", left: pos.left, top: pos.top ?? undefined, bottom: pos.bottom ?? undefined, width: pos.w, maxHeight: pos.maxH, zIndex: 1000, background: popBg, border: `1px solid ${border}`, borderRadius: 11, boxShadow: "0 20px 52px rgba(0,0,0,0.72)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {searchable && (
        <div style={{ padding: 9, borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={sk ? "hľadať…" : "search…"} style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: "0.84rem", outline: "none" }} />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 6 }}>
        {opts.length === 0 && <div style={{ padding: "11px 12px", fontSize: "0.82rem", color: dim }}>{sk ? "žiadne výsledky" : "no matches"}</div>}
        {opts.map((o) => {
          const on = sel(o.value);
          return (
            <div key={String(o.value)} onClick={() => pick(o.value)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: "0.84rem", color: on ? green : textLight, background: on ? `${green}14` : "transparent" }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = hover; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
              {multi && (
                <span style={{ width: 17, height: 17, borderRadius: 5, border: `1.5px solid ${on ? green : dim}`, background: on ? green : "transparent", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#06140f", fontSize: "0.72rem", fontWeight: 700 }}>{on ? "✓" : ""}</span>
              )}
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
              {!multi && on && <span style={{ color: green, flexShrink: 0 }}>✓</span>}
            </div>
          );
        })}
      </div>
      {multi && (
        <div style={{ display: "flex", borderTop: `1px solid ${border}`, flexShrink: 0 }}>
          <button onClick={() => onChange([])} style={{ flex: 1, background: "none", border: "none", color: dim, padding: "10px", fontSize: "0.78rem", cursor: "pointer" }}>{sk ? "Zrušiť výber" : "Clear"}{arr.length ? ` (${arr.length})` : ""}</button>
          <button onClick={close} style={{ flex: 1, background: "none", border: "none", borderLeft: `1px solid ${border}`, color: green, padding: "10px", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>{sk ? "Hotovo" : "Done"}</button>
        </div>
      )}
    </div>, document.body) : null;

  return (
    <div style={{ position: "relative", width, flex: width ? "0 0 auto" : "1 1 auto", minWidth: width ? undefined : 0 }}>
      <button ref={btnRef} type="button" onClick={() => (open ? close() : setOpen(true))} aria-label={ariaLabel} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8, boxSizing: "border-box",
        padding: "10px 12px", background: bg2, border: `1px solid ${open ? `${green}66` : border}`, borderRadius: 8,
        color: empty ? dim : textLight, fontSize: "0.84rem", cursor: "pointer", outline: "none", textAlign: "left", transition: "border-color .12s",
      }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ color: dim, fontSize: "0.62rem", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>
      {menu}
    </div>
  );
}
