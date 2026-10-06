/**
 * The app's ONE onAuthStateChange callback — and why it must return at once.
 *
 * 🔴 FOUND 2026-10-06. Boss chose "paid" for a new user in the admin panel and
 * nothing happened: no error, no change, and the server logs show not a single
 * request left his browser. Reproduced with the real @supabase/auth-js 2.106.2:
 *
 *   gotrue calls every onAuthStateChange callback from INSIDE its auth lock and
 *   AWAITS it (TOKEN_REFRESHED from a token refresh, SIGNED_IN, …). Our callback
 *   awaited loadProfile(), which ran `supabase.from("user_profiles")` on the AUTH
 *   client — and every request on that client first calls auth.getSession(),
 *   which sees the lock held (gotrue's `lockAcquired`) and queues behind the very
 *   operation that is waiting for our callback. A circle: the refresh waits for
 *   the callback, the callback waits for the refresh.
 *
 * That queue sits inside gotrue, beneath our self-healing lock in authResilience
 * (which only bounds `this.lock`), so its 35-second cap never applies: the auth
 * client stays wedged until the page is reloaded. From then on EVERY call on it
 * — the admin tier change, saving a profile, publishing an article, a dashboard
 * layout, a map area — waits forever and sends nothing. A token refresh happens
 * about once an hour on any open tab, and on every return to a tab whose token
 * has expired, so this was not rare: it was every long session.
 * (useAuth carried a comment saying loadProfile "only hits PostgREST, not the
 * lock" — it did hit the lock, through getSession().)
 *
 * The cure, the one Supabase documents: the callback does only synchronous work
 * and DEFERS anything asynchronous to a later task, which runs after gotrue has
 * released its lock. This returns undefined, never a promise.
 *
 * Proven by src/lib/authStateHandler.test.mjs against the real library: with the
 * old shape a write after a token refresh never settles; with this one it does.
 */
export function createAuthStateHandler({
  setUser,
  setProfile,
  setProfileError,
  setLoading,
  loadProfile,
  hasProfile,
  defer = (fn) => setTimeout(fn, 0),
}) {
  return (event, session) => {
    setUser(session?.user || null);
    if (!session?.user) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    // Fresh in-tab login (SIGNED_IN with no profile yet): raise `loading` so
    // consumers show the auth spinner instead of briefly resolving the
    // just-logged-in user to anon/free while the profile fetches. Not on
    // TOKEN_REFRESHED / USER_UPDATED — they fire ~hourly and keep the profile.
    const freshLogin = event === "SIGNED_IN" && !hasProfile();
    if (freshLogin) setLoading(true);
    const userId = session.user.id;
    defer(() => {
      Promise.resolve()
        .then(() => loadProfile(userId))
        .catch(() => {})
        .finally(() => { if (freshLogin) setLoading(false); });
    });
  };
}
