import { useEffect, useState, useCallback, useRef, createContext, useContext } from "react";
import { supabase, supabaseData, isSupabaseReady } from "./supabase";
import { createAuthStateHandler } from "./authStateHandler";
import { getSignedInUser } from "./authToken";
import { installErrorReporting } from "./errorReport";

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
//
// Read through supabaseData (the lock-free token store), never the AUTH client:
// a request on the auth client first awaits auth.getSession(), i.e. gotrue's lock,
// and this read runs right after auth events (see authStateHandler.js for the
// day that lock wedged the whole tab).
async function fetchProfileWithRetry(userId, tries = 3) {
  let last = { data: null, error: null };
  for (let i = 0; i < tries; i++) {
    last = await supabaseData.from("user_profiles").select("*").eq("id", userId).maybeSingle();
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

  // Several loads can overlap (an auth event, a tab focus, reloadProfile after a
  // save). Only the LATEST may write the result, or a slow older read could put a
  // stale tier back on screen after a newer one landed.
  const loadSeq = useRef(0);
  const loadProfile = useCallback(async (userId) => {
    if (!userId) { setProfile(null); return; }
    const seq = ++loadSeq.current;
    log("loadProfile start", userId);
    const { data, error } = await fetchProfileWithRetry(userId);
    if (seq !== loadSeq.current) return;
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

      // The callback runs INSIDE gotrue's auth lock and must return at once —
      // anything async is deferred past the lock. See authStateHandler.js: awaiting
      // the profile load here is what wedged every save on the site (2026-10-06).
      const { data } = supabase.auth.onAuthStateChange(createAuthStateHandler({
        setUser, setProfile, setProfileError, setLoading, loadProfile,
        hasProfile: () => Boolean(profileRef.current),
      }));
      unsub = () => data.subscription.unsubscribe();
    })();
    return () => { clearTimeout(loadingSafety); unsub(); };
  }, [loadProfile]);

  // Reload profile keď user vráti do tab-u
  useEffect(() => {
    if (!isSupabaseReady()) return;
    // Who is signed in comes from the lock-free token store, not getSession():
    // a focus must never wait on gotrue's lock (authStateHandler.js).
    const onFocus = () => {
      const u = getSignedInUser();
      if (u) loadProfile(u.id);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadProfile]);

  const signIn = async (email, { lang, trialIntentAt } = {}) => {
    if (!isSupabaseReady()) return { error: "Supabase offline" };
    return supabase.auth.signInWithOtp({
      email,
      options: {
        // Where the email's link lands, for any template that carries one. The
        // platform, not the marketing homepage — someone who has just signed up
        // wants the product, not the sales page. (The code-entry path in
        // LoginModal routes there too, so both ways in agree.)
        emailRedirectTo: window.location.origin + "/app",
        // The site's language at sign-up. Supabase stores `data` as the new
        // user's metadata ONLY when this request creates the account (an
        // existing user's sign-in ignores it), and the welcome e-mail reads it
        // to greet them in their language (api/webhooks/welcome-user.js).
        //
        // trial_intent_at: they clicked "Activate 7-day trial" before signing
        // up. Stored with the NEW account only, like lang, so the welcome
        // webhook can start the trial on the server — and say so in the
        // welcome e-mail — instead of the browser racing the e-mail.
        data: { ...(lang ? { lang } : {}), ...(trialIntentAt ? { trial_intent_at: trialIntentAt } : {}) },
      },
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

  // Start reporting runtime errors from signed-in browsers. Installed here
  // because this is the one place that always knows who is signed in, and the
  // reporter reads the id at report time rather than capturing it — so someone
  // signing in mid-session becomes covered without anything re-mounting.
  // The ref is written in an effect, not during render: React may render a
  // component more than once before committing, and a ref written in the render
  // body can be left holding a value from a render that was thrown away.
  const userRef = useRef(null);
  const userId = value?.user?.id || null;
  useEffect(() => { userRef.current = userId; }, [userId]);
  useEffect(() => { installErrorReporting(() => userRef.current); }, []);

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
