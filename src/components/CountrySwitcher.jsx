import { useCountry, countryName } from "../lib/useCountry";
import { track } from "../lib/track";

/**
 * CountrySwitcher — market picker (All / SK / CZ). Shared by the public site and
 * the platform; usually rendered inside <MarketControls> next to the currency
 * switcher.
 *
 * `hideLabel` drops the inline "Market / Trh" caption when the surrounding
 * container already labels it (e.g. the MarketControls panel).
 *
 * Dormant by design: renders NOTHING while fewer than two markets are active
 * (`countries` derives from public.projects_live) — no deploy to turn it on.
 */
const FLAG = { all: "🌍", SK: "🇸🇰", CZ: "🇨🇿", PL: "🇵🇱", HU: "🇭🇺", AT: "🇦🇹", DE: "🇩🇪" };

export default function CountrySwitcher({ lang = "en", hideLabel = false }) {
  const { country, setCountry, countries } = useCountry();

  // Nothing to switch between → don't clutter the UI.
  if (!countries || countries.length < 2) return null;

  const group = (
    <div
      role="group"
      aria-label={lang === "sk" ? "Trh" : "Market"}
      style={{
        display: "flex", borderRadius: 7, overflow: "hidden",
        border: "1px solid #2e2e38", fontSize: "0.72rem",
        fontFamily: "'JetBrains Mono', monospace",
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
              display: "flex", alignItems: "center", gap: "0.32rem",
              padding: "0.34rem 0.62rem", border: "none", cursor: "pointer",
              borderLeft: i ? "1px solid #2e2e38" : "none",
              background: active ? "#00e5a0" : "transparent",
              color: active ? "#06140f" : "#9a9aa6",
              fontWeight: active ? 700 : 500,
              fontFamily: "inherit", fontSize: "inherit", transition: "all 0.15s",
            }}
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
          color: "#7a7a86", fontWeight: 600,
          fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap",
        }}
      >
        {lang === "sk" ? "Trh" : "Market"}
      </span>
      {group}
    </div>
  );
}
