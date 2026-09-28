/**
 * prerenderCore — the pure half of scripts/prerender.mjs: turning a page's SEO
 * model into HTML and splicing it into the app's built index.html. No file
 * system, no network, no React, so every rule here is unit-tested
 * (src/lib/prerender.test.mjs) without running a build.
 */

/**
 * Public routes that are not articles — every public entry of routing.js's
 * table. prerender.mjs writes each one's head; src/lib/prerender.test.mjs fails
 * if a public route is added to routing.js and not here.
 */
export const HEAD_ONLY_PATHS = [
  "/home", "/live", "/use-cases", "/pricing", "/contact", "/sample", "/data",
  "/privacy", "/imprint", "/terms", "/status", "/hero-lab",
];

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON that is safe inside a <script> element: no "</script>", no "<!--". */
export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The page-specific head: every tag a crawler or a link preview reads.
 * `m` is { title, description, keywords, robots, canonical, alternates[],
 * og{}, twitter{}, jsonLd, extra[] }.
 */
export function headHtml(m) {
  const lines = [];
  lines.push(`<title>${escapeHtml(m.title)}</title>`);
  lines.push(`<meta name="description" content="${escapeHtml(m.description)}" />`);
  if (m.keywords) lines.push(`<meta name="keywords" content="${escapeHtml(m.keywords)}" />`);
  lines.push(`<meta name="robots" content="${escapeHtml(m.robots)}" />`);
  lines.push(`<link rel="canonical" href="${escapeHtml(m.canonical)}" />`);
  for (const a of m.alternates || []) {
    lines.push(`<link rel="alternate" hreflang="${escapeHtml(a.hreflang)}" href="${escapeHtml(a.href)}" />`);
  }
  for (const [k, v] of Object.entries(m.og || {})) {
    if (v !== "" && v != null) lines.push(`<meta property="${escapeHtml(k)}" content="${escapeHtml(v)}" />`);
  }
  for (const [k, v] of Object.entries(m.twitter || {})) {
    if (v !== "" && v != null) lines.push(`<meta name="${escapeHtml(k)}" content="${escapeHtml(v)}" />`);
  }
  for (const x of m.extra || []) lines.push(x);
  if (m.jsonLd) {
    lines.push(`<script type="application/ld+json" id="${m.jsonLdId || "ld-page"}">${scriptJson(m.jsonLd)}</script>`);
  }
  return lines.map((l) => `    ${l}`).join("\n");
}

/** The tags the built index.html carries for the HOMEPAGE, which every other page replaces. */
const PER_PAGE_TAGS = [
  /[ \t]*<title>[\s\S]*?<\/title>\s*\n?/g,
  /[ \t]*<meta name="(?:description|keywords|robots|googlebot)"[^>]*>\s*\n?/g,
  /[ \t]*<link rel="canonical"[^>]*>\s*\n?/g,
  /[ \t]*<link rel="alternate" hreflang="[^"]*"[^>]*>\s*\n?/g,
  /[ \t]*<meta property="(?:og|article):[^"]*"[^>]*>\s*\n?/g,
  /[ \t]*<meta name="twitter:[^"]*"[^>]*>\s*\n?/g,
];

const LD_BLOCK = /[ \t]*<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>\s*\n?/g;

/**
 * The nodes of the template's structured data that describe the COMPANY and
 * the SITE (Organization, WebSite) — true on every page, and what an Article's
 * publisher refers to. The product nodes (SoftwareApplication, Service) and the
 * homepage FAQ are not: FAQ markup must match a FAQ visible on the page, and
 * none is visible on an article.
 */
export function siteNodes(template) {
  const out = [];
  for (const m of template.matchAll(LD_BLOCK)) {
    let json;
    try { json = JSON.parse(m[1]); } catch { continue; }
    for (const node of json["@graph"] || [json]) {
      if (node && (node["@type"] === "Organization" || node["@type"] === "WebSite")) out.push(node);
    }
  }
  return out;
}

/**
 * The built index.html with the homepage's per-page tags replaced by this
 * page's, and `<html lang>` set. `dropJsonLd` removes the template's
 * structured-data blocks (the page supplies its own graph, which re-includes
 * the site nodes); left false, they stay (marketing routes keep the product
 * graph) but the homepage FAQ goes, since only /pricing shows a FAQ.
 */
export function replaceHead(template, { lang, head, dropJsonLd = false }) {
  let html = template;
  for (const re of PER_PAGE_TAGS) html = html.replace(re, "");
  html = html.replace(LD_BLOCK, (block, body) => {
    if (dropJsonLd) return "";
    return /"@type"\s*:\s*"FAQPage"/.test(body) ? "" : block;
  });
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${escapeHtml(lang)}"`);
  if (!html.includes("</head>")) throw new Error("template has no </head>");
  return html.replace("</head>", `${head}\n  </head>`);
}

/**
 * Put the page's own markup into the app's root, drop the generic "this app
 * needs JavaScript" notice (the content is right there), and embed the row the
 * app starts from. React's createRoot replaces the root's children when it
 * mounts, so the static markup is what shows until the app has the same page.
 */
export function fillRoot(html, markup, { embed, embedId = "rd-article" } = {}) {
  if (!html.includes('<div id="root"></div>')) throw new Error('template has no empty <div id="root">');
  let out = html.replace(/[ \t]*<noscript>[\s\S]*?<\/noscript>\s*\n?/, "");
  // data-prerendered tells main.jsx to mount only once the page's code is in.
  out = out.replace('<div id="root"></div>', `<div id="root" data-prerendered="1">${markup}</div>`);
  if (embed !== undefined) {
    out = out.replace("</body>",
      `  <script type="application/json" id="${embedId}">${scriptJson(embed)}</script>\n  </body>`);
  }
  return out;
}

/** RFC-822 date for RSS, from YYYY-MM-DD or an ISO timestamp. */
export function rfc822(d) {
  const x = new Date(String(d).length === 10 ? `${d}T08:00:00Z` : d);
  return x.toUTCString();
}

/**
 * RSS 2.0 of the published analyses — how feed readers, newsletters and many
 * crawlers learn that a new issue exists without re-reading the whole site.
 */
export function rssFeed(items, { home, title, description, lang = "sk", buildDate }) {
  const it = items.map((a) => `    <item>
      <title>${escapeHtml(a.title)}</title>
      <link>${escapeHtml(a.url)}</link>
      <guid isPermaLink="true">${escapeHtml(a.url)}</guid>
      <pubDate>${rfc822(a.date)}</pubDate>
      <description>${escapeHtml(a.description)}</description>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(title)}</title>
    <link>${home}/analyzy</link>
    <atom:link href="${home}/analyzy/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeHtml(description)}</description>
    <language>${lang}</language>
    <lastBuildDate>${rfc822(buildDate)}</lastBuildDate>
${it}
  </channel>
</rss>
`;
}

/**
 * Checks a written page against what it must say. Returns problems as strings;
 * an empty list means the page is right. Used on every page the build writes
 * AND by the live check against the deployed site (scripts/verify-seo-live.mjs),
 * so the two cannot hold different rules.
 */
export function pageProblems(html, want) {
  const p = [];
  const count = (re) => (html.match(re) || []).length;
  const attr = (re) => (re.exec(html) || [])[1];
  if (count(/<title>/g) !== 1) p.push(`${count(/<title>/g)} <title> tags`);
  const title = attr(/<title>([\s\S]*?)<\/title>/);
  if (want.title && title !== escapeHtml(want.title)) p.push(`title is "${title}", not "${want.title}"`);
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
  if (canon.length !== 1) p.push(`${canon.length} canonical links`);
  else if (want.canonical && canon[0] !== want.canonical) p.push(`canonical is ${canon[0]}, not ${want.canonical}`);
  const lang = attr(/<html lang="([^"]*)"/);
  if (want.lang && lang !== want.lang) p.push(`<html lang="${lang}">, not "${want.lang}"`);
  const robots = attr(/<meta name="robots" content="([^"]*)"/);
  if (want.index === true && !/^index/.test(robots || "")) p.push(`robots "${robots}" — the page would not be indexed`);
  if (want.index === false && !/noindex/.test(robots || "")) p.push(`robots "${robots}" — the page should be noindex`);
  const ogImage = attr(/<meta property="og:image" content="([^"]*)"/);
  if (!ogImage || !/^https?:\/\//.test(ogImage)) p.push(`og:image "${ogImage}" is not an absolute url`);
  else if (want.ogImage && ogImage !== want.ogImage) p.push(`og:image is ${ogImage}, not ${want.ogImage}`);
  const ogUrl = attr(/<meta property="og:url" content="([^"]*)"/);
  if (want.canonical && ogUrl !== want.canonical) p.push(`og:url is ${ogUrl}, not ${want.canonical}`);
  if (want.h1 && !html.includes(escapeHtml(want.h1))) p.push("the headline is not in the page");
  if (want.jsonLdType) {
    const types = [];
    for (const m of html.matchAll(LD_BLOCK)) {
      try {
        const j = JSON.parse(m[1]);
        for (const n of j["@graph"] || [j]) types.push(n["@type"]);
      } catch { p.push("a structured-data block is not valid JSON"); }
    }
    for (const t of [].concat(want.jsonLdType)) if (!types.includes(t)) p.push(`no ${t} structured data`);
    if (types.includes("FAQPage") && want.noFaq) p.push("FAQ structured data on a page that shows no FAQ");
  }
  if (want.hreflang) {
    const got = [...html.matchAll(/hreflang="([^"]*)"/g)].map((m) => m[1]).sort().join(",");
    const exp = [...want.hreflang].sort().join(",");
    if (got !== exp) p.push(`hreflang ${got || "none"}, not ${exp}`);
  }
  return p;
}
