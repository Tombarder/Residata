/**
 * SEED DATA ONLY — the live site reads public.articles, not this folder.
 *
 * These modules are how an issue is FIRST authored: prose with figures
 * interpolated from the generated report JSON, which is then resolved to plain
 * strings and inserted into the table. After that the table is the source of
 * truth, because Boss edits and publishes from /app/articles without a deploy.
 *
 * Keep a module here when you author a new issue; do not edit one expecting the
 * site to change.
 */
import september2026 from "./2026-09-trh-novostavieb";

/** Newest first — the index page renders them in this order. */
const ALL = [september2026];

/**
 * Only published issues are listed anywhere. An unpublished one keeps a working
 * URL — that is the preview mechanism: send Boss /analyzy/<slug>, he reads the
 * real page on the real site, and one flag makes it public. Nothing is linked to
 * it, it is absent from the sitemap and it is noindex until then.
 */
export const ARTICLES = ALL.filter((a) => a.published !== false)
  .sort((a, b) => b.date.localeCompare(a.date));

/** Every issue including drafts — used only to resolve a preview URL. */
export const ALL_ARTICLES = ALL;

export function getArticle(slug) {
  return ALL.find((a) => a.slug === slug) || null;
}

/** The slug of the most recent issue — used for "latest analysis" links. */
export const LATEST = ARTICLES[0] || null;
