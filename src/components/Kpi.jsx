import InfoTip from "./InfoTip";

/**
 * Kpi — the platform's headline-number card (`.rd-kpi`, styles/ui.css).
 *
 * One card, used by every screen that shows a big number: a mono micro-label, the
 * value in tabular figures, an optional context line, and an optional "i" tooltip
 * pinned to the corner.
 *
 * ONE accent bar on every card, never a per-metric colour. The rainbow version (a
 * different hue per metric — green for users, blue for time, purple for exports)
 * encodes nothing a reader can decode, and it made two screens showing the same
 * kind of figure look like two different products. Decided for the Dashboard
 * market-overview strip, carried to Predaje, and now here.
 *
 * MUST stay a module-level component: declared inside a page's render it would be a
 * new element type on every pass, so React would remount the InfoTip and a
 * tapped-open tooltip would vanish the moment the page's data refreshed.
 */
export default function Kpi({ label, value, sub, subWarn = false, info, loading = false }) {
  return (
    <div className="rd-kpi">
      {info && <div className="rd-kpi__info"><InfoTip text={info} label={label} /></div>}
      <div className="rd-kpi__lbl">{label}</div>
      <div className="rd-kpi__val">{loading ? "…" : (value ?? "—")}</div>
      {sub && <div className={subWarn ? "rd-kpi__sub rd-kpi__sub--warn" : "rd-kpi__sub"}>{sub}</div>}
    </div>
  );
}
