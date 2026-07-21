import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

/* InfoTip — a small "i" icon that reveals a styled explanation popover on hover
   or keyboard focus. The popover is portaled to <body> so it is never clipped by
   a card's overflow, and positioned from the icon's live rect (clamped to the
   viewport). Theme-aware via CSS var tokens — works in Normal (light) and dark. */
export default function InfoTip({ text, label }) {
  const [pos, setPos] = useState(null); // {top,left,above} while visible; null = hidden
  const ref = useRef(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const TW = 280; // popover max-width, used for clamping
    let left = Math.min(r.left, window.innerWidth - TW - 12);
    left = Math.max(12, left);
    // Prefer below the icon; flip above if there isn't room (rough 150px estimate).
    const below = r.bottom + 150 < window.innerHeight;
    setPos({ left, top: below ? r.bottom + 8 : r.top - 8, above: !below });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label ? `${label} — info` : "info"}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.preventDefault()}
        style={{
          display: "grid", placeItems: "center", width: 17, height: 17, padding: 0,
          borderRadius: "50%", border: "1px solid var(--border)", background: "transparent",
          color: "var(--text-faint)", cursor: "help", lineHeight: 0,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>
      {pos && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed", left: pos.left, zIndex: 5000, maxWidth: 280,
            ...(pos.above ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
            padding: "0.7rem 0.85rem", boxShadow: "0 10px 30px rgba(15,23,42,0.28)",
            color: "var(--text-dim)", fontSize: "0.78rem", lineHeight: 1.5,
            fontFamily: "'Inter', system-ui, sans-serif", pointerEvents: "none",
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
