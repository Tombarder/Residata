import { useEffect, useState, useCallback } from "react";
import { supabase, isSupabaseReady } from "./supabase";

const DEBUG = true;  // toggluj na false v prod neskor
const log = (...a) => DEBUG && console.log("[useAuth]", ...a);

/**
 * Hook pre Supabase auth state.
 * Vráti: { user, profile, tier, loading, profileError, signIn, signOut, reloadProfile }
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    log("loadProfile start", userId);
    const { data, error } = await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
      log("loadProfile ERROR", error.message, error);
      setProfileError(error.message);
    } else {
      log("loadProfile ok", data?.tier, data?.profile_completed);
      setProfileError(null);
    }
    setProfile(data || null);
  }, []);

  useEffect(() => {
    if (!isSupabaseReady()) {
      setLoading(false);
      return;
    }
    let unsub = () => {};
    (async () => {
      log("mount: getSession");
      const { data: { session } } = await supabase.auth.getSession();
      log("getSession →", session?.user?.email || "no session");
      setUser(session?.user || null);
      if (session?.user) {
        await loadProfile(session.user.id);
      }
      setLoading(false);

      const { data } = supabase.auth.onAuthStateChange(async (event, sess) => {
        log("onAuthStateChange", event, sess?.user?.email || "null");
        setUser(sess?.user || null);
        if (sess?.user) await loadProfile(sess.user.id);
        else { setProfile(null); setProfileError(null); }
      });
      unsub = () => data.subscription.unsubscribe();
    })();
    return () => unsub();
  }, [loadProfile]);

  // Reload profile keď user vráti do tab-u
  useEffect(() => {
    if (!isSupabaseReady()) return;
    const onFocus = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) await loadProfile(session.user.id);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadProfile]);

  const signIn = async (email) => {
    if (!isSupabaseReady()) return { error: "Supabase offline" };
    return supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/" },
    });
  };

  const signOut = async () => {
    if (!isSupabaseReady()) return;
    await supabase.auth.signOut();
  };

  // `tier` vraciame ako raw hodnotu — pre capability checky používaj useCapabilities().
  // Helpers ako isPaid/isAdmin sú deprecated a odstránené; namiesto nich:
  //   const { can } = useCapabilities();
  //   can("has_paid_access"), can("manage_users"), atď.
  const tier = profile?.tier || (user ? "free" : "anon");

  return { user, profile, tier, loading, profileError, signIn, signOut, reloadProfile: () => user && loadProfile(user.id) };
}
