/**
 * Picker — a dark, on-theme dropdown (single / multi / searchable) that replaces
 * the native <select> on the map so the menu colours match the rest of the app.
 * Closes on outside-click or Escape; the multi mode is a searchable checklist.
 */
import { useState, useRef, useEffect } from "react";

const green = "#00e5a0";
const dim = "#8a8a96";
const textLight = "#e8e8ed";
const border = "#23232a";
const bg2 = "#0e0e10";
const popBg = "#17171c";
const hover = "#23232a";

const norm = (s) => (s == null ? "" : String(s)).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export default function Picker({ value, onChange, options, placeholder = "select…", multi = false, searchable = false, width, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(""); } };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const opts = searchable && q ? options.filter((o) => norm(o.label).includes(norm(q))) : options;
  const sel = (v) => (multi ? (value || []).includes(v) : value === v);
  const pick = (v) => {
    if (multi) { const cur = value || []; onChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]); }
    else { onChange(v); setOpen(false); setQ(""); }
  };

  const arr = value || [];
  const empty = multi ? arr.length === 0 : (value == null || value === "");
  let label;
  if (multi) {
    if (!arr.length) label = placeholder;
    else { const first = options.find((o) => o.value === arr[0])?.label ?? arr[0]; label = arr.length > 1 ? `${first} +${arr.length - 1}` : first; }
  } else label = options.find((o) => o.value === value)?.label ?? placeholder;

  return (
    <div ref={ref} style={{ position: "relative", width, flex: width ? "0 0 auto" : "1 1 auto", minWidth: width ? undefined : 0 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={ariaLabel} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 6, boxSizing: "border-box",
        padding: "6px 9px", background: bg2, border: `1px solid ${open ? `${green}66` : border}`, borderRadius: 7,
        color: empty ? dim : textLight, fontSize: "0.74rem", cursor: "pointer", outline: "none", textAlign: "left", transition: "border-color .12s",
      }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ color: dim, fontSize: "0.55rem", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%", width: "max-content", maxWidth: 280, zIndex: 70, background: popBg, border: `1px solid ${border}`, borderRadius: 9, boxShadow: "0 14px 34px rgba(0,0,0,0.6)", overflow: "hidden" }}>
          {searchable && (
            <div style={{ padding: 6, borderBottom: `1px solid ${border}` }}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" style={{ width: "100%", boxSizing: "border-box", padding: "5px 8px", background: bg2, border: `1px solid ${border}`, borderRadius: 6, color: textLight, fontSize: "0.72rem", outline: "none" }} />
            </div>
          )}
          <div style={{ maxHeight: 220, overflowY: "auto", padding: 4 }}>
            {opts.length === 0 && <div style={{ padding: "8px 9px", fontSize: "0.72rem", color: dim }}>no matches</div>}
            {opts.map((o) => {
              const on = sel(o.value);
              return (
                <div key={String(o.value)} onClick={() => pick(o.value)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", borderRadius: 6, cursor: "pointer", fontSize: "0.74rem", color: on ? green : textLight, background: on ? `${green}14` : "transparent" }}
                  onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = hover; }}
                  onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                  {multi && (
                    <span style={{ width: 14, height: 14, borderRadius: 4, border: `1px solid ${on ? green : dim}`, background: on ? green : "transparent", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#06140f", fontSize: "0.62rem", fontWeight: 700 }}>{on ? "✓" : ""}</span>
                  )}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                  {!multi && on && <span style={{ color: green, flexShrink: 0 }}>✓</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
