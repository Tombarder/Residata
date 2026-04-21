import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { supabase, isSupabaseReady } from "./supabase";

const DEBUG = true;
const log = (...a) => DEBUG && console.log("[useAuth]", ...a);

/**
 * SHARED auth state via React Context.
 *
 * Before this refactor `useAuth` was a plain hook with its own `useState`
 * internals. Every component that called it got a SEPARATE state slice —
 * so when CompleteProfile called `reloadProfile()`, only CompleteProfile's
 * own state updated, while App.jsx kept its stale `profile` and never
 * unmounted CompleteProfile. Classic React hook-scope bug.
 *
 * Fix: single provider at the root owns the real state; `useAuth()` is now
 * a thin `useContext` wrapper. Every consumer reads and writes the same
 * shared state.
 */

const AuthContext = createContext(null);

function useAuthInternal() {
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
        // STALE-SESSION DETECTION — see notes in previous fix commit.
        const { data: check } = await supabase.from("user_profiles")
          .select("id").eq("id", session.user.id).maybeSingle();
        if (!check) {
          log("stale session — user in localStorage but not in DB. signing out.");
          try { await supabase.auth.signOut({ scope: "local" }); } catch {}
          setUser(null);
          setProfile(null);
          setProfileError(null);
        }
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
    if (!isSupabaseReady()) {
      // Even without Supabase reachable, clear the UI
      window.location.replace("/");
      return;
    }
    log("signOut: clearing session");
    // scope:'local' — clears localStorage session without calling the Supabase
    // server. Default scope:'global' no-ops when access token is expired
    // (magic-link tokens are 1h), leaving the user stuck "logged in".
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (e) {
      log("signOut error (ignored)", e);
    }
    setUser(null);
    setProfile(null);
    setProfileError(null);
    // Hard reload — guarantees no stale in-memory state, no cached React trees,
    // no dangling onAuthStateChange listener race. Lands the user on the public
    // home page as a clean anon. Belt-and-suspenders; reliability > elegance.
    window.location.replace("/");
  };

  // DÔLEŽITÉ: fallback tier 'pending' (nie 'free'), nech anon/loading nemá free caps.
  const tier = profile?.tier || (user ? "pending" : "anon");

  return {
    user, profile, tier, loading, profileError,
    signIn, signOut,
    reloadProfile: () => user && loadProfile(user.id),
    // Lets callers push a locally-updated profile straight into context
    // without a DB round-trip. Useful right after an UPDATE that already
    // returned the new row (no need to refetch).
    setProfile,
  };
}

/**
 * AuthProvider — wrap the app root with this so every consumer shares
 * the same auth state. Must be mounted once, at the top of the tree.
 */
export function AuthProvider({ children }) {
  const value = useAuthInternal();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth — read/act on the shared auth state.
 * MUST be used inside <AuthProvider>.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Helpful error during development if someone forgets the provider.
    throw new Error("useAuth() must be used inside <AuthProvider>. Wrap your app root.");
  }
  return ctx;
}
