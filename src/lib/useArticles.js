/**
 * Reading and writing the /analyzy analyses.
 *
 * Content lives in public.articles, not in this repo, so Boss can fix a
 * sentence and press publish without a developer or a deploy. There is NO API
 * route behind any of this: the app sits at exactly 12 of 12 Vercel Hobby
 * serverless functions and one more fails the whole deploy, so these calls go
 * straight to PostgREST and RLS is the security boundary — anon and ordinary
 * users can read `published = true` and nothing else; only tier='admin' writes.
 *
 * Reads go through `supabaseData` rather than the auth client, per the standing
 * rule in this codebase: the auth client blocks on token refresh and a logged-in
 * page hangs on "Loading".
 */

import { useCallback, useEffect, useState } from "react";
import { supabaseData, supabase } from "./supabase";

/** Columns the public page needs. Kept in one place so a rename cannot half-land. */
const PUBLIC_COLS =
  "id,slug,article_date,published,title,perex,blocks,method,og_image,seo_title,seo_keywords,updated_at";

/** Shape a database row into what the renderer expects. */
function toArticle(row) {
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
  };
}

/**
 * Published analyses, newest first — the public index.
 * `admin` also returns drafts, for the management screen.
 */
export function useArticles({ admin = false } = {}) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!supabaseData) { setLoading(false); return; }
    setLoading(true);
    // The admin screen must see drafts, which RLS only returns to a logged-in
    // admin — so it reads through the AUTH client, whose session carries the
    // claim. The public list stays on supabaseData.
    const client = admin ? supabase : supabaseData;
    let q = client.from("articles").select(PUBLIC_COLS).order("article_date", { ascending: false });
    if (!admin) q = q.eq("published", true);
    const { data, error: err } = await q;
    if (err) setError(err.message);
    else { setArticles((data || []).map(toArticle)); setError(null); }
    setLoading(false);
  }, [admin]);

  useEffect(() => { load(); }, [load]);
  return { articles, loading, error, reload: load };
}

/** One analysis by slug. Returns null once loaded if there is no such row. */
export function useArticle(slug, { admin = false } = {}) {
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabaseData || !slug) { setLoading(false); return; }
      setLoading(true);
      const client = admin ? supabase : supabaseData;
      const { data } = await client
        .from("articles").select(PUBLIC_COLS).eq("slug", slug).maybeSingle();
      if (!cancelled) { setArticle(toArticle(data)); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [slug, admin]);

  return { article, loading };
}

/* ───────────────────────────── admin writes ───────────────────────────── */

/** Publish or withdraw. One call, because that is what the button does. */
export async function setArticlePublished(id, published) {
  const { error } = await supabase.from("articles").update({ published }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Save an edited analysis. Only the fields an editor can touch are sent, so a
 * stale client can never blank a column it did not know about.
 */
export async function saveArticle(id, patch) {
  const body = {};
  if (patch.title) body.title = patch.title;
  if (patch.perex) body.perex = patch.perex;
  if (patch.blocks) body.blocks = patch.blocks;
  if (patch.method) body.method = patch.method;
  if (patch.date) body.article_date = patch.date;
  if ("ogImage" in patch) body.og_image = patch.ogImage || null;
  const { data: session } = await supabase.auth.getUser();
  if (session?.user?.id) body.updated_by = session.user.id;

  const { error } = await supabase.from("articles").update(body).eq("id", id);
  // The method-note CHECK constraint is deliberate: an analysis that does not
  // say where its numbers came from is not publishable. Surface it in words
  // rather than as a Postgres error code.
  if (error) {
    // The table refuses an article that would render broken. Say which, in words.
    const m = String(error.message);
    if (m.includes("articles_method_present")) {
      throw new Error("Metodika musí zostať vyplnená (aspoň 40 znakov) — bez nej analýza nie je citovateľná.");
    }
    if (m.includes("articles_title_present")) {
      throw new Error("Titulok musí byť vyplnený v oboch jazykoch — inak je článok na webe bez nadpisu.");
    }
    if (m.includes("articles_perex_present")) {
      throw new Error("Perex musí byť vyplnený v oboch jazykoch — zobrazuje sa v zozname a vo vyhľadávaní.");
    }
    throw new Error(m);
  }
}
