import { useEffect, useState } from "react";
import { supabase, isSupabaseReady } from "./supabase";

/**
 * Hook pre Supabase auth state.
 * Vráti: { user, profile, tier, loading, signIn, signOut }
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseReady()) {
      setLoading(false);
      return;
    }
    let unsub = () => {};
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      if (session?.user) await loadProfile(session.user.id);
      setLoading(false);

      const { data } = supabase.auth.onAuthStateChange(async (_event, sess) => {
        setUser(sess?.user || null);
        if (sess?.user) await loadProfile(sess.user.id);
        else setProfile(null);
      });
      unsub = () => data.subscription.unsubscribe();
    })();
    return () => unsub();
  }, []);

  async function loadProfile(userId) {
    const { data } = await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle();
    setProfile(data);
  }

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

  const tier = profile?.tier || (user ? "free" : "anon");
  const isPaid = tier === "paid" || tier === "admin";
  const isAdmin = tier === "admin";

  return { user, profile, tier, isPaid, isAdmin, loading, signIn, signOut, reloadProfile: () => user && loadProfile(user.id) };
}
