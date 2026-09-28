/**
 * The shape of one analysis, from a public.articles row — shared by the app
 * (lib/useArticles.js) and the build (scripts/prerender.mjs), so the page the
 * build writes and the page the app renders read the row the same way.
 * Pure: no network, no DOM.
 */

/** Columns the public page needs. Kept in one place so a rename cannot half-land. */
export const PUBLIC_COLS =
  "id,slug,article_date,published,title,perex,blocks,method,og_image,seo_title,seo_keywords,updated_at,figures_measured_through,promo_checklist";

/** Just enough to list or link an article — no blocks. */
export const LIST_COLS = "slug,article_date,published,title,perex,og_image,updated_at";

/** Shape a database row into what the renderer expects. */
export function toArticle(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    date: row.article_date,
    published: row.published,
    title: row.title || {},
    perex: row.perex || {},
    blocks: Array.isArray(row.blocks) ? row.blocks : [],
    method: row.method || {},
    ogImage: row.og_image || null,
    seoTitle: row.seo_title || null,
    seoKeywords: row.seo_keywords || null,
    updatedAt: row.updated_at,
    figuresMeasuredThrough: row.figures_measured_through || null,
    // the manual promotion steps ticked in /app/articles: {step: {done_at}}
    promoChecklist: row.promo_checklist || {},
  };
}

/** The id of the <script type="application/json"> the build embeds a page's row in. */
export const EMBEDDED_ARTICLE_ID = "rd-article";

/** …and the one the /analyzy index embeds its list in: just what a card shows. */
export const EMBEDDED_LIST_ID = "rd-articles";
export const EMBEDDED_LIST_FIELDS = ["slug", "article_date", "published", "title", "perex", "og_image", "updated_at"];
