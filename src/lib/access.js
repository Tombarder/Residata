/**
 * resolveAccess — what a profile ACTUALLY grants, from its tier and dates.
 *
 * The one rule, used by useCapabilities (the signed-in user's own access) and by
 * the admin panel (every user's access, next to their raw tier). Before
 * 2026-10-06 the admin panel showed only the raw `tier` column — and since dates
 * drive access, not the column, an admin could see "paid" on a user who had no
 * paid access (window lapsed, paused) or "free" on one who had it (a paid_until
 * window, a trial). Mirrored on the server by public.current_user_is_paid(); keep
 * the two in step.
 *
 * `baseTier` is the raw profile.tier as the caller resolved it ('anon' while
 * loading / signed out). Pure: no React, no I/O — testable in node.
 */
export function resolveAccess(baseTier, profile, now = Date.now()) {
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

  return { effectiveTier, trialActive, paidPaused, paidWindowActive, paidLegacyActive, paidActive, trialUntil, paidUntil, pausedAt };
}
