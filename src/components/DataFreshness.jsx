import { useFreshness } from "../lib/useData";

/**
 * DataFreshness — "Dáta aktualizované DD.M.YYYY": when the data shown on this
 * screen is from (the latest COMPLETE approved snapshot for the selected market).
 *
 * Snapshots approve all-or-nothing, so if a market's batch is stuck (a project
 * can't scrape) this date stops advancing for that market — a visible, honest
 * "this is a few days old, go fix it" signal instead of silently mixing dates.
 * The "All" view shows the oldest market's date.
 *
 * Hidden until loaded (never flashes a wrong/blank date). Platform + analytics
 * only — the marketing site doesn't show it (a day or two old doesn't matter there).
 */
export default function DataFreshness({ lang = "sk", style, className }) {
  const date = useFreshness();
  if (!date) return null;
  const [y, mo, d] = date.split("-").map(Number);
  if (!y || !mo || !d) return null;
  const formatted = `${d}.${mo}.${y}`;
  const label = lang === "sk" ? "Dáta aktualizované" : "Data updated";
  const tip = lang === "sk"
    ? "Dátum posledného kompletného stiahnutia dát pre vybraný trh. Kým sa celý trh nestiahne kompletne, dátum sa neposunie — vidíš tak, že dáta sú o pár dní staršie."
    : "Date of the last complete data pull for the selected market. The date does not advance until the whole market scrapes — so you can see when the data is a few days old.";
  return (
    <span title={tip} className={className} style={{
      fontFamily: "var(--font-mono)",
      fontSize: "0.72rem", color: "var(--text-dim)", whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center", gap: "0.4rem", ...style,
    }}>
      <span aria-hidden style={{
        width: 6, height: 6, borderRadius: "50%", background: "var(--accent)",
        display: "inline-block", flexShrink: 0,
      }} />
      {label} {formatted}
    </span>
  );
}
