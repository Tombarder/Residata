/**
 * The order of the /analyzy index when several issues share a date.
 *
 * The index is ordered by article_date, newest first. A quarter's template
 * issues — Slovakia, Bratislava, the largest towns, the eight kraje — are
 * published the same day, and Postgres returns rows that tie on the sort key in
 * no particular order: sixteen near-identical cards would shuffle between page
 * loads. Within a date, an issue series reads from the whole to its parts:
 * Slovakia, then Bratislava, then the towns by size, then the kraje in the
 * Statistical Office's order. Anything else keeps the position it came in.
 */

const TOWNS = ["ke", "po", "za", "nr", "bb", "tt", "tn"];            // by population
const KRAJE = ["ba", "tt", "tn", "nr", "za", "bb", "po", "ke"];       // ŠÚ SR order

/** Where an issue sits among the issues of its date (lower first). */
export function seriesRank(slug = "") {
  if (/^sk-prehlad-/.test(slug)) return 0;
  if (/^ba-prehlad-/.test(slug)) return 1;
  const town = /^([a-z]{2})-prehlad-/.exec(slug);
  if (town && TOWNS.includes(town[1])) return 10 + TOWNS.indexOf(town[1]);
  const kraj = /^kraj-([a-z]{2})-prehlad-/.exec(slug);
  if (kraj && KRAJE.includes(kraj[1])) return 30 + KRAJE.indexOf(kraj[1]);
  return 100;
}

/** Newest date first; within a date, the series order; otherwise stable. */
export function orderArticles(list) {
  return list
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const dx = String(x.a.date || ""), dy = String(y.a.date || "");
      if (dx !== dy) return dx < dy ? 1 : -1;
      const r = seriesRank(x.a.slug) - seriesRank(y.a.slug);
      return r !== 0 ? r : x.i - y.i;
    })
    .map(({ a }) => a);
}
