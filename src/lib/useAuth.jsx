import { useEffect, useState, useCallback, useRef, createContext, useContext } from "react";
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

// Read the user's profile, RETRYING on a transient error (network blip / 500 / timeout).
// A single failed read leaves profile=null, which useCapabilities resolves to 'anon' — so a
// genuinely paid/admin user loses every paid capability and sees the "upgrade" blur, with no
// recovery while the tab stays focused ("logged-in page shows denied, hard refresh fixes it").
// Permission/RLS errors (42xxx / PGRST301) are permanent → not retried. maybeSingle() returns
// {data:null,error:null} for a genuinely-absent row, which the caller uses to detect a stale
// session — so we only retry on an actual error, never on a clean "no row".
async function fetchProfileWithRetry(userId, tries = 3) {
  let last = { data: null, error: null };
  for (let i = 0; i < tries; i++) {
    last = await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle();
    if (!last.error) return last;
    const code = String(last.error.code || "");
    if (code.startsWith("42") || code === "PGRST301") break; // permission/RLS — won't change
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  return last;
}

function useAuthInternal() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Latest profile, readable inside the once-created onAuthStateChange callback (which
  // otherwise closes over a stale `profile`). Used to decide whether a SIGNED_IN needs the
  // loading spinner (fresh login, no profile yet) vs a no-op re-emit (profile already loaded).
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    log("loadProfile start", userId);
    const { data, error } = await fetchProfileWithRetry(userId);
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
          const { data: prof, error: profErr } = await fetchProfileWithRetry(session.user.id);
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

      // ⚠️ This callback must NEVER `await` a supabase.auth.* call: gotrue invokes
      // it from INSIDE its own auth lock while emitting an event (e.g. SIGNED_OUT
      // during signOut), so awaiting another auth op here would self-deadlock the
      // lock until its 35s safety cap. loadProfile() only hits PostgREST (not the
      // auth endpoint / lock), so it's safe. Defer any future auth work with
      // setTimeout(fn, 0) to run it outside the lock.
      const { data } = supabase.auth.onAuthStateChange(async (event, sess) => {
        log("onAuthStateChange", event, sess?.user?.email || "null");
        setUser(sess?.user || null);
        if (sess?.user) {
          // Fresh in-tab login (SIGNED_IN with no profile yet): raise `loading` so consumers
          // show the auth spinner instead of briefly resolving the just-logged-in user to
          // anon/free while the profile fetches — the sub-second "wrong tier flash". We do
          // NOT raise it on TOKEN_REFRESHED / USER_UPDATED (they fire ~hourly and keep the
          // existing profile → flashing a spinner there would be worse). finally guarantees
          // loading can never get stuck on.
          const freshLogin = event === "SIGNED_IN" && !profileRef.current;
          if (freshLogin) setLoading(true);
          try { await loadProfile(sess.user.id); }
          finally { if (freshLogin) setLoading(false); }
        } else { setProfile(null); setProfileError(null); }
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
      // Where the email's link lands, for any template that carries one. The
      // platform, not the marketing homepage — someone who has just signed up
      // wants the product, not the sales page. (The code-entry path in
      // LoginModal routes there too, so both ways in agree.)
      options: { emailRedirectTo: window.location.origin + "/app" },
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
    //
    // Contract: this signs out THIS device (scope:"local"). On the fast path
    // gotrue also broadcasts SIGNED_OUT so other open tabs sign out live; on the
    // wedged path (timeout) they don't get the broadcast but re-sync to signed-out
    // on their next auth op / reload (the shared localStorage session is gone). We
    // deliberately do NOT force-revoke the user's sessions on their other devices.

    // 1. Optimistic UI — reflect signed-out instantly, before any async work.
    setUser(null);
    setProfile(null);
    setProfileError(null);

    // 2. Best-effort: let gotrue run its own local sign-out — it broadcasts
    //    SIGNED_OUT to other tabs and clears its key in whatever format it
    //    currently uses. The bounded auth lock (see supabase.js) keeps it from
    //    deadlocking; the 1500ms race is a hard ceiling so a wedged/slow network
    //    can NEVER block the redirect. We deliberately do NOT depend on this
    //    completing — step 3 is the deterministic guarantee — so a timeout here is
    //    fine (the awaited call would otherwise be 8s fetch + 35s lock worst-case).
    if (isSupabaseReady()) {
      try {
        await Promise.race([
          supabase.auth.signOut({ scope: "local" }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch (_) { /* fall through to the deterministic teardown + reload */ }
    }

    // 3. DETERMINISTIC teardown — the actual guarantee. Clear the WHOLE Supabase
    //    auth-client key family from localStorage (the session `sb-<ref>-auth-token`,
    //    its size-chunks `…auth-token.0/.1`, the PKCE code-verifier, etc.), not just
    //    the bare session key — under a slow network the race above times out before
    //    gotrue finishes its own storage write, so depending on it would leave stale
    //    keys behind. The `sb-` prefix is gotrue's and stable across the v2 line; the
    //    public read-only client uses a different key ("residata-public-noauth"), so
    //    this only ever clears the authed session, never public state.
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("sb-")) localStorage.removeItem(k);
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
