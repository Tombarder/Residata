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

  // ── Subscription windows ──────────────────────────────────
  // Two independent timestamp pairs gate paid-equivalent access:
  //   trial_until       — 7-day self-service / admin-granted trial
  //   paid_until        — actual paid subscription window
  //   paid_pause_started — admin-paused; suspends paid access
  //                        regardless of paid_until
  //
  // Effective tier is computed live from the timestamps, NEVER
  // mutated on the user_profiles.tier column. This means:
  //   · payment timing drives access without rewriting tier rows
  //   · admin can extend / pause / revoke just by editing dates
  //   · expired paid users SILENTLY drop back to free (UI
  //     promptly shows "expired — resubscribe" CTA)
  //   · trial users are time-boxed identically
  // See supabase_migration_2026_04_trial.sql + …_subscription.sql.
  const now = Date.now();
  const trialUntil   = profile?.trial_until        ? new Date(profile.trial_until).getTime()        : null;
  const paidUntil    = profile?.paid_until         ? new Date(profile.paid_until).getTime()         : null;
  const pausedAt     = profile?.paid_pause_started ? new Date(profile.paid_pause_started).getTime() : null;

  const trialActive = Boolean(trialUntil && trialUntil > now);
  // Paid is active when paid_until is in the future AND not paused
  // by admin. tier='paid' alone (legacy users without paid_until)
  // is still treated as active — back-compat for early manual paid
  // accounts that were flipped before the column existed.
  const paidPaused = Boolean(pausedAt);
  const paidWindowActive = Boolean(paidUntil && paidUntil > now);
  const paidLegacyActive = baseTier === "paid" && !paidUntil && !paidPaused;
  const paidActive = !paidPaused && (paidWindowActive || paidLegacyActive);

  // Effective tier resolution. admin > paid (by tier) > trial > base.
  let effectiveTier = baseTier;
  if (baseTier === "admin") {
    effectiveTier = "admin";
  } else if (baseTier === "paid" && paidActive) {
    effectiveTier = "paid";
  } else if (baseTier === "paid" && !paidActive) {
    // Paid window expired or paused — drop them to free until they
    // resubscribe. Their tier column stays 'paid' so admin can re-
    // extend without re-flipping; the UI just denies paid features.
    effectiveTier = "free";
  } else if (trialActive && (baseTier === "free" || baseTier === "pending")) {
    effectiveTier = "paid";
  }

  const caps = capsForTier(effectiveTier);
  const daysFrom = (ts) => ts ? Math.max(0, Math.ceil((ts - now) / 86400000)) : 0;
  const trialDaysLeft = trialActive ? daysFrom(trialUntil) : 0;
  const paidDaysLeft  = paidActive && paidWindowActive ? daysFrom(paidUntil) : null;

  return {
    can: (cap) => caps.has(cap),
    tier: effectiveTier,
    baseTier,           // raw profile.tier — used by Billing UI
    trialActive,
    trialDaysLeft,
    trialUntil,
    paidActive,
    paidPaused,
    paidDaysLeft,
    paidUntil,
    paidStartedAt: profile?.paid_started_at ? new Date(profile.paid_started_at).getTime() : null,
    paidWindowActive,
    loading,
    user,
    profile,
  };
}
