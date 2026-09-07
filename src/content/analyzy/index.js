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
export const ARTICLES = [september2026].sort((a, b) => b.date.localeCompare(a.date));

export function getArticle(slug) {
  return ARTICLES.find((a) => a.slug === slug) || null;
}

/** The slug of the most recent issue — used for "latest analysis" links. */
export const LATEST = ARTICLES[0] || null;
