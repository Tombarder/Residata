/**
 * Supabase client singleton.
 * Publishable key is safe in browser — RLS policies protect all gating.
 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.warn("Supabase env missing — running in offline/fallback mode");
}

export const supabase = url && key ? createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
}) : null;

export const isSupabaseReady = () => !!supabase;
