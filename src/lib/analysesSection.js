/**
 * Whether the /analyzy section is on the site at all.
 *
 * The section exists while at least one analysis is published. Withdrawing every
 * article in /app/articles takes the WHOLE section off the site — the menu link,
 * the /analyzy addresses, the sitemap, the feed and llms.txt — and publishing one
 * brings all of it back. There is no second switch to forget: the published flag
 * the editor already writes is the only fact. (Boss, 2026-10-07: the section was
 * hidden until the analyses are worth reading.)
 *
 * The count is the build's own list of published articles (scripts/.articles.json,
 * written by generate-static-content.mjs). Publishing or withdrawing an article
 * rebuilds the site (novostavby v2/migrations/2026-09-28_articles_publish_rebuilds
 * _the_site.sql), so the build always knows the current answer.
 */

import { isInsightsPage } from "./routing.js";

/** The rule, in one place: the section is live while anything is published. */
export function sectionIsLive(publishedCount) {
  return Number(publishedCount) > 0;
}

/**
 * The value vite.config.js injects for the app: true or false from the build's
 * list, or nothing at all when the build could not read the list (a local build
 * without database access) — the section then stays, as it always did.
 */
export function analysesLiveDefine(rows) {
  return Array.isArray(rows) ? { __ANALYSES_LIVE__: JSON.stringify(sectionIsLive(rows.length)) } : {};
}

/* global __ANALYSES_LIVE__ */
export const ANALYSES_LIVE = typeof __ANALYSES_LIVE__ === "undefined" ? true : __ANALYSES_LIVE__;

/**
 * The menu without the analyses link while the section is off the site. The
 * three language lists are parallel (Nav reads pagesEN[i] for the i-th label of
 * any language), so the same position is dropped from each.
 */
export function navPagesFor(all, insightsAt, live = ANALYSES_LIVE) {
  return live ? all : all.filter((_, i) => i !== insightsAt);
}

/** The page an address shows: an /analyzy address with the section off the site
 *  shows the homepage (and App replaces the address with the homepage's own). */
export function shownPage(page, live = ANALYSES_LIVE) {
  return !live && isInsightsPage(page) ? "Home" : page;
}
