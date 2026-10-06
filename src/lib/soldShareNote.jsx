/* The on-screen note beside a per-project average price — the rule and the
 * reasons live in ./soldShare.js. */
import { soldSharePct, soldShareText, soldShareTitle } from "./soldShare.js";

const NOTE_STYLE = {
  color: "var(--text-dim)",
  fontSize: "0.85em",
  fontWeight: 400,
  whiteSpace: "nowrap",
  cursor: "help",
};

/**
 * The note itself, for any surface that prints a per-project average.
 * `inline` (default) renders " · 65 % predaných" after the number; `block`
 * renders it on its own line under it (table cells, KPI tiles). Renders
 * nothing when nothing is sold or the counts are unknown.
 */
export function SoldShareNote({ project, lang = "sk", block = false, style }) {
  const pct = soldSharePct(project);
  const text = soldShareText(pct, lang);
  if (!text) return null;
  const title = soldShareTitle(pct, lang);
  if (block) {
    return (
      <span className="rd-sold-share" title={title}
            style={{ ...NOTE_STYLE, display: "block", marginTop: 2, ...style }}>
        {text}
      </span>
    );
  }
  return (
    <span className="rd-sold-share" title={title} style={{ ...NOTE_STYLE, ...style }}>
      {" · "}{text}
    </span>
  );
}
