/**
 * The admin → Analýzy list's rules, kept out of the component so they are tested:
 * which articles a filter tab and the search box show, how many each tab counts,
 * and whether a new article's address is usable.
 */

/** The list's tabs, in order. */
export const ARTICLE_FILTERS = ["all", "published", "draft"];

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Does an article belong in the list under this tab and this search? The search
 * reads the title, standfirst and address in both languages, ignoring case and
 * accents — "kosice" finds "Košice", as anyone typing fast expects.
 */
export function articleMatches(a, filter = "all", query = "") {
  if (filter === "published" && !a.published) return false;
  if (filter === "draft" && a.published) return false;
  const q = fold(query).trim();
  if (!q) return true;
  const hay = fold([a.slug, a.title?.sk, a.title?.en, a.perex?.sk, a.perex?.en].join(" "));
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/** The number on each tab. */
export function articleCounts(articles = []) {
  const published = articles.filter((a) => a.published).length;
  return { all: articles.length, published, draft: articles.length - published };
}

/** What the address of a NEW article must be: the URL segment /analyzy/<slug>. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** null when usable, else why not: 'empty' | 'format' | 'taken'. */
export function slugProblem(slug, taken = []) {
  const s = String(slug ?? "").trim();
  if (!s) return "empty";
  if (!SLUG_RE.test(s)) return "format";
  if (taken.includes(s)) return "taken";
  return null;
}
