/**
 * Modal — the platform's dialog (`.rd-modal*`, styles/ui.css §11).
 *
 * A centred card over a dimmed page, rendered in a portal so no scrolling or
 * clipped container can cut it. Escape closes it (shared useEscape — a Picker or
 * date popup opened inside takes the first Escape); a click on the backdrop
 * closes it only when `dismissable` — a form with typed text is not dismissable,
 * because losing a half-filled form to a stray click is worse than one more
 * click on "Cancel". Focus moves into the dialog when it opens and back to where
 * it was when it closes.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEscape } from "../lib/useDismiss";

export default function Modal({ open, onClose, title, children, footer, width = 560, dismissable = true, labelledBy }) {
  const cardRef = useRef(null);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    const t = setTimeout(() => {
      const el = cardRef.current?.querySelector("[data-autofocus], input:not([disabled]), textarea, button");
      el?.focus?.();
    }, 0);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const titleId = labelledBy || "rd-modal-title";
  return createPortal(
    <div className="rd-modal-backdrop" onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}>
      <div ref={cardRef} className="rd-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ maxWidth: width }}>
        <div className="rd-modal__head">
          <h2 id={titleId} className="rd-modal__title">{title}</h2>
          <button type="button" className="rd-modal__x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="rd-modal__body">{children}</div>
        {footer && <div className="rd-modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
