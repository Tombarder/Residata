import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { supabase, isSupabaseReady } from "./supabase";

// F-104: gate debug log behind import.meta.env.DEV so production builds
// don't stream auth state (email, user_id, tier, profile_completed) into
// the customer's browser DevTools console. Same family as F-095 fix
// applied to ChooseProjectGate + CompleteProfile in the 2026-05-31 batch.
const log = (...a) => { if (import.meta.env.DEV) console.log("[useAuth]", ...a); };

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
    // Safety net (2026-06-10): never leave the app stuck on the loading screen.
    // setLoading(false) used to sit AFTER the getSession + profile awaits with
    // no try/catch and no timeout — so any hung or throwing await (slow network,
    // a stalled getSession, a transient query failure) left the user on an
    // infinite spinner. This timeout guarantees the app becomes interactive
    // (degraded to anon if need be) within a few seconds no matter what.
    const loadingSafety = setTimeout(() => setLoading(false), 8000);
    (async () => {
      try {
        log("mount: getSession");
        const { data: { session } } = await supabase.auth.getSession();
        log("getSession →", session?.user?.email || "no session");
        setUser(session?.user || null);
        if (session?.user) {
          // One query does double duty: load the profile AND detect a stale
          // session. CRITICAL (2026-06-10 fix): only sign out when the query
          // SUCCEEDED and the row is genuinely gone. The previous code read
          // `const {data: check}` without the error, so a transient query
          // failure (data=null) was misread as "user deleted" and logged a
          // valid user out on a momentary network blip.
          const { data: prof, error: profErr } = await supabase
            .from("user_profiles").select("*").eq("id", session.user.id).maybeSingle();
          if (profErr) {
            log("loadProfile ERROR (keeping session, NOT signing out)", profErr.message);
            setProfileError(profErr.message);
          } else if (!prof) {
            log("stale session — user in localStorage but not in DB. signing out.");
            try { await supabase.auth.signOut({ scope: "local" }); } catch {}
            setUser(null);
            setProfile(null);
            setProfileError(null);
          } else {
            setProfile(prof);
            setProfileError(null);
          }
        }
      } catch (e) {
        log("auth init error (degrading to anon)", e);
      } finally {
        clearTimeout(loadingSafety);
        setLoading(false);
      }

      const { data } = supabase.auth.onAuthStateChange(async (event, sess) => {
        log("onAuthStateChange", event, sess?.user?.email || "null");
        setUser(sess?.user || null);
        if (sess?.user) await loadProfile(sess.user.id);
        else { setProfile(null); setProfileError(null); }
      });
      unsub = () => data.subscription.unsubscribe();
    })();
    return () => { clearTimeout(loadingSafety); unsub(); };
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

  // Verify the one-time CODE the user typed (prefetch-proof login path).
  //
  // WHY a typed code instead of clicking the email link: the magic link is a
  // one-time token consumed by the FIRST GET. Email link-scanners / antivirus /
  // browser prefetch open the link before the user does, burning the token, so
  // the real click lands on "Email link is invalid or has expired" and the user
  // stays logged out (proven root cause, 2026-06-04). Critically, the link and
  // the 6–8 digit code share the SAME token — so a fallback code in the same
  // email would die with the link too. The email is therefore CODE-ONLY (no
  // link to prefetch); a typed code has no URL to consume, so it survives.
  //
  // type:'email' is the verifyOtp type for signInWithOtp-issued OTP tokens
  // (verified against the live API: works pre-consumption, fails once the
  // shared token is burned — exactly the behaviour we want).
  const verifyCode = async (email, code) => {
    if (!isSupabaseReady()) return { error: { message: "Supabase offline" } };
    const token = (code || "").replace(/\D/g, "");
    return supabase.auth.verifyOtp({ email, token, type: "email" });
  };

  const signOut = async () => {
    log("signOut: clearing session");
    // Robust sign-out — correct in three independent failure modes (normal /
    // gotrue wedged / a future supabase-js renaming its storage key), with no
    // fragile dependency as the PRIMARY mechanism. Context: "sign out does
    // nothing until I refresh + retry" came from the old code AWAITING gotrue's
    // signOut() unbounded — and gotrue can deadlock on a stuck token-refresh.

    // 1. Optimistic UI — reflect signed-out instantly, before any async work.
    setUser(null);
    setProfile(null);
    setProfileError(null);

    // 2. PRIMARY: let gotrue remove its OWN session token, whatever its internal
    //    storage key is now or after a future upgrade (format-proof — never
    //    guesses the key). scope:"local" = no server round-trip. The bounded auth
    //    lock (see supabase.js) makes this resolve fast instead of deadlocking;
    //    the timeout is a hard ceiling so the redirect can NEVER be blocked, even
    //    in a pathological case. Whichever settles first, we proceed.
    if (isSupabaseReady()) {
      try {
        await Promise.race([
          supabase.auth.signOut({ scope: "local" }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch (_) { /* fall through to the backstop + reload */ }
    }

    // 3. BACKSTOP for the (pathological) timeout case: if gotrue didn't finish,
    //    remove its session key by hand so the reload can't rehydrate it. Matches
    //    gotrue's default `sb-<ref>-auth-token`; harmless no-op if already gone.
    //    Secondary by design — step 2 is what normally clears the session.
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-") && k.includes("-auth-token")) localStorage.removeItem(k);
      }
    } catch (_) { /* private mode / no storage — reload still lands on anon */ }

    // 4. Hard reload to a clean anon home — always runs. Discards all in-memory
    //    state (cached queries, gotrue's session object), so no dangling
    //    logged-in artifact or onAuthStateChange race can survive.
    window.location.replace("/");
  };

  // DÔLEŽITÉ: fallback tier 'pending' (nie 'free'), nech anon/loading nemá free caps.
  const tier = profile?.tier || (user ? "pending" : "anon");

  return {
    user, profile, tier, loading, profileError,
    signIn, verifyCode, signOut,
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
