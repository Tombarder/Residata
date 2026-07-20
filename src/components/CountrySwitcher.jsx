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
      style={{
        display: "flex", borderRadius: 8, overflow: "hidden",
        border: "1px solid var(--border-soft)", fontSize: "0.72rem", fontFamily: MONO,
        width: fill ? "100%" : undefined,
      }}
    >
      {countries.map((c, i) => {
        const active = c === country;
        return (
          <button
            key={c}
            onClick={() => {
              if (c !== country) {
                track("country_switched", { from: country, to: c });
                setCountry(c);
              }
            }}
            title={countryName(c, lang)}
            aria-pressed={active}
            style={{
              flex: fill ? "1 1 0" : undefined,
              display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem",
              padding: "0.4rem 0.55rem", border: "none", cursor: "pointer",
              borderLeft: i ? "1px solid var(--border-soft)" : "none",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#06140f" : "var(--text-dim)",
              fontWeight: active ? 700 : 500, whiteSpace: "nowrap",
              fontFamily: "inherit", fontSize: "inherit", transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {c === "all" && <span style={{ fontSize: "0.82rem", lineHeight: 1 }}>{FLAG[c] || "🌍"}</span>}
            {c === "all" ? countryName("all", lang) : c}
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
          color: "#7a7a86", fontWeight: 600, fontFamily: MONO, whiteSpace: "nowrap",
        }}
      >
        {lang === "sk" ? "Trh" : "Market"}
      </span>
      {group}
    </div>
  );
}
