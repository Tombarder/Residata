import { useCountry, countryName } from "../lib/useCountry";
import { track } from "../lib/track";

/**
 * CountrySwitcher — market picker (All / SK / CZ). Usually rendered inside
 * <MarketControls> next to the currency switcher.
 *
 * Props:
 *   · hideLabel — drop the inline "Market / Trh" caption (the container labels it).
 *   · fill      — equal-width segments that fill the container (flex:1 each), for
 *                 the panel layout; otherwise content-sized for tight inline rows.
 *
 * The inline variant wears the shared segmented-control look (`.rd-seg`, ui.css
 * §5), so it matches the period / group-by switches it sits beside on a filter
 * row. The `fill` variant lives in the SIDEBAR, which is a dark slate block in
 * light mode — a `--surface-2` track would be a pale pill on dark there — so it
 * keeps its own joined-segment styling.
 *
 * Dormant by design: renders NOTHING while fewer than two markets are active.
 */
const FLAG = { all: "🌍", SK: "🇸🇰", CZ: "🇨🇿", PL: "🇵🇱", HU: "🇭🇺", AT: "🇦🇹", DE: "🇩🇪" };
const MONO = "'JetBrains Mono', monospace";

export default function CountrySwitcher({ lang = "en", hideLabel = false, fill = false }) {
  const { country, setCountry, countries } = useCountry();

  if (!countries || countries.length < 2) return null;

  const group = (
    <div
      role="group"
      aria-label={lang === "sk" ? "Trh" : "Market"}
      className={fill ? undefined : "rd-seg"}
      style={fill ? {
        display: "flex", borderRadius: 8, overflow: "hidden",
        border: "1px solid var(--border-soft)", fontSize: "0.72rem", fontFamily: MONO,
        width: "100%",
      } : undefined}
    >
      {countries.map((c, i) => {
        const active = c === country;
        const pick = () => {
          if (c !== country) {
            track("country_switched", { from: country, to: c });
            setCountry(c);
          }
        };
        // The globe is dropped in `fill` mode. With equal-width segments the widest
        // label decides how wide the whole control must be, and "🌍 Všetky" needs
        // ~30% more room than a plain "Všetky" — so the emoji alone pushed its own
        // text against the segment borders. It stays in the content-sized inline
        // variant, where it costs nothing.
        const body = (
          <>
            {c === "all" && !fill && <span style={{ fontSize: "0.8rem", lineHeight: 1 }}>{FLAG[c] || "🌍"}</span>}
            {c === "all" ? countryName("all", lang) : c}
          </>
        );
        if (!fill) {
          return (
            <button key={c} onClick={pick} title={countryName(c, lang)} aria-pressed={active}
              className="rd-seg__btn" style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              {body}
            </button>
          );
        }
        return (
          <button
            key={c}
            onClick={pick}
            title={countryName(c, lang)}
            aria-pressed={active}
            style={{
              flex: "1 1 0",
              // minWidth:0 is what actually makes the segments equal. A flex item
              // defaults to min-width:auto, so it refuses to shrink below its own
              // content — "🌍 Všetky" is wider than a third of the panel, so it
              // stole width from CZ and SK and the control looked lopsided.
              minWidth: 0,
              display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem",
              padding: "0.4rem 0.5rem", border: "none", cursor: "pointer",
              borderLeft: i ? "1px solid var(--border-soft)" : "none",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#06140f" : "var(--text-dim)",
              fontWeight: active ? 700 : 500, whiteSpace: "nowrap",
              fontFamily: "inherit", fontSize: "inherit", transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {body}
          </button>
        );
      })}
    </div>
  );

  if (hideLabel) return group;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <span
        aria-hidden
        style={{
          fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase",
          color: "var(--text-faint)", fontWeight: 600, fontFamily: MONO, whiteSpace: "nowrap",
        }}
      >
        {lang === "sk" ? "Trh" : "Market"}
      </span>
      {group}
    </div>
  );
}
