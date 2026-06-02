import { useCountry, countryName } from "../lib/useCountry";
import { track } from "../lib/track";

/**
 * CountrySwitcher — segmented toggle in the nav for picking the displayed
 * country. Styled to match the EN/SK language toggle next to it.
 *
 * Dormant by design: renders NOTHING while only one country has active data
 * (today: Slovakia only). It appears automatically once a second market goes
 * live, because `countries` is derived from public.projects_live. No deploy
 * needed to "turn it on".
 */
export default function CountrySwitcher({ lang = "en" }) {
  const { country, setCountry, countries } = useCountry();

  // Nothing to switch between → don't clutter the nav.
  if (!countries || countries.length < 2) return null;

  return (
    <div
      title={lang === "sk" ? "Krajina" : "Country"}
      style={{
        display: "flex", borderRadius: 6, overflow: "hidden",
        border: "1px solid #222228", fontSize: "0.72rem",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {countries.map((c, i) => (
        <button
          key={c}
          onClick={() => {
            if (c !== country) {
              track("country_switched", { from: country, to: c });
              setCountry(c);
            }
          }}
          title={countryName(c, lang)}
          style={{
            padding: "0.3rem 0.6rem", border: "none", cursor: "pointer",
            borderLeft: i ? "1px solid #222228" : "none",
            background: c === country ? "#222228" : "transparent",
            color: c === country ? "#e8e8ed" : "#55555f",
            fontFamily: "inherit", fontSize: "inherit", transition: "all 0.2s",
          }}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
