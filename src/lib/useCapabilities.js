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
  let baseTier = "anon";
  if (!loading && user) {
    baseTier = profile?.tier || "anon";
  }

  // 7-day free trial — if the user's trial is still active, promote
  // them to paid capabilities for the remainder. Stored on
  // user_profiles.trial_until. When the timestamp passes, they
  // silently fall back to their base tier. We never auto-flip
  // profile.tier — payment should drive tier, trial is a separate
  // state. See supabase_migration_2026_04_trial.sql.
  const trialUntil = profile?.trial_until ? new Date(profile.trial_until).getTime() : null;
  const trialActive = Boolean(trialUntil && trialUntil > Date.now());
  const effectiveTier = trialActive && (baseTier === "free" || baseTier === "pending")
    ? "paid"
    : baseTier;

  const caps = capsForTier(effectiveTier);
  const trialDaysLeft = trialActive
    ? Math.max(0, Math.ceil((trialUntil - Date.now()) / 86400000))
    : 0;

  return {
    can: (cap) => caps.has(cap),
    tier: effectiveTier,
    baseTier,          // raw profile.tier — used by Billing UI to show "you're on free, trial gives you paid caps"
    trialActive,
    trialDaysLeft,
    trialUntil,
    loading,
    user,
    profile,
  };
}
