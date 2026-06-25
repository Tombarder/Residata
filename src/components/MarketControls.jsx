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
 *   · "panel"  (default) — a labelled vertical card with equal-width, evenly
 *                          distributed segments (sidebar / fixed cluster)
 *   · "inline"           — a compact horizontal row for tight spaces
 *
 * Self-hides only when there's literally nothing to switch (a single market AND a
 * single currency) — both sets derive from the active markets, so this turns
 * on / grows by itself.
 */
const LABEL = {
  fontSize: "0.55rem", letterSpacing: "0.14em", textTransform: "uppercase",
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
        display: "flex", flexDirection: "column", gap: "0.7rem",
        padding: "0.85rem 0.9rem",
        border: "1px solid #24242c", borderRadius: 12,
        background: "rgba(16,16,20,0.94)",
        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        boxShadow: "0 10px 34px rgba(0,0,0,0.4)",
        ...style,
      }}
    >
      {hasMarket && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.36rem" }}>
          <span style={LABEL}>{L("Trh", "Market")}</span>
          <CountrySwitcher lang={lang} hideLabel fill />
        </div>
      )}
      {hasCurrency && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.36rem" }}>
          <span style={LABEL}>{L("Mena", "Currency")}</span>
          <CurrencySwitcher lang={lang} fill />
        </div>
      )}
    </div>
  );
}
