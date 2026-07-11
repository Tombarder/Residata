import { useAuth } from "./useAuth";
import { capsForTier } from "./capabilities";
import { daysUntil } from "./dates";

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

  // Effective tier resolution. Order of precedence:
  //   1. admin (immutable)
  //   2. paid_pause_started → drop to free regardless of paid_until
  //      (so a paused paid user really loses access)
  //   3. paid_until in future → paid (regardless of base tier — admin
  //      can grant paid time to a free user via paid_until without
  //      flipping tier; the access works)
  //   4. base tier 'paid' WITHOUT paid_until → legacy paid (back-
  //      compat; we never auto-flip these to free)
  //   5. trial_until in future → paid (only for free / pending base)
  //   6. else → base tier
  // tier column is NEVER mutated here — it stays as the audit /
  // billing label, dates drive the actual access.
  let effectiveTier;
  if (baseTier === "admin") {
    effectiveTier = "admin";
  } else if (baseTier === "pending") {
    // F-113: defense-in-depth. Pending users are awaiting admin approval
    // and must not have data access regardless of trial_until / paid_until
    // state. Data-state slop (admin granting trial to a still-pending
    // user, or a previously-trial user being re-flipped to pending)
    // would otherwise be silently promoted to paid caps via the
    // trial_until branch below. Pending stays pending until admin moves
    // them.
    effectiveTier = "pending";
  } else if (paidPaused) {
    // Paused — even if base is paid and window is in future, no access.
    effectiveTier = baseTier === "paid" ? "free" : baseTier;
  } else if (paidWindowActive) {
    // Explicit paid window in future wins regardless of base tier.
    // Lets admin grant paid time to a free user via /api/admin/set-
    // subscription without first flipping tier='paid' (cleaner audit).
    effectiveTier = "paid";
  } else if (trialActive) {
    // Trial active wins over expired paid (let the user keep paid
    // access during the gift window) AND over base free/pending.
    effectiveTier = "paid";
  } else if (baseTier === "paid" && paidUntil && paidUntil <= now) {
    // Paid window expired AND no trial — drop to free silently.
    // tier='paid' stays so admin can re-extend without re-flipping;
    // UI shows the amber "Subscription expired — Resubscribe" card.
    effectiveTier = "free";
  } else if (baseTier === "paid") {
    // Legacy paid (tier='paid', no paid_until set yet) — keep paid.
    effectiveTier = "paid";
  } else {
    effectiveTier = baseTier;
  }

  // ── Real-paid vs trial-"paid" split ───────────────────────
  // effectiveTier collapses both real subscribers and 7-day trials to "paid".
  // Export is for REAL paying customers only (Boss 2026-07-01) — the whole
  // dataset is too valuable to hand a trial user. So `export_data` is NOT in any
  // static tier set; it's granted here only when the user is admin or genuinely
  // real-paid. Mirrors public.current_user_is_real_paid() in the DB (the true gate).
  const isAdmin      = effectiveTier === "admin";
  const isRealPaid   = effectiveTier === "paid" && paidActive;        // real subscription / legacy paid
  const isTrialPaid  = effectiveTier === "paid" && !paidActive && trialActive; // trial-only "paid"
  const canExport    = isAdmin || isRealPaid;

  const caps = new Set(capsForTier(effectiveTier));
  if (canExport) caps.add("export_data");
  else caps.delete("export_data");   // belt-and-suspenders — trial/free never export

  // Days left = whole CALENDAR days until the target date (shared daysUntil so
  // this hook, the admin panel and the banners all show the SAME number, which
  // matches the displayed end date). See src/lib/dates.js.
  const trialDaysLeft = trialActive ? daysUntil(trialUntil) : 0;
  const paidDaysLeft  = paidActive && paidWindowActive ? daysUntil(paidUntil) : null;

  // ── Trial-lifecycle flags — ONE source of truth for the whole app ─────────
  // Before this, six surfaces (marketing banner, marketing popup, dashboard
  // banner, both App.jsx CTA handlers, the Billing card) each recomputed
  // "is this user eligible for the trial?" slightly differently — some on
  // baseTier, some on effectiveTier, some forgetting trial_started_at. That
  // drift is exactly why the trial UI felt "scattered": the same user could
  // see the offer on one surface and not another. These derived flags below
  // are THE definition; every surface must read them, never re-derive.
  //
  //   trialConsumed — the trial was ever started (active OR long expired).
  //   trialExpired  — started but the window has closed.
  //   canStartTrial — a LOGGED-IN user who can activate right now: effective
  //                   tier is plain 'free', no trial running, none ever used.
  //                   Excludes anon (no account yet), pending (awaiting
  //                   approval), admin-granted-paid (effTier='paid'), paid,
  //                   admin — all by construction.
  //   showTrialOffer — whether ANY trial-promo surface should appear:
  //                   anon visitors (convert them) OR a logged-in free user
  //                   who can still start it. This is the single predicate the
  //                   banner + popup + dashboard offer all gate on.
  const trialConsumed = Boolean(profile?.trial_started_at);
  const trialExpired  = trialConsumed && !trialActive;
  // Anchor eligibility on the RAW billing label (baseTier), not the derived
  // effectiveTier: an EXPIRED-paid (paid_until in the past) or ADMIN-PAUSED paid
  // account both collapse to effectiveTier==="free", so keying only on effective
  // offered lapsed customers the one-time trial — a revenue leak, and for paused
  // users activating it burned their lifetime trial for ZERO access (the paused
  // branch resolves before trialActive). baseTier==="free" excludes every
  // paid-lineage account; keeping effectiveTier==="free" still excludes a free
  // user who was admin-granted a paid_until window.
  const canStartTrial = baseTier === "free" && effectiveTier === "free" && !trialActive && !trialConsumed;
  const showTrialOffer = user ? canStartTrial : true;

  return {
    can: (cap) => caps.has(cap),
    tier: effectiveTier,
    baseTier,           // raw profile.tier — used by Billing UI
    trialActive,
    trialConsumed,
    trialExpired,
    canStartTrial,
    showTrialOffer,
    trialDaysLeft,
    trialUntil,
    isRealPaid,          // genuinely paying (admin-granted paid_until / legacy paid) — gates export
    isTrialPaid,         // "paid" only via the 7-day trial — full access EXCEPT export
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
