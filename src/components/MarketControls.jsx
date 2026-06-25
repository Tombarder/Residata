import CountrySwitcher from "./CountrySwitcher";
import CurrencySwitcher from "./CurrencySwitcher";
import { useCountry } from "../lib/useCountry";
import { useCurrency } from "../lib/useCurrency";

/**
 * MarketControls — the Market (country) + Currency switchers grouped into ONE
 * stable cluster, ALWAYS rendered together. Lives off the page headers (platform
 * sidebar + a fixed corner on the marketing site) so the surrounding layout
 * never shifts as you change market or currency.
 *
 * variant:
 *   · "panel"  (default) — a labelled vertical card for the sidebar / fixed cluster
 *   · "inline"           — a compact horizontal row for tight spaces
 *
 * Self-hides only when there's literally nothing to switch (a single market AND a
 * single currency) — both the country and currency sets derive from the active
 * markets, so this turns on/grows by itself.
 */
const LABEL = {
  fontSize: "0.55rem", letterSpacing: "0.13em", textTransform: "uppercase",
  color: "#7a7a86", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
  whiteSpace: "nowrap",
};

export default function MarketControls({ lang = "en", variant = "panel", style }) {
  const { countries } = useCountry();
  const { currencies } = useCurrency();
  const hasMarket = countries && countries.length >= 2;
  const hasCurrency = currencies && currencies.length >= 2;
  if (!hasMarket && !hasCurrency) return null;

  const L = (sk, en) => (lang === "sk" ? sk : en);

  if (variant === "inline") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", ...style }}>
        <CountrySwitcher lang={lang} />
        <CurrencySwitcher lang={lang} />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: "0.6rem",
        padding: "0.75rem 0.8rem",
        border: "1px solid #222228", borderRadius: 10,
        background: "rgba(18,18,22,0.92)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        ...style,
      }}
    >
      {hasMarket && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.32rem" }}>
          <span style={LABEL}>{L("Trh", "Market")}</span>
          <CountrySwitcher lang={lang} hideLabel />
        </div>
      )}
      {hasCurrency && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.32rem" }}>
          <span style={LABEL}>{L("Mena", "Currency")}</span>
          <CurrencySwitcher lang={lang} />
        </div>
      )}
    </div>
  );
}
