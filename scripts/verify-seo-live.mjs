#!/usr/bin/env node
/**
 * verify-seo-live.mjs — read the LIVE site the way a link preview or a crawler
 * does (no JavaScript) and fail if any page stopped saying what it is.
 *
 *     node scripts/verify-seo-live.mjs                 # check residata.eu
 *     node scripts/verify-seo-live.mjs --indexnow      # …then tell Bing/Seznam what changed
 *     SITE=https://preview.example node scripts/verify-seo-live.mjs
 *
 * WHY. The build checks every page it writes (scripts/prerender.mjs), but a
 * build is not the site: a rewrite rule, a cache, a file that never shipped or
 * a deploy that did not happen are all invisible from inside it. This asks the
 * deployed site itself, after every production deploy and once a day
 * (.github/workflows/seo-live-check.yml) — the daily run is the one GitHub
 * emails about when it fails.
 *
 * WHAT. Every url in the live sitemap: the right title, ONE canonical naming
 * itself, the right language, index/noindex as intended, a share image that
 * really answers 200 image/*, the structured data, the headline in the HTML,
 * every figure's file, and — for a page with a Slovak twin — both language
 * addresses exactly as routing.SK_PATHS has them. Plus: every analysis in the
 * feed and in llms.txt.
 * Same rules as the build (scripts/lib/prerenderCore.mjs pageProblems).
 *
 * Node built-ins only, so CI needs no install.
 */
import { pageProblems } from "./lib/prerenderCore.mjs";
import { pathToPage, pageToPath, pathLang, SK_PATHS } from "../src/lib/routing.js";

const SITE = (process.env.SITE || "https://residata.eu").replace(/\/$/, "");
// Canonicals name the production domain on every host — on a preview too, which
// is what keeps a preview from competing with the real site in search.
const PROD = "https://residata.eu";
const UA = "Mozilla/5.0 (compatible; LinkedInBot/1.0; +https://residata.eu/verify-seo-live)";
const INDEXNOW = process.argv.includes("--indexnow");
const HOMEPAGE_TITLE = "Residata — New-Build Market Intelligence for Slovakia & Czechia";

async function get(url, { method = "GET", tries = 3 } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { method, headers: { "user-agent": UA }, redirect: "follow" });
      const body = method === "HEAD" ? "" : await r.text();
      return { status: r.status, type: r.headers.get("content-type") || "", body };
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
  throw last;
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function checkPage(url, lastmod) {
  const path = url.slice(SITE.length) || "/";
  const r = await get(url);
  if (r.status !== 200) return [`HTTP ${r.status}`];
  const html = r.body;
  const isArticle = /^\/analyzy\/[a-z0-9-]+$/.test(path);
  const isIndex = path === "/analyzy";
  const want = {
    canonical: path === "/" ? `${PROD}/` : PROD + path,
    index: true,
    noFaq: isArticle || isIndex,
    jsonLdType: isArticle ? ["Article", "BreadcrumbList"] : isIndex ? ["CollectionPage"] : [],
  };
  if (isArticle || isIndex) {
    want.lang = "sk";
    want.hreflang = ["sk", "x-default"];
  } else if (SK_PATHS[pathToPage(path)]) {
    // A marketing page exists once per language (routing.SK_PATHS): each copy
    // says its own language and names both addresses, English as the default.
    const page = pathToPage(path);
    const en = PROD + pageToPath(page, "en"), sk = PROD + SK_PATHS[page];
    want.lang = pathLang(path) || "en";
    want.alternates = [{ hreflang: "en", href: en }, { hreflang: "sk", href: sk }, { hreflang: "x-default", href: en }];
  }
  const problems = pageProblems(html, want);
  const title = decode((/<title>([\s\S]*?)<\/title>/.exec(html) || [])[1] || "");
  if (path !== "/" && title === HOMEPAGE_TITLE) problems.push("the page still carries the homepage's title");
  if (isArticle) {
    const h1 = decode((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
    if (!h1) problems.push("no headline in the HTML — the article's text is not in the page");
    const words = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    if (words < 150) problems.push(`only ${words} words of text in the HTML`);
    const mod = (/<meta property="article:modified_time" content="([^"]*)"/.exec(html) || [])[1] || "";
    if (lastmod && mod && mod.slice(0, 10) !== lastmod) {
      problems.push(`the page was last changed ${mod.slice(0, 10)} but the sitemap says ${lastmod}`);
    }
  }
  const img = (/<meta property="og:image" content="([^"]*)"/.exec(html) || [])[1];
  if (img) {
    const ri = await get(img, { method: "HEAD" });
    if (ri.status !== 200 || !/^image\//.test(ri.type)) problems.push(`share image ${img} answers ${ri.status} ${ri.type}`);
  }
  if (isArticle) {
    const srcs = new Set([...html.matchAll(/<(?:img|source)[^>]+(?:src|srcSet|srcset)="(\/analyzy\/[^"]+)"/g)].map((m) => m[1]));
    for (const s of srcs) {
      // The site answers a path it does not have with the app's own page
      // (200 text/html), so a figure must answer as an IMAGE, not just 200.
      const rf = await get(SITE + s, { method: "HEAD" });
      if (rf.status !== 200 || !/^image\//.test(rf.type)) problems.push(`figure ${s} answers ${rf.status} ${rf.type}`);
    }
  }
  return problems;
}

async function main() {
  const sm = await get(`${SITE}/sitemap.xml`);
  if (sm.status !== 200) throw new Error(`sitemap answers ${sm.status}`);
  const entries = [...sm.body.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
    .map((m) => ({ url: m[1].replace(PROD, SITE), lastmod: m[2] }));
  if (entries.length < 5) throw new Error(`the sitemap lists only ${entries.length} urls`);

  const failures = [];
  // A just-finished deploy can take a moment to reach every edge; a page that
  // fails is read again before it counts.
  for (const e of entries) {
    let problems = await checkPage(e.url, e.lastmod);
    for (let i = 0; problems.length && i < (process.env.NO_RETRY ? 0 : 2); i++) {
      await new Promise((res) => setTimeout(res, 30000));
      problems = await checkPage(e.url, e.lastmod);
    }
    console.log(`${problems.length ? "FAIL" : "ok  "} ${e.url}${problems.length ? " — " + problems.join("; ") : ""}`);
    if (problems.length) failures.push(e.url);
  }

  const articles = entries.filter((e) => /\/analyzy\/[a-z0-9-]+$/.test(e.url));
  const feed = await get(`${SITE}/analyzy/feed.xml`);
  const llms = await get(`${SITE}/llms.txt`);
  for (const a of articles) {
    if (!feed.body.includes(`<link>${a.url.replace(SITE, PROD)}</link>`)) {
      console.log(`FAIL ${a.url} — missing from /analyzy/feed.xml`); failures.push(`${a.url} (feed)`);
    }
    if (!llms.body.includes(a.url.replace(SITE, PROD))) {
      console.log(`FAIL ${a.url} — missing from /llms.txt`); failures.push(`${a.url} (llms.txt)`);
    }
  }

  if (INDEXNOW && !failures.length) await indexNow(entries);

  console.log(`[verify-seo-live] ${entries.length} urls, ${articles.length} analyses — ${failures.length} failure(s)`);
  if (failures.length) process.exit(1);
}

/**
 * Tell the engines that take IndexNow (Bing — which also feeds ChatGPT's web
 * search — Seznam, Yandex, Naver) which urls changed in the last two days, so
 * they re-read them now instead of whenever they next pass. Google does not
 * take IndexNow; it reads the sitemap.
 */
async function indexNow(entries) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) { console.log("[indexnow] no INDEXNOW_KEY — skipped"); return; }
  const since = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  // The index and the feed only while the section is on the site — the sitemap
  // lists /analyzy exactly then (lib/analysesSection).
  const section = entries.some((e) => e.url === `${SITE}/analyzy`);
  const urlList = entries.filter((e) => e.lastmod >= since).map((e) => e.url)
    .concat(section ? [`${SITE}/analyzy`, `${SITE}/analyzy/feed.xml`] : []);
  const host = new URL(SITE).host;
  const r = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation: `${SITE}/${key}.txt`, urlList: [...new Set(urlList)] }),
  });
  console.log(`[indexnow] ${urlList.length} urls → HTTP ${r.status}`);
}

main().catch((e) => { console.error(`[verify-seo-live] ${e.message}`); process.exit(1); });
