/**
 * How often the market is read, in the words the public copy uses.
 *
 * WHY THIS EXISTS. On 2026-10-05 collection moved from every day to every four
 * days (admin → Kontrola dát → Zber dát), and some thirty sentences on the site
 * went on saying "refreshed daily" — the hero, the pricing page, the FAQ, the
 * page descriptions Google shows, the structured data, llms.txt. Every one of
 * them was typed. The interval is a setting an admin can change any day, so
 * the copy reads it instead.
 *
 * Source: public.data_collection (the interval in force), read at build into
 * the snapshot (scripts/generate-static-content.mjs → window.__RESIDATA_SNAPSHOT__
 * .scrape_every_days), the same snapshot the coverage figures come from.
 * Setting a new interval queues a site rebuild (novostavby
 * v2/migrations/2026-10-06_public_copy_states_the_collection_interval.sql).
 *
 * Copy carries tokens, filled here:
 *   __EVERY__      "every day" / "every 4 days"  ·  "každý deň" / "každé 4 dni"
 *   __EVERY_CAP__  the same, capitalised — a sentence or a stat of its own
 * With no snapshot the words carry no number: "regularly" / "pravidelne".
 * Never assert an interval the build could not see.
 *
 * refreshCadence.test.mjs fails if a typed "daily" claim comes back.
 */
import { everyDays, MIN_DAYS, MAX_DAYS } from "./scrapeCadence.js";

/** The interval in force as the build read it, or null. */
export function collectionEveryDays(snapshot) {
  const s = snapshot ?? (typeof window !== "undefined" ? window.__RESIDATA_SNAPSHOT__ : null);
  const n = Number(s?.scrape_every_days);
  return Number.isInteger(n) && n >= MIN_DAYS && n <= MAX_DAYS ? n : null;
}

const sk = (lang) => lang === "sk" || lang === "cs";

/** "every day" · "every 4 days" · "každý deň" · "každé 4 dni" · "každých 7 dní". */
export function everyPhrase(lang, snapshot) {
  const n = collectionEveryDays(snapshot);
  if (n == null) return sk(lang) ? "pravidelne" : "regularly";
  return everyDays(n, sk(lang) ? "sk" : "en");
}

/** The same, capitalised. */
export function EveryPhrase(lang, snapshot) {
  const p = everyPhrase(lang, snapshot);
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Every __EVERY__ / __EVERY_CAP__ in a string, array or plain object, filled. */
export function fillEvery(node, lang, snapshot) {
  if (typeof node === "string") {
    if (!node.includes("__EVERY")) return node;
    return node
      .split("__EVERY_CAP__").join(EveryPhrase(lang, snapshot))
      .split("__EVERY__").join(everyPhrase(lang, snapshot));
  }
  if (Array.isArray(node)) return node.map((n) => fillEvery(n, lang, snapshot));
  if (node && typeof node === "object") {
    const o = {};
    for (const k in node) o[k] = fillEvery(node[k], lang, snapshot);
    return o;
  }
  return node;
}
