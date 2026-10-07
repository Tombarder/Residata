/**
 * Whether the /analyzy section is on the site at all.
 *
 * Two facts decide it, and both must hold:
 *   1. Boss has the section switched ON in admin → Analýzy (public.site_sections,
 *      row 'analyzy' — novostavby v2/migrations/2026-10-07_site_sections_switch.sql).
 *      Boss, 2026-10-07: "daj mi do admin button … kde to budem moct skryt a odokryt
 *      celu tu sekciu zo stranky".
 *   2. At least one analysis is published — an empty section is not shown.
 * When either fails, the WHOLE section leaves the site: the menu link, the
 * /analyzy addresses, the sitemap, the feed and llms.txt. The articles themselves
 * are untouched — published stays published — and come back with the section.
 *
 * The build decides once (scripts/generate-static-content.mjs): it writes the
 * articles that are ON THE SITE to scripts/.articles.json — the published ones
 * while the switch is on, none while it is off — and everything downstream counts
 * that list. Flipping the switch or publishing / withdrawing an article queues a
 * rebuild, so the build always knows the current answer.
 */

import { isInsightsPage } from "./routing.js";

/** The rule, in one place: the section is live while anything is on the site. */
export function sectionIsLive(onSiteCount) {
  return Number(onSiteCount) > 0;
}

/**
 * The articles the site carries: the published ones while Boss's switch is on,
 * none while it is off. `section` is the site_sections row for 'analyzy'. A
 * missing row or an unreadable one is an error, never a guess — the build then
 * refuses and the previous deployment stays live, rather than showing a section
 * Boss hid or hiding one he shows.
 */
export function articlesOnSite(published, section) {
  if (!Array.isArray(published)) throw new Error("the published articles were not read");
  if (!section || typeof section.visible !== "boolean") {
    throw new Error("public.site_sections has no 'analyzy' row — cannot tell whether the section is shown");
  }
  return section.visible ? published : [];
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
