/**
 * /analyzy — published market analyses, and the detail page for one.
 *
 * WHAT THIS PAGE IS FOR
 *   Three jobs, in order: rank for what developers actually search
 *   ("ceny novostavieb", "analýza trhu novostavieb"), give a journalist a stable
 *   URL they can cite, and be the canonical home of an issue that is syndicated
 *   elsewhere. Everything below serves one of those.
 *
 * DESIGN
 *   The article shell copies LegalPages' idiom deliberately (same CSS variables,
 *   same 9rem top padding to clear the fixed Nav + Ticker, same 760px measure) so
 *   the section does not read as bolted on. Figures are LIGHT cards on the dark
 *   page — the standard publication pattern — because one light chart variant
 *   then serves the page, the LinkedIn image, the og:image and print, instead of
 *   two variants that have to be kept in sync and still break when printed.
 *
 * BLOCKS
 *   Content is a list of typed blocks, not Markdown, so the house style cannot
 *   drift between issues and `method` cannot be forgotten. See lib/articleFormat.js.
 */

import { useEffect } from "react";
import { useArticles, useArticle, useArticleList } from "../lib/useArticles";
import { SITE_BASE, applySeo, applyArticleSeo } from "../lib/seo";
import { articleJsonLd, relatedArticles } from "../lib/articleSeo";
import { seriesRank } from "../lib/articleOrder.js";
import { Shell, IndexView, ArticleView } from "./insightsView";
import { EYEBROW } from "./insightsStyle.js";

/**
 * Land at the headline, not wherever the previous page was scrolled to.
 *
 * App's handleNav already calls scrollTo({behavior:"smooth"}), but the smooth
 * animation gets cancelled when the outgoing page unmounts and the document
 * height changes underneath it — measured: clicking an article from the index
 * at scroll 600 left the reader at 600, i.e. halfway down the piece. An instant
 * reset on mount is unconditional and also covers arriving by direct URL.
 */
function useScrollToTop(key) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [key]);
}

/* ───────────────────────────── structured data ───────────────────────── */

/**
 * The article's JSON-LD — breadcrumb, Article and, for an article of tables,
 * Dataset — from lib/articleSeo, the same model the build writes into the
 * static page. That page already carries it as #ld-article, so this REPLACES
 * the element rather than adding a second copy; removed on unmount so a
 * client-side navigation never leaves a previous article's schema behind.
 */
function useArticleSchema(article) {
  useEffect(() => {
    if (!article || typeof document === "undefined") return undefined;
    document.getElementById("ld-article")?.remove();
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "ld-article";
    el.textContent = JSON.stringify(articleJsonLd(article, SITE_BASE));
    document.head.appendChild(el);
    return () => { document.getElementById("ld-article")?.remove(); };
  }, [article]);
}

/* ────────────────────────────── the pages ────────────────────────────── */

export function InsightsIndex({ navigate, lang }) {
  const { articles, loading, error } = useArticles();
  useScrollToTop("index");
  // Reached either directly or as the fallback for a withdrawn article, and in
  // that second case the head still carries the dead article's canonical and its
  // noindex. Re-assert the section's own metadata so the page never advertises
  // a url that no longer exists.
  useEffect(() => { applySeo("Insights", lang); }, [lang]);
  return <IndexView articles={articles} loading={loading} error={error} navigate={navigate} lang={lang} />;
}

export function InsightsArticle({ slug, navigate, lang }) {
  const { article, loading } = useArticle(slug);
  const { articles: all } = useArticleList();
  useArticleSchema(article);
  useScrollToTop(slug);

  // Content is no longer in the bundle, so the page must set its own <title>,
  // description, canonical and og:image once the row arrives — applySeo ran on
  // navigation with nothing to go on.
  // This page is the ONLY writer of its head (App.jsx skips "Analyza:" routes):
  // while the row loads, the section's placeholder marked noindex, so a crawler
  // that gives up early never indexes a placeholder; the article's own head the
  // moment it is here. No article at all → InsightsIndex below sets the index's.
  useEffect(() => {
    if (article) applyArticleSeo(article);
    else if (loading) applySeo(`Analyza:${slug}`, lang);
  }, [article, loading, slug, lang]);

  if (loading) {
    return (
      <Shell>
        <div style={{ ...EYEBROW }}>Residata · {lang === "en" ? "Insights" : "Analýzy"}</div>
        <p style={{ color: "#8b8b95" }}>{lang === "en" ? "Loading…" : "Načítavam…"}</p>
      </Shell>
    );
  }

  // Unknown or unpublished slug: land on the index rather than a dead end. A
  // stale link stays inside the section it pointed at, which is what a visitor
  // from a shared URL or an old newsletter actually wants.
  if (!article) return <InsightsIndex navigate={navigate} lang={lang} />;

  const related = relatedArticles(article, all, { rank: seriesRank });
  return <ArticleView article={article} related={related} navigate={navigate} lang={lang} />;
}

export default InsightsIndex;
