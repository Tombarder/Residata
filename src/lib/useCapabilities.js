import { useAuth } from "./useAuth";
import { capsForTier } from "./capabilities";

/**
 * useCapabilities — single source of truth pre "čo user môže".
 *
 * Vracia:
 *   - can(capability) → boolean
 *   - tier: string — zadefinovaný tier ('anon' / 'pending' / 'free' / 'paid' / 'admin')
 *   - loading: boolean — kým auth načítava profil, zaobchádzaj ako s anon
 *                        ALE pri konkrétnych guard-ov pridaj vlastný loading handler.
 *
 * NEVOLAJ useAuth() priamo pre check tier-u — vždy používaj can().
 */
export function useCapabilities() {
  const { user, profile, loading } = useAuth();

  // Kým auth načítava → tier neistý. Pre public content UI to stačí (view_ticker
  // je v anon capabilities tak aj anon vidí). Pre gated veci komponent checkne
  // `loading` a ukáže spinner namiesto gate-u.
  let tier = "anon";
  if (!loading && user) {
    tier = profile?.tier || "anon";  // ak profile zlyhal → fallback
  }

  const caps = capsForTier(tier);
  return {
    can: (cap) => caps.has(cap),
    tier,
    loading,
    user,
    profile,
  };
}
