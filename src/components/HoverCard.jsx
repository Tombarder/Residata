/* HoverCard — ONE hover explanation for the whole platform.
 *
 * Boss 2026-08-26: a mark the reader cannot decode is not a mark. Wherever
 * there is no room for the full panel (a `*` in a table cell), hovering it must
 * open a small styled card saying the same thing the panel says — NOT a native
 * `title`, which shows a bare "?" cursor, waits a second, and then renders an
 * unstyled OS tooltip that some elements suppress entirely.
 *
 * This is the shared piece: a trigger you supply, a card portaled to <body>.
 *
 *   · portaled, so a cell with `overflow: hidden` (every fixed-layout table we
 *     have) cannot clip it;
 *   · positioned from the trigger's LIVE rect and clamped to the viewport, and
 *     it flips above when there is no room below — it can never leave the screen;
 *   · hover and keyboard focus open it on a pointer device; on touch, where
 *     hover does not exist, a tap pins it and swallows that tap so the row
 *     underneath does not navigate. On a mouse the click passes straight
 *     through, so a clickable row keeps its whole click target;
 *   · dismissal goes through the shared useDismiss, so Escape and an outside
 *     pointer-down behave exactly like every other layer in the app.
 *
 * components/InfoTip.jsx is the "i" icon built on this. Anything else that
 * needs an explanation on hover should use this rather than a seventh
 * hand-rolled popover.
 */
import { useState, useRef, useCallback, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import useDismiss from "../lib/useDismiss";

/** True on a real pointer device. Touch screens report `hover: none`. */
function canHover() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(hover: hover)").matches;
}

export default function HoverCard({
  children,          // the card's content
  trigger,           // (props) => ReactNode — spread props onto your element
  label,             // accessible name for the trigger
  maxWidth = 300,
  align = "left",    // "left" aligns the card's left edge with the trigger
}) {
  const [pos, setPos] = useState(null);      // {left, top, above} while open
  const [pinned, setPinned] = useState(false);
  const ref = useRef(null);
  const id = useId();

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const M = 12;                                    // viewport margin
    let left = align === "right" ? r.right - maxWidth : r.left;
    left = Math.min(left, window.innerWidth - maxWidth - M);
    left = Math.max(M, left);
    // Prefer below; flip above when the bottom half is too shallow. 170px is a
    // generous estimate of the card — being wrong only picks the other side.
    const below = r.bottom + 170 < window.innerHeight;
    setPos({ left, top: below ? r.bottom + 7 : r.top - 7, above: !below });
  }, [align, maxWidth]);

  const open = useCallback(() => place(), [place]);
  const close = useCallback(() => { setPinned(false); setPos(null); }, []);
  // Leaving with the mouse closes it unless a tap pinned it open.
  const leave = useCallback(() => { setPos((p) => (pinned ? p : null)); }, [pinned]);

  // The card is portaled and marked `data-popover-layer`, and the trigger is
  // handed over as an extra ref, so useDismiss treats both as "inside" and the
  // returned ref needs no element of its own.
  useDismiss(pinned, close, [ref]);

  // A fixed-position card is anchored to a rect that scrolling invalidates, so
  // the moment the page (or any scroller under it) moves, close rather than
  // leave a card stranded beside nothing. Same for a resize. Cheap: bound only
  // while one is actually open.
  useEffect(() => {
    if (!pos) return;
    const bye = () => { setPinned(false); setPos(null); };
    window.addEventListener("scroll", bye, true);
    window.addEventListener("resize", bye);
    return () => {
      window.removeEventListener("scroll", bye, true);
      window.removeEventListener("resize", bye);
    };
  }, [pos]);

  // Touch only: pin, and keep the tap from reaching a clickable row underneath.
  const onClick = useCallback((e) => {
    if (canHover()) return;                          // mouse → let the row have it
    e.preventDefault();
    e.stopPropagation();
    if (pinned) { close(); return; }
    setPinned(true);
    place();
  }, [pinned, close, place]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setPinned((v) => !v); place(); }
  }, [place]);

  return (
    <>
      {trigger({
        ref,
        tabIndex: 0,
        role: "button",
        "aria-label": label,
        "aria-describedby": pos ? id : undefined,
        onMouseEnter: open,
        onMouseLeave: leave,
        onFocus: open,
        onBlur: leave,
        onClick,
        onKeyDown,
      })}
      {pos && createPortal(
        <div
          id={id}
          role="tooltip"
          data-popover-layer=""
          style={{
            position: "fixed", left: pos.left, zIndex: 5000,
            maxWidth, width: "max-content", minWidth: 0,
            ...(pos.above ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "0.65rem 0.8rem 0.7rem",
            boxShadow: "0 10px 30px rgba(15,23,42,0.28)",
            color: "var(--text-2)", fontSize: "0.78rem", lineHeight: 1.5,
            pointerEvents: "none", overflowWrap: "anywhere",
          }}
        >
          {children}
        </div>,
        document.body
      )}
    </>
  );
}
