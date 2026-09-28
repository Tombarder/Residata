/**
 * articleSeo — everything a search engine, a link preview and an AI reader need
 * to know about ONE article, computed in ONE place.
 *
 * WHY ONE PLACE
 *   An article reaches readers two ways. A crawler or a link preview (LinkedIn,
 *   WhatsApp, Slack, ChatGPT's reader) takes the HTML the server sends and never
 *   runs our JavaScript; a person's browser runs the app, which rewrites the page
 *   head on every navigation. Until 2026-09-28 only the second knew anything:
 *   every article's raw HTML still said it WAS the homepage — English homepage
 *   title, homepage share card, `<link rel=canonical href="https://residata.eu/">`
 *   — so LinkedIn previewed a shared analysis as the product page and Google was
 *   told two contradictory things about which page an article is.
 *
 *   scripts/prerender.mjs now writes this model into a static page per article
 *   at build time, and seo.js applyArticleSeo writes the SAME model into the DOM
 *   after a client-side navigation. One function, so the page a bot reads and the
 *   page a person reads cannot drift apart.
 *
 * PURE: no DOM, no network, no React. Runs in Node at build and in the browser.
 */
import { COMPANY } from "./company.js";

export const SITE_NAME = "Residata";
export const SECTION_SK = "Analýzy";

/** Share cards are drawn at 1200 × 630 by the article pipeline (and the default). */
export const OG_W = 1200;
export const OG_H = 630;

/** Where Google cuts a title in results (≈600px) and a description in a snippet. */
export const TITLE_IDEAL_MAX = 65;
export const DESCRIPTION_MAX = 160;

const text = (v, lang) => {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v[lang] ?? "").trim();
};

/**
 * The language the article is WRITTEN in — never the visitor's UI language.
 * Every analysis so far is Slovak only (Boss 2026-09-23: no English issues yet),
 * and an English UI around a Slovak text is still a Slovak page. `<html lang>`,
 * og:locale, hreflang and inLanguage all follow this.
 */
export function seoLang(article) {
  return text(article?.title, "sk") ? "sk" : "en";
}

/** The article's headline in its own language. */
export function headline(article) {
  return text(article?.title, seoLang(article)) || text(article?.title, "en");
}

/**
 * The `<title>` / og:title. A written `seo_title` wins; otherwise the headline
 * with the site name. The headline itself is never changed for search — the
 * issues copy a fixed format (types.md) and the title tag is where search
 * wording goes.
 */
export function seoTitle(article) {
  const own = text(article?.seoTitle, seoLang(article));
  return own || `${headline(article)} · ${SITE_NAME}`;
}

/** The standfirst, whole — what the page prints under the headline. */
export function perex(article) {
  return text(article?.perex, seoLang(article));
}

/**
 * Cut at a word boundary, never mid-word, and say so with an ellipsis. Google
 * shows about 160 characters of a description; a longer one is truncated by
 * Google instead, usually mid-phrase.
 */
export function clip(s, max = DESCRIPTION_MAX) {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  const cut = v.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:–—-]+$/, "") + "…";
}

export function canonicalUrl(article, siteBase) {
  return `${siteBase}/analyzy/${article.slug}`;
}

export function shareImage(article, siteBase) {
  const src = article?.ogImage || "/og-image.png";
  return src.startsWith("http") ? src : siteBase + src;
}

/**
 * The place an issue is about, when its headline says so: every template issue
 * opens "Košice: …", "Bratislavský kraj: …", "Slovensko: …". A story headline
 * with no such prefix names no place, and none is claimed for it.
 */
export function placeOf(article) {
  const h = headline(article);
  const i = h.indexOf(":");
  if (i <= 0 || i > 40) return null;
  const p = h.slice(0, i).trim();
  return p && !/\d/.test(p) ? p : null;
}

/**
 * The period a quarterly issue measures, as an ISO 8601 interval — only for the
 * issues whose slug ends in -YYYY-qN, where the quarter IS the period. The end
 * is the day the figures were measured through, never a day that had not
 * happened yet (an issue published mid-quarter covers the quarter so far).
 */
export function periodOf(article) {
  const m = /-(\d{4})-q([1-4])$/.exec(article?.slug || "");
  if (!m) return null;
  const y = Number(m[1]);
  const q = Number(m[2]);
  const start = `${y}-${String(3 * (q - 1) + 1).padStart(2, "0")}-01`;
  const qEnd = new Date(Date.UTC(y, 3 * q, 0)).toISOString().slice(0, 10);
  const through = article?.figuresMeasuredThrough;
  const end = through && through < qEnd ? through : qEnd;
  return `${start}/${end}`;
}

const hasTables = (article) => (article?.blocks || []).some((b) => b?.type === "table");

/** ISO date-time of the last real change, falling back to the article date. */
function modified(article) {
  return article?.updatedAt || article?.date || null;
}

/**
 * The structured data, as one @graph: where the page sits (BreadcrumbList),
 * what it is (Article), and — for an article built of tables — the data it
 * publishes (Dataset, which is what Google Dataset Search indexes; that is
 * where researchers and journalists look for figures to cite).
 */
export function articleJsonLd(article, siteBase) {
  const url = canonicalUrl(article, siteBase);
  const lang = seoLang(article);
  const title = headline(article);
  const description = perex(article);
  const image = shareImage(article, siteBase);
  const place = placeOf(article);
  const org = { "@type": "Organization", name: SITE_NAME, url: `${siteBase}/` };
  const publisher = {
    "@type": "Organization",
    name: COMPANY.legalName,
    url: `${siteBase}/`,
    logo: { "@type": "ImageObject", url: `${siteBase}/favicon.svg` },
  };
  const keywords = text(article?.seoKeywords, lang) || undefined;
  const graph = [
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${siteBase}/` },
        { "@type": "ListItem", position: 2, name: SECTION_SK, item: `${siteBase}/analyzy` },
        { "@type": "ListItem", position: 3, name: title, item: url },
      ],
    },
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: title.length > 110 ? clip(title, 110) : title,
      description,
      image: [image],
      datePublished: article?.date || undefined,
      dateModified: modified(article) || undefined,
      inLanguage: lang,
      url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      author: org,
      publisher,
      isAccessibleForFree: true,
      articleSection: SECTION_SK,
      keywords,
      about: place ? { "@type": "Place", name: place } : undefined,
      breadcrumb: { "@id": `${url}#breadcrumb` },
    },
  ];
  if (hasTables(article)) {
    // Google wants 50–5000 characters here; the method note is what makes the
    // figures reusable, so it is part of the description rather than dropped.
    const method = text(article?.method, lang);
    graph.push({
      "@type": "Dataset",
      "@id": `${url}#dataset`,
      name: title,
      description: clip(`${description} ${method}`.trim(), 4900),
      url,
      creator: org,
      publisher,
      isAccessibleForFree: true,
      inLanguage: lang,
      dateModified: modified(article) || undefined,
      spatialCoverage: place ? { "@type": "Place", name: place } : undefined,
      temporalCoverage: periodOf(article) || undefined,
      keywords,
      isPartOf: { "@id": `${url}#article` },
    });
  }
  return { "@context": "https://schema.org", "@graph": graph.map(stripUndefined) };
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/**
 * The whole head of one article: every tag a crawler, a preview and the app
 * set, in one object. `prerender.mjs` prints it; `applyArticleSeo` applies it.
 */
export function articleHead(article, { siteBase }) {
  const lang = seoLang(article);
  const title = seoTitle(article);
  const description = clip(perex(article));
  const url = canonicalUrl(article, siteBase);
  const image = shareImage(article, siteBase);
  const locale = lang === "sk" ? "sk_SK" : "en_US";
  return {
    lang,
    title,
    description,
    keywords: text(article?.seoKeywords, lang) || (lang === "sk"
      ? "novostavby, ceny novostavieb, analýza trhu novostavieb, nové byty"
      : "Slovak new-build market analysis, new-build prices"),
    canonical: url,
    // A draft is reachable by direct link on purpose — that is how it gets
    // reviewed — but it must never be indexed.
    robots: article?.published === false
      ? "noindex, nofollow"
      : "index, follow, max-image-preview:large, max-snippet:-1",
    // ONE language lives at this address. The site-wide set (en, sk and
    // x-default, all at the same url) told Google an English version of a
    // Slovak-only analysis existed.
    alternates: [
      { hreflang: lang, href: url },
      { hreflang: "x-default", href: url },
    ],
    og: {
      "og:type": "article",
      "og:site_name": SITE_NAME,
      "og:title": title,
      "og:description": description,
      "og:url": url,
      "og:image": image,
      "og:image:width": String(OG_W),
      "og:image:height": String(OG_H),
      "og:image:alt": headline(article),
      "og:locale": locale,
      "article:published_time": article?.date || "",
      "article:modified_time": modified(article) || "",
      "article:section": SECTION_SK,
    },
    twitter: {
      "twitter:card": "summary_large_image",
      "twitter:title": title,
      "twitter:description": description,
      "twitter:image": image,
      "twitter:image:alt": headline(article),
    },
    jsonLd: articleJsonLd(article, siteBase),
  };
}

/**
 * What a person should see about an article's search readiness before and
 * after publishing — the same checks the build and the live check apply.
 * level: "error" = broken on the site; "warn" = works, but worse than it should
 * be; "info" = worth knowing. Messages are Slovak: the editor reads them.
 */
export function articleSeoChecks(article, { shareImageExists, missingFigures = [] } = {}) {
  const out = [];
  const add = (level, code, sk) => out.push({ level, code, sk });
  const h = headline(article);
  const title = seoTitle(article);
  const p = perex(article);
  if (!h) add("error", "no-title", "Článok nemá titulok.");
  if (!p) add("error", "no-perex", "Článok nemá perex — Google ani LinkedIn nemajú čo zobraziť pod titulkom.");
  if (!text(article?.method, seoLang(article))) add("error", "no-method", "Chýba metodika.");
  if (!article?.ogImage) {
    add("warn", "no-og-image", "Článok nemá vlastný obrázok na zdieľanie — LinkedIn ukáže všeobecný obrázok Residaty.");
  } else if (shareImageExists === false) {
    add("error", "og-image-missing", `Obrázok na zdieľanie ${article.ogImage} na webe neexistuje.`);
  }
  for (const f of missingFigures) add("error", "figure-missing", `Graf ${f} na webe neexistuje.`);
  if (title.length > TITLE_IDEAL_MAX) {
    add("warn", "title-long", `Titulok pre Google má ${title.length} znakov; Google zobrazí asi ${TITLE_IDEAL_MAX}. Skráťte ho v poli „SEO titulok“.`);
  }
  if (p && p.length < 50) add("warn", "perex-short", `Perex má len ${p.length} znakov — Google si potom vyberie vlastný úryvok.`);
  if (p.length > DESCRIPTION_MAX) add("info", "perex-clipped", `Perex má ${p.length} znakov; do popisu pre Google ide prvých ${DESCRIPTION_MAX}.`);
  if (!text(article?.seoTitle, seoLang(article))) add("info", "no-seo-title", "Bez vlastného SEO titulku sa použije nadpis článku.");
  return out;
}

/**
 * Other analyses a reader of this one is most likely to want, for the links at
 * the end of the article: its own family first (a town's kraj, a kraj's towns),
 * then the whole-country issue and the national comparisons, then the rest of
 * the same quarter. Links between the issues are also how a crawler learns the
 * set belongs together.
 */
export function relatedArticles(article, all, { limit = 5, rank = () => 100 } = {}) {
  const slug = article?.slug || "";
  const suffix = (/-(\d{4}-q[1-4])$/.exec(slug) || [])[1];
  const pool = (all || []).filter((a) => a && a.slug !== slug && a.published !== false);
  if (!suffix) {
    return pool.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);
  }
  const same = pool.filter((a) => a.slug.endsWith(suffix));
  const town = (/^([a-z]{2})-prehlad-/.exec(slug) || [])[1];
  const kraj = (/^kraj-([a-z]{2})-prehlad-/.exec(slug) || [])[1];
  const score = (a) => {
    // a town's issue and its kraj's issue share the two-letter code (ke ↔ kraj-ke)
    if (town && a.slug === `kraj-${town}-prehlad-${suffix}`) return 0;
    if (kraj && a.slug === `${kraj}-prehlad-${suffix}`) return 0;
    if (a.slug === `sk-prehlad-${suffix}`) return 1;
    if (a.slug.startsWith("kde-sa-predava-") || a.slug.startsWith("co-stoji-byt-")) return 2;
    if (a.slug === `ba-prehlad-${suffix}`) return 3;
    return 4 + rank(a.slug) / 1000;
  };
  return same.sort((a, b) => score(a) - score(b)).slice(0, limit);
}

/**
 * The steps that STAY manual for every published article — nothing else is.
 * Google has no API that indexes an article on request (its Indexing API is
 * for job ads and livestreams only), and posting is a person's decision.
 * `/app/articles` shows each with its link and a tick, so none is forgotten.
 */
export const MANUAL_STEPS = [
  {
    key: "google_indexing",
    sk: "Požiadať Google o indexovanie",
    hint: "Search Console → Kontrola webovej adresy → Požiadať o indexovanie. Urýchli to z týždňov na dni.",
    href: (url) => `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent("sc-domain:residata.eu")}&id=${encodeURIComponent(url)}`,
  },
  {
    key: "linkedin_share",
    sk: "Zdieľať na LinkedIn",
    hint: "Náhľad s titulkom a obrázkom článku sa vytvorí sám.",
    href: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    key: "linkedin_refresh",
    sk: "Obnoviť náhľad na LinkedIn (len po zmene titulku alebo obrázka)",
    hint: "LinkedIn si náhľad pamätá asi týždeň. Post Inspector ho načíta nanovo.",
    href: (url) => `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(url)}`,
    optional: true,
  },
];

/** How many required manual steps a published article still has open. */
export function openManualSteps(article) {
  if (!article?.published) return 0;
  const done = article.promoChecklist || {};
  return MANUAL_STEPS.filter((s) => !s.optional && !done[s.key]).length;
}
