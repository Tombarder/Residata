/**
 * Boss's switch for a whole section of residata.eu (admin → Analýzy).
 *
 * public.site_sections — one row per section ('analyzy' today), readable by
 * anyone, updatable only by an admin (RLS; novostavby
 * v2/migrations/2026-10-07_site_sections_switch.sql). Changing `visible` queues a
 * rebuild of the site, which is when the change appears: the build reads the
 * switch (scripts/generate-static-content.mjs, lib/analysesSection articlesOnSite).
 * Writes go through supabaseData like every other write as the signed-in user.
 */
import { useCallback, useEffect, useState } from "react";
import { supabaseData } from "./supabase";

const COLS = "section,visible,updated_at";
const shape = (r) => ({ section: r.section, visible: r.visible, updatedAt: r.updated_at });

export async function readSection(section) {
  const { data, error } = await supabaseData.from("site_sections").select(COLS).eq("section", section).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error(`no site section '${section}'`), { code: "MISSING" });
  return shape(data);
}

/** Sets the switch; resolves to the row as the database now has it. An update
 *  RLS refuses comes back as zero rows, not an error — reported as NOT_ALLOWED
 *  rather than as a success that changed nothing. */
export async function setSectionVisible(section, visible) {
  const { data, error } = await supabaseData.from("site_sections").update({ visible }).eq("section", section).select(COLS);
  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error("not allowed"), { code: "NOT_ALLOWED" });
  return shape(data[0]);
}

/** { row, loading, error, set } for one section. */
export function useSiteSection(section) {
  const [row, setRow] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    readSection(section).then((r) => { if (live) setRow(r); }, (e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [section]);
  const set = useCallback(async (visible) => {
    const r = await setSectionVisible(section, visible);
    setRow(r); setError(null);
    return r;
  }, [section]);
  return { row, loading: !row && !error, error, set };
}
