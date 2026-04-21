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
    // scope:'local' — clears localStorage session without calling the Supabase
    // server. The default scope:'global' tries to revoke the session server-side
    // and silently no-ops if the access token is already expired (magic-link
    // tokens are 1h), leaving the user stuck "logged in". Local is what we
    // actually want here — always works, instant.
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (e) {
      log("signOut error (ignored)", e);
    }
    // Belt-and-suspenders: if for any reason the onAuthStateChange listener
    // doesn't fire (e.g. it was unsubscribed), force-clear state so the UI
    // reflects signed-out immediately.
    setUser(null);
    setProfile(null);
    setProfileError(null);
  };

  // `tier` vraciame ako raw hodnotu — pre capability checky používaj useCapabilities().
  // Helpers ako isPaid/isAdmin sú deprecated a odstránené; namiesto nich:
  //   const { can } = useCapabilities();
  //   can("has_paid_access"), can("manage_users"), atď.
  //
  // DÔLEŽITÉ: ak user je prihlásený ale profile ešte nie je načítaný (alebo
  // fetch zlyhal kvôli RLS), NESMIE sa fallbackovať na "free" — to by dočasne
  // udelilo free capabilities čomukoľvek čo useAuth konzumuje priamo.
  // useCapabilities() má svoj vlastný "anon kým loading" handler.
  const tier = profile?.tier || (user ? "pending" : "anon");

  return { user, profile, tier, loading, profileError, signIn, signOut, reloadProfile: () => user && loadProfile(user.id) };
}
