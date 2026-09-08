/**
 * The article registry.
 *
 * Adding an issue is three edits, and all three are checked:
 *   1. drop the content module here,
 *   2. add its SEO entry in lib/seo.js (applySeo returns early for an unknown
 *      page — a missing entry means Google indexes the article under whatever
 *      meta happened to be in the head),
 *   3. add its path to SITEMAP_URLS in scripts/generate-static-content.mjs.
 * src/lib/sitemapRoutes.test.mjs fails if 2 and 3 disagree.
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
