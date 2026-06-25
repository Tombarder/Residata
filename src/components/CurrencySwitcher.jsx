import { useCurrency } from "../lib/useCurrency";
import { track } from "../lib/track";

const SYM = { EUR: "€", CZK: "Kč", PLN: "zł", HUF: "Ft", RON: "lei", BGN: "лв" };

/**
 * CurrencySwitcher — segmented toggle (e.g. [€ | Kč]) that flips ALL prices
 * between the offered currencies at the live rate. Decoupled from the market:
 * the choice is global, so you can view CZK prices while in the SK or All
 * market too. Styled to match the CountrySwitcher next to it.
 *
 * Self-hides when only ONE currency is offered (e.g. only Slovakia active → just
 * €, nothing to switch) — the offered set is derived from the active markets in
 * useCurrency(), so it turns on by itself when a non-euro market opens.
 */
export default function CurrencySwitcher({ lang = "en" }) {
  const { currencies, displayCode, setCurrency } = useCurrency();

  if (!currencies || currencies.length < 2) return null; // nothing to switch

  return (
    <div
      role="group"
      aria-label={lang === "sk" ? "Mena" : "Currency"}
      title={lang === "sk" ? "Mena" : "Currency"}
      style={{
        display: "flex", borderRadius: 7, overflow: "hidden",
        border: "1px solid #2e2e38", fontSize: "0.72rem",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {currencies.map((code, i) => {
        const active = code === displayCode;
        return (
          <button
            key={code}
            onClick={() => {
              if (code !== displayCode) {
                track("currency_switched", { from: displayCode, to: code });
                setCurrency(code);
              }
            }}
            aria-pressed={active}
            title={code}
            style={{
              padding: "0.34rem 0.62rem", border: "none", cursor: "pointer",
              borderLeft: i ? "1px solid #2e2e38" : "none",
              background: active ? "#00e5a0" : "transparent",
              color: active ? "#06140f" : "#9a9aa6",
              fontWeight: active ? 700 : 500,
              fontFamily: "inherit", fontSize: "inherit", transition: "all 0.15s",
            }}
          >
            {SYM[code] || code}
          </button>
        );
      })}
    </div>
  );
}
