/* What a project's AVERAGE price is the average OF — and how to say so on screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 A PROJECT'S AVERAGE PRICE DESCRIBES WHAT IS LEFT, NOT THE PROJECT.
 *
 * Developers publish a price for the flats they still sell and remove it from
 * the ones they have sold (80 % of sold Slovak flats carry no price). So a
 * project's average €/m², asking price or flat size is computed over its
 * REMAINDER — and the remainder is not a sample of the project: small flats
 * sell first, so it is systematically bigger and dearer per flat. Dostupné
 * bývanie Nitra averaged 70,0 m² on offer against 53,1 m² for the project as
 * built; all 50 one-room and 125 two-room flats of its first building were gone.
 *
 * Boss 2026-10-06 (board decision 186771): wherever the platform shows a
 * per-project average price, show beside it how much of that project is
 * already sold — so a price over the remainder is never read as the project's.
 *
 *      4 512 €/m²  · 65 % predaných      ← the average, and what it leaves out
 *      4 512 €/m²                        ← nothing sold yet: it IS the project
 *
 * "Sold" is the ledger's (projects_live.sold_units — flats a developer deleted
 * when they sold included), out of every flat the project has had. It is NOT
 * `sold_percentage`, which counts reserved flats as taken: a reserved flat
 * still carries its price, so it is inside the average.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Share of the project's flats already sold, 0–100, rounded once; null when unknown. */
export function soldSharePct(p) {
  const total = Number(p?.total_units);
  const sold = Number(p?.sold_units);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(sold) || sold < 0) return null;
  return Math.round(Math.min(sold, total) * 100 / total);
}

/** "65 % predaných" / "65% sold" — or "" when there is nothing to qualify. */
export function soldShareText(pct, lang = "sk") {
  if (pct == null || pct <= 0) return "";
  return lang === "en" ? `${pct}% sold` : `${pct} % predaných`;
}

/** The sentence behind the note — why a reader should care. */
export function soldShareTitle(pct, lang = "sk") {
  if (pct == null || pct <= 0) return "";
  return lang === "en"
    ? `The average covers only the flats still on offer with a published price. ${pct}% of this project is already sold, and developers usually remove the prices of sold flats, so the average describes the remaining offer, not the whole project.`
    : `Priemer počíta len byty, ktoré sú ešte v ponuke a majú zverejnenú cenu. ${pct} % bytov projektu je už predaných a developeri ich ceny zvyčajne stiahnu, takže priemer opisuje zvyšok ponuky, nie celý projekt.`;
}
