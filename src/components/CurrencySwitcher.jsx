import { useCurrency } from "../lib/useCurrency";
import { track } from "../lib/track";

const SYM = { EUR: "€", CZK: "Kč", PLN: "zł", HUF: "Ft", RON: "lei", BGN: "лв" };

/**
 * CurrencySwitcher — segmented toggle (e.g. [Kč | €]) that flips prices between
 * the viewed country's native currency and EUR at the live rate. Styled to
 * match the CountrySwitcher / language toggle next to it.
 *
 * Dormant by design: renders NOTHING while the viewed country's native currency
 * IS the euro (today: Slovakia). It appears automatically for a country with a
 * non-euro currency (Czechia → CZK), driven by useCurrency().hasNativeAlt — no
 * deploy needed to "turn it on" per market.
 */
export default function CurrencySwitcher({ lang = "en" }) {
  const { mode, setMode, nativeCode, hasNativeAlt } = useCurrency();

  if (!hasNativeAlt) return null; // native == € → nothing to switch

  const opts = [
    { key: "native", label: SYM[nativeCode] || nativeCode },
    { key: "eur", label: "€" },
  ];

  return (
    <div
      title={lang === "sk" ? "Mena" : "Currency"}
      style={{
        display: "flex", borderRadius: 6, overflow: "hidden",
        border: "1px solid #222228", fontSize: "0.72rem",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {opts.map((o, i) => (
        <button
          key={o.key}
          onClick={() => {
            if (o.key !== mode) {
              track("currency_switched", { from: mode, to: o.key });
              setMode(o.key);
            }
          }}
          style={{
            padding: "0.3rem 0.6rem", border: "none", cursor: "pointer",
            borderLeft: i ? "1px solid #222228" : "none",
            background: o.key === mode ? "#222228" : "transparent",
            color: o.key === mode ? "#e8e8ed" : "#55555f",
            fontFamily: "inherit", fontSize: "inherit", transition: "all 0.2s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
