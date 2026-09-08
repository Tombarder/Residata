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
    // Always supabaseData, never the auth client: reading data through the auth
    // client is what makes a logged-in page hang on "Loading", and it is not
    // needed here — supabaseData attaches the session token, so RLS already sees
    // the admin claim and returns drafts. `admin` only decides the filter.
    let q = supabaseData.from("articles").select(PUBLIC_COLS)
      .order("article_date", { ascending: false });
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
export function useArticle(slug) {
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabaseData || !slug) { setLoading(false); return; }
      setLoading(true);
      // Same reasoning as useArticles: one client for reads. An admin sees a
      // draft because RLS lets them, not because of a different client.
      const { data } = await supabaseData
        .from("articles").select(PUBLIC_COLS).eq("slug", slug).maybeSingle();
      if (!cancelled) { setArticle(toArticle(data)); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return { article, loading };
}

/* ───────────────────────────── admin writes ───────────────────────────── */

/** Publish or withdraw. One call, because that is what the button does. */
export async function setArticlePublished(id, published) {
  const { error } = await supabase.from("articles").update({ published }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Create an empty draft. Everything is editable afterwards, so this only has to
 * satisfy the table's constraints — a title, a standfirst and a method note.
 */
export async function createArticle({ slug, date }) {
  const stub = (sk, en) => ({ sk, en });
  const { data, error } = await supabase.from("articles").insert({
    slug,
    article_date: date,
    published: false,
    title: stub("Nová analýza", "New analysis"),
    perex: stub("Krátke zhrnutie, ktoré sa zobrazí v zozname.",
                "A short summary shown in the list."),
    blocks: [{ type: "lead", text: stub("", "") }],
    method: stub(
      "Dáta pochádzajú z verejne publikovaných cenníkov developerov, ktoré Residata zaznamenáva denne.",
      "Data come from developers' publicly published price lists, recorded daily by Residata."),
  }).select("slug").maybeSingle();
  if (error) {
    if (String(error.message).includes("articles_slug_shape")) {
      throw new Error("URL smie obsahovať len malé písmená bez diakritiky, číslice a pomlčky (napr. trh-novostavieb-2026-10).");
    }
    if (String(error.message).includes("duplicate key")) {
      throw new Error("Článok s touto URL už existuje.");
    }
    throw new Error(error.message);
  }
  return data?.slug || slug;
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
  if (patch.slug) body.slug = patch.slug;
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
