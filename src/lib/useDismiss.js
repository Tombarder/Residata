/**
 * useDismiss — ONE dismissal behaviour for every click-opened layer in the app
 * (dropdown, filter panel, chip menu, suggestion list).
 *
 * What a modern app does, and what Boss asked for (2026-08-19): a pointer-down
 * anywhere outside closes the layer, and Escape closes the inner-most open one.
 * Before this, each popover re-implemented that by hand — or forgot to, which is
 * why the Sales project dropdown stayed open until you clicked its own button
 * again. Nobody should re-implement it a seventh time: use this.
 *
 * Usage — put the returned ref on the layer's root; if the trigger button lives
 * OUTSIDE that root, hand its ref over too so clicking it doesn't fight the
 * toggle (close-then-reopen reads as a dead button):
 *
 *   const [open, setOpen] = useState(false);
 *   const ref = useDismiss(open, () => setOpen(false));
 *   return <div ref={ref}><button onClick={() => setOpen(o => !o)}/>{open && <menu/>}</div>;
 *
 *   // trigger elsewhere in the tree:
 *   const btn = useRef(null);
 *   const ref = useDismiss(open, close, [btn]);
 *
 * `data-popover-layer` is the one escape hatch: a layer that renders in a PORTAL
 * (Picker's menu) is a DOM stranger to the panel that opened it, so mark it and
 * it counts as "inside" for the panel — using a dropdown inside a filter panel
 * then can't close the panel underneath it.
 */
import { useEffect, useRef } from "react";

// Which layers are open right now, outer-most first. Only the last one reacts to
// Escape, so closing a dropdown inside a panel doesn't also close the panel — and a
// Picker opened inside a modal takes the first Escape, the modal the second.
const openLayers = [];

/** The shared machinery. `outside: false` binds Escape only. */
function useLayer(open, onClose, extraRefs, outside) {
  const ref = useRef(null);
  // The listeners are bound once per open (not per render), so they read the
  // callback and the extra refs through this box — written after every commit,
  // never during render.
  const latest = useRef({ onClose, extraRefs });
  useEffect(() => { latest.current = { onClose, extraRefs }; });

  useEffect(() => {
    if (!open) return;
    const layer = {};
    openLayers.push(layer);

    const isInside = (target) => {
      if (!(target instanceof Node)) return false;
      if (ref.current?.contains(target)) return true;
      for (const r of latest.current.extraRefs || []) if (r?.current?.contains(target)) return true;
      const el = target instanceof Element ? target : target.parentElement;
      return !!el?.closest?.("[data-popover-layer]");
    };

    // Capture phase: some triggers stopPropagation() on mousedown/pointerdown,
    // which would keep a bubble-phase document listener from ever running.
    const onDown = (e) => { if (!isInside(e.target)) latest.current.onClose?.(); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (openLayers[openLayers.length - 1] !== layer) return;   // inner-most only
      latest.current.onClose?.();
    };
    if (outside) document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      const i = openLayers.indexOf(layer);
      if (i !== -1) openLayers.splice(i, 1);
      if (outside) document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, outside]);

  return ref;
}

export default function useDismiss(open, onClose, extraRefs) {
  return useLayer(open, onClose, extraRefs, true);
}

/**
 * useEscape — Escape closes it, an outside click does NOT.
 *
 * For a layer where a stray click must not dismiss: a modal that already closes on
 * its own backdrop (LoginModal), or a panel holding text the user has typed (the
 * feedback form, the chat). Losing a half-written message to a misplaced click is a
 * worse bug than the one this file exists to fix — but Escape should always work,
 * and before this nothing in the app closed on Escape at all.
 *
 * Shares the layer stack with useDismiss, so Escape hits the inner-most layer: a
 * <Picker> open inside a modal closes first, the modal on the next press.
 */
export function useEscape(open, onClose) {
  useLayer(open, onClose, undefined, false);
}
