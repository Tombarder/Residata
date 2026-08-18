import { useCurrency } from "../lib/useCurrency";
import { track } from "../lib/track";

const SYM = { EUR: "€", CZK: "Kč", PLN: "zł", HUF: "Ft", RON: "lei", BGN: "лв" };
const MONO = "'JetBrains Mono', monospace";

/**
 * CurrencySwitcher — segmented toggle (e.g. [€ | Kč]) that flips ALL prices
 * between the offered currencies at the live rate. Decoupled from the market:
 * the choice is global, so you can view CZK prices while in the SK or All
 * market too. Styled to match the CountrySwitcher next to it.
 *
 * `fill` — equal-width segments that fill the container (flex:1 each), for the
 * panel layout; otherwise content-sized for tight inline rows.
 *
 * Self-hides when only ONE currency is offered (e.g. only Slovakia active → just
 * €). The offered set derives from the active markets, so it turns on by itself.
 */
export default function CurrencySwitcher({ lang = "en", fill = false }) {
  const { currencies, displayCode, setCurrency } = useCurrency();

  if (!currencies || currencies.length < 2) return null; // nothing to switch

  return (
    <div
      role="group"
      aria-label={lang === "sk" ? "Mena" : "Currency"}
      title={lang === "sk" ? "Mena" : "Currency"}
      style={{
        display: "flex", borderRadius: 8, overflow: "hidden",
        border: "1px solid var(--border-soft)", fontSize: "0.72rem", fontFamily: MONO,
        width: fill ? "100%" : undefined,
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
              flex: fill ? "1 1 0" : undefined,
              // See CountrySwitcher: without minWidth:0 the wider symbol keeps more
              // than its share and the two halves come out uneven.
              minWidth: fill ? 0 : undefined,
              display: "flex", alignItems: "center", justifyContent: "center",
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
            {SYM[code] || code}
          </button>
        );
      })}
    </div>
  );
}
