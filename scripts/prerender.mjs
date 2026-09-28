#!/usr/bin/env node
/**
 * prerender.mjs — a finished page for every public URL, written after `vite build`.
 * ---------------------------------------------------------------------------------
 * WHY
 *   Residata is a single-page app: the server used to send ONE index.html for
 *   every address and the app filled in the page in the browser. A person never
 *   noticed. Everything that reads a page WITHOUT running JavaScript did:
 *   LinkedIn's and WhatsApp's link previews, Bing's first pass, and the AI
 *   crawlers robots.txt explicitly invites. For them every article WAS the
 *   homepage — English homepage title, homepage share card, 44 words of text,
 *   and `<link rel=canonical href="https://residata.eu/">`, which also handed
 *   Google two contradictory answers to "which page is this?" (found 2026-09-28).
 *
 * WHAT
 *   · /analyzy/<slug> for every published article — its own head (Slovak, its
 *     title, description, canonical, share card, structured data) AND the
 *     article itself, rendered by the same components the app uses
 *     (src/pages/insightsView.jsx), plus the row the app starts from.
 *   · /analyzy — the index, the same way.
 *   · every other public route — its own head; the body stays the app, which
 *     Google renders (they carry no text worth a bot's time that the head lacks).
 *   · /analyzy/feed.xml — RSS of the published analyses.
 *   Vercel serves a file before it applies the app's catch-all rewrite, so these
 *   pages answer their addresses and everything else still gets the app.
 *
 * NOTHING HERE IS HAND-WRITTEN
 *   Heads come from src/lib/articleSeo.js and src/lib/seo.js (seoMetaFor) — the
 *   same functions the running app applies — and the list of articles from
 *   scripts/.articles.json, written by generate-static-content.mjs from the same
 *   read as the sitemap. Publishing an article in /app/articles triggers a
 *   rebuild (v2/migrations/2026-09-28_articles_publish_rebuilds_the_site.sql in
 *   the scraper repo), so its page exists a few minutes later with no one
 *   remembering to do anything.
 *
 * FAILURE
 *   On Vercel a missing article list, a page that fails its own check, or an
 *   exception FAILS THE BUILD: the previous deployment — with correct pages —
 *   stays live, which is strictly better than publishing pages that are wrong.
 *   Content problems (an article whose share card or chart file is missing)
 *   do NOT fail it: the page falls back safely and the problem is printed, and
 *   scripts/verify-seo-live.mjs reports it after the deploy.
 */
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
// Native imports: Vite's SSR runner keeps library code external, so the view
// module it compiles resolves react to this very instance.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  headHtml, replaceHead, fillRoot, siteNodes, rssFeed, pageProblems, HEAD_ONLY_PATHS, duplicateJsonKeys,
} from "./lib/prerenderCore.mjs";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const HOME = process.env.VITE_SITE_BASE || process.env.SITE_BASE || "https://residata.eu";
const STRICT = !!process.env.VERCEL || process.env.PRERENDER_STRICT === "1";

const warnings = [];
const warn = (m) => { warnings.push(m); console.warn(`[prerender] WARN ${m}`); };
const die = (m) => { console.error(`[prerender] FAIL ${m}`); process.exit(1); };

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(rel, html) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

const distHas = (url) => !!url && url.startsWith("/") && fs.existsSync(path.join(DIST, url.split("?")[0]));

async function main() {
  const templatePath = path.join(DIST, "index.html");
  if (!fs.existsSync(templatePath)) die("dist/index.html missing — run after `vite build`");
  const template = fs.readFileSync(templatePath, "utf8");

  const rows = readJson(path.join(ROOT, "scripts", ".articles.json"), null);
  if (!rows) {
    if (STRICT) die("scripts/.articles.json missing — the published articles could not be read, "
      + "so this build would publish every article without its page. Keeping the previous deployment.");
    console.warn("[prerender] no scripts/.articles.json (local build without database access) — skipping.");
    return;
  }
  const build = readJson(path.join(ROOT, "scripts", ".build-data.json"), {});

  const vite = await createServer({
    root: ROOT, logLevel: "error", appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null },
    // No dependency pre-bundling: nothing here is served to a browser, and the
    // background scan otherwise races the server's close.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const load = (m) => vite.ssrLoadModule(m);
    const { ArticleView, IndexView } = await load("/src/pages/insightsView.jsx");
    const { articleHead, articleSeoChecks, relatedArticles, headline, seoLang, perex, canonicalUrl, SECTION_SK, SECTION_LANG, DATA_LICENSE } =
      await load("/src/lib/articleSeo.js");
    const { toArticle, EMBEDDED_ARTICLE_ID, EMBEDDED_LIST_ID, EMBEDDED_LIST_FIELDS } = await load("/src/lib/articleModel.js");
    const { orderArticles, seriesRank } = await load("/src/lib/articleOrder.js");
    const { seoMetaFor, DEFAULT_OG_IMAGE, DEFAULT_OG_ALT } = await load("/src/lib/seo.js");
    const { pathToPage } = await load("/src/lib/routing.js");

    const site = siteNodes(template);
    if (!site.some((n) => n["@type"] === "Organization")) die("no Organization in index.html's structured data");
    // The homepage IS this template, and no step below checks it as a page.
    for (const m of template.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      const dup = duplicateJsonKeys(m[1]);
      if (dup.length) die(`index.html's structured data repeats ${dup.join(", ")} within one object`);
    }

    // The app's code for the analyses pages, fetched alongside the page so the
    // hand-over from this static copy to the app is not a spinner.
    const chunk = fs.readdirSync(path.join(DIST, "assets")).filter((f) => /^Insights-.*\.js$/.test(f));
    const preload = chunk.length === 1 ? `<link rel="modulepreload" href="/assets/${chunk[0]}" />` : null;
    if (!preload) warn(`expected one Insights-*.js chunk, found ${chunk.length} — no modulepreload`);
    const feedLink = `<link rel="alternate" type="application/rss+xml" title="Residata — Analýzy" href="${HOME}/analyzy/feed.xml" />`;

    const articles = orderArticles(rows.map(toArticle));
    const written = [];

    // ── every published article ──────────────────────────────────────────
    for (const a of articles) {
      const missingFigures = [];
      for (const b of a.blocks) {
        if (b?.type !== "figure") continue;
        for (const src of [b.src, b.srcM, b.srcEn]) if (src && !distHas(src)) missingFigures.push(src);
      }
      const shareImageExists = a.ogImage ? distHas(a.ogImage) : undefined;
      for (const c of articleSeoChecks(a, { shareImageExists, missingFigures })) {
        if (c.level !== "info") warn(`${a.slug}: ${c.code} — ${c.sk}`);
      }
      // A share card that is not on the site would be a broken LinkedIn preview.
      const page = shareImageExists === false ? { ...a, ogImage: null } : a;
      const head = articleHead(page, { siteBase: HOME });
      const related = relatedArticles(page, articles, { rank: seriesRank });
      const markup = renderToStaticMarkup(createElement(ArticleView, {
        article: page, related, lang: head.lang, navigate: () => {},
      }));
      const graph = { "@context": "https://schema.org", "@graph": [...site, ...head.jsonLd["@graph"]] };
      let html = replaceHead(template, {
        lang: head.lang, dropJsonLd: true,
        head: headHtml({ ...head, jsonLd: graph, jsonLdId: "ld-article", extra: [feedLink, preload].filter(Boolean) }),
      });
      html = fillRoot(html, markup, { embed: rows.find((r) => r.slug === a.slug), embedId: EMBEDDED_ARTICLE_ID });
      const problems = pageProblems(html, {
        title: head.title, canonical: head.canonical, lang: head.lang, index: true,
        ogImage: head.og["og:image"], h1: headline(page),
        jsonLdType: ["Article", "BreadcrumbList"], noFaq: true, hreflang: head.alternates.map((x) => x.hreflang),
      });
      // Reuse is only invited where the licence is stated (Terms §7).
      if (!html.includes(`id="${DATA_LICENSE.anchor}"`) || !html.includes(DATA_LICENSE.deed[head.lang === "en" ? "en" : "sk"])) {
        problems.push("the page does not state the licence its data is published under");
      }
      if (problems.length) die(`${a.slug}: ${problems.join("; ")}`);
      write(`analyzy/${a.slug}/index.html`, html);
      written.push(`/analyzy/${a.slug}`);
    }

    // ── the index ─────────────────────────────────────────────────────────
    {
      const meta = seoMetaFor("Insights", SECTION_LANG, { siteBase: HOME, price: build.monthly_price, anchor: build.anchor_price, snapshot: build });
      const markup = renderToStaticMarkup(createElement(IndexView, { articles, lang: SECTION_LANG, navigate: () => {} }));
      const url = meta.url;
      const graph = {
        "@context": "https://schema.org",
        "@graph": [
          ...site,
          {
            "@type": "CollectionPage", "@id": `${url}#page`, url, name: meta.title, description: meta.description,
            inLanguage: SECTION_LANG, isPartOf: { "@id": `${HOME}/#website` },
            breadcrumb: {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Residata", item: `${HOME}/` },
                { "@type": "ListItem", position: 2, name: SECTION_SK, item: url },
              ],
            },
            mainEntity: {
              "@type": "ItemList",
              itemListElement: articles.map((x, i) => ({
                "@type": "ListItem", position: i + 1, url: canonicalUrl(x, HOME), name: headline(x),
              })),
            },
          },
        ],
      };
      const og = {
        "og:type": "website", "og:site_name": "Residata", "og:title": meta.title,
        "og:description": meta.description, "og:url": url, "og:image": HOME + DEFAULT_OG_IMAGE,
        "og:image:width": "1200", "og:image:height": "630", "og:image:alt": DEFAULT_OG_ALT, "og:locale": "sk_SK",
      };
      const twitter = {
        "twitter:card": "summary_large_image", "twitter:title": meta.title,
        "twitter:description": meta.description, "twitter:image": HOME + DEFAULT_OG_IMAGE, "twitter:image:alt": DEFAULT_OG_ALT,
      };
      let html = replaceHead(template, {
        lang: SECTION_LANG, dropJsonLd: true,
        head: headHtml({
          title: meta.title, description: meta.description, keywords: meta.keywords, robots: meta.robots,
          canonical: url, alternates: [{ hreflang: SECTION_LANG, href: url }, { hreflang: "x-default", href: url }],
          og, twitter, jsonLd: graph, extra: [feedLink, preload].filter(Boolean),
        }),
      });
      // The list the app's first render of the index starts from
      // (lib/useArticles embeddedList) — only what a card shows.
      const listRows = rows.map((r) => Object.fromEntries(EMBEDDED_LIST_FIELDS.map((k) => [k, r[k]])));
      html = fillRoot(html, markup, { embed: listRows, embedId: EMBEDDED_LIST_ID });
      const problems = pageProblems(html, {
        title: meta.title, canonical: url, lang: SECTION_LANG, index: true,
        jsonLdType: ["CollectionPage"], noFaq: true, hreflang: [SECTION_LANG, "x-default"],
      });
      for (const x of articles) if (!html.includes(`href="/analyzy/${x.slug}"`)) problems.push(`no link to ${x.slug}`);
      if (problems.length) die(`/analyzy: ${problems.join("; ")}`);
      write("analyzy/index.html", html);
      written.push("/analyzy");
    }

    // ── every other public route: its own head ───────────────────────────
    for (const p of HEAD_ONLY_PATHS) {
      const pageKey = pathToPage(p);
      const meta = seoMetaFor(pageKey, "en", { siteBase: HOME, price: build.monthly_price, anchor: build.anchor_price, snapshot: build });
      if (!meta) die(`${p} → ${pageKey} has no entry in src/lib/seo.js`);
      const og = {
        "og:type": meta.ogType || "website", "og:site_name": "Residata", "og:title": meta.title,
        "og:description": meta.description, "og:url": meta.url,
        "og:image": HOME + (meta.ogImage || DEFAULT_OG_IMAGE),
        "og:image:width": "1200", "og:image:height": "630",
        "og:image:alt": meta.ogImage ? meta.title : DEFAULT_OG_ALT, "og:locale": meta.locale,
      };
      const twitter = {
        "twitter:card": "summary_large_image", "twitter:title": meta.title,
        "twitter:description": meta.description, "twitter:image": og["og:image"], "twitter:image:alt": og["og:image:alt"],
      };
      const alternates = ["en", "sk", "x-default"].map((hreflang) => ({ hreflang, href: meta.url }));
      const html = replaceHead(template, {
        lang: "en",
        head: headHtml({
          title: meta.title, description: meta.description, keywords: meta.keywords, robots: meta.robots,
          canonical: meta.url, alternates, og, twitter,
        }),
      });
      const problems = pageProblems(html, {
        title: meta.title, canonical: meta.url, lang: "en", index: !meta.noindex, noFaq: true,
        jsonLdType: [], hreflang: ["en", "sk", "x-default"],
      });
      if (problems.length) die(`${p}: ${problems.join("; ")}`);
      write(`${p.slice(1)}/index.html`, html);
      written.push(p);
    }

    // ── the feed ──────────────────────────────────────────────────────────
    const feedItems = articles.slice()
      .sort((x, y) => String(y.date).localeCompare(String(x.date)) || seriesRank(x.slug) - seriesRank(y.slug))
      .map((x) => ({ title: headline(x), url: canonicalUrl(x, HOME), date: x.date, description: perex(x) }));
    write("analyzy/feed.xml", rssFeed(feedItems, {
      home: HOME,
      title: "Residata — Analýzy trhu novostavieb",
      description: "Štvrťročné prehľady trhu novostavieb na Slovensku — ponuka, predaj a ceny z cenníkov developerov.",
      lang: seoLang(articles[0] || { title: { sk: "x" } }),
      buildDate: new Date().toISOString(),
    }));

    if (written.length !== articles.length + 1 + HEAD_ONLY_PATHS.length) die("wrote an unexpected number of pages");
    console.log(`[prerender] ${articles.length} articles, the index, ${HEAD_ONLY_PATHS.length} routes and the feed — `
      + `${warnings.length} warning(s)`);
  } finally {
    await vite.close();
  }
}

main().catch((e) => { console.error(e); die(e.message); });
