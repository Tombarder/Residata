/**
 * The files an analysis shows that do NOT live in its row — every chart drawing
 * and the share card — and whether each one is actually on the site.
 *
 * 🔴 Publishing from /app/articles flips ONE database column; the charts are
 * static files in public/analyzy/ that reach the web only through a commit and
 * a Vercel build (board 693ea7). So a draft whose figures were generated but
 * never pushed would go live with its text and a broken image for every chart.
 * `publish_issue --publish` on the scraper side already refuses that; this is
 * the same refusal for the button.
 *
 * 🔴 The site answers a path it does not have with the app's own page — 200
 * text/html — so "answers 200" proves nothing. A file is live when it answers
 * as an IMAGE.
 *
 * The check asks the origin the editor runs on, which in production is the
 * live site. Pure apart from the injected fetch, so it is testable.
 */

/** Every same-site file the article displays: share card + each figure's drawings. */
export function articleFiles(article) {
  const out = [];
  const add = (p) => { if (typeof p === "string" && p.startsWith("/")) out.push(p.split("?")[0]); };
  add(article?.ogImage);
  for (const b of article?.blocks || []) {
    if (b?.type !== "figure") continue;
    add(b.src); add(b.srcM); add(b.srcEn);
  }
  return [...new Set(out)];
}

/**
 * The files that do not answer as an image right now, each with the reason.
 * Empty means every chart and the share card is live.
 */
export async function filesNotLive(article, fetchImpl = globalThis.fetch) {
  const missing = [];
  await Promise.all(articleFiles(article).map(async (path) => {
    try {
      const r = await fetchImpl(path, { method: "HEAD", cache: "no-store" });
      const type = (r.headers?.get?.("content-type") || "").toLowerCase();
      if (!r.ok) missing.push({ path, why: `HTTP ${r.status}` });
      else if (!type.startsWith("image/")) missing.push({ path, why: type || "no content type" });
    } catch (e) {
      // Could not ask: refusing is the safe answer — publishing is what we cannot undo unseen.
      missing.push({ path, why: e?.message || "request failed" });
    }
  }));
  return missing.sort((a, b) => a.path.localeCompare(b.path));
}
