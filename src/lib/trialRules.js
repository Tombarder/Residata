/**
 * The 7-day trial — who may start it, and the one write that starts it.
 *
 * Two places start a trial: POST /api/trial/start (the person clicks) and the
 * welcome webhook (api/webhooks/welcome-user.js), which honours a trial the
 * person ASKED FOR while signing up. Until 2026-10-06 only the browser could
 * redeem that request, after the profile was saved — the welcome e-mail went out
 * at the same moment and usually read the row first, so a person who had just
 * activated their trial was mailed "you can try Premium for 7 days". One rule
 * here, used by both.
 */
export const TRIAL_DAYS = 7;

/** A trial asked for at sign-up is honoured for this long. */
export const TRIAL_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/** A second "start" within this window of the first is the same request
 *  (the server started it on the person's behalf, or a second tab) — success. */
export const TRIAL_SAME_REQUEST_MS = 15 * 60 * 1000;

/**
 * Why this profile cannot start a trial now, or null when it can.
 * @returns null | { status, error }
 */
export function trialRefusal(prof, now = Date.now()) {
  if (!prof) return { status: 404, error: "profile not found" };
  // Not before sign-up is finished: a pending account has no access, and the
  // database gate would still count the week (see api/trial/start.js).
  if (prof.tier === "pending" || !prof.profile_completed) return { status: 403, error: "profile_incomplete" };
  if (prof.tier === "paid" || prof.tier === "admin") return { status: 409, error: "already on a paid tier" };
  if (prof.paid_until && new Date(prof.paid_until).getTime() > now) return { status: 409, error: "already on a paid tier" };
  if (prof.trial_started_at) return { status: 409, error: "trial already used" };
  return null;
}

/** Was this trial started moments ago, and is it running? (see TRIAL_SAME_REQUEST_MS) */
export function trialJustStarted(prof, now = Date.now()) {
  const started = prof?.trial_started_at ? new Date(prof.trial_started_at).getTime() : null;
  const until = prof?.trial_until ? new Date(prof.trial_until).getTime() : null;
  return Boolean(started && until && until > now && now - started < TRIAL_SAME_REQUEST_MS);
}

/** A sign-up's "I want the trial" (user_metadata.trial_intent_at) still valid? */
export function trialIntentValid(intentAt, now = Date.now()) {
  const t = intentAt ? new Date(intentAt).getTime() : NaN;
  return Number.isFinite(t) && t <= now + 60_000 && now - t < TRIAL_INTENT_TTL_MS;
}

/**
 * Start the trial on one row with the service-role client — ATOMICALLY: only
 * while trial_started_at is still empty, so two requests at once (the welcome
 * webhook and the browser, or two tabs) can never both write. Returns the row
 * as written, or null when someone else got there first.
 */
export async function startTrialRow(admin, userId, now = Date.now()) {
  const start = new Date(now);
  const end = new Date(now + TRIAL_DAYS * 86400 * 1000);
  const { data, error } = await admin
    .from("user_profiles")
    .update({ trial_started_at: start.toISOString(), trial_until: end.toISOString() })
    .eq("id", userId)
    .is("trial_started_at", null)
    .select("*");
  if (error) throw new Error(`trial write failed: ${error.message}`);
  return data?.[0] || null;
}
