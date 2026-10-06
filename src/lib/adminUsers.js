/**
 * adminUsers — the rules behind the admin Users panel, in ONE place.
 *
 * Used by the server (api/admin/create-user.js, api/admin/set-subscription.js),
 * which is what actually writes, and by the panel (LivePages → LiveAdmin), which
 * shows the result. Pure: no React, no I/O — tested in node (adminUsers.test.mjs).
 *
 * THE MODEL (Boss, 2026-10-06: "from when to when they have premium … editable,
 * I change just the date and it works"):
 *
 *   · An account has a TYPE: free · paid ("Premium") · admin · pending ("No access").
 *   · A Premium account has a PERIOD: paid_started_at ("Premium from") and
 *     paid_until ("Premium to"); no end date = Premium with no end.
 *   · What the person actually gets is resolveAccess() (lib/access.js) — the same
 *     rule the site and public.current_user_is_paid() enforce. The rules below only
 *     make sure that what the admin SETS and what the person GETS never disagree:
 *
 *       → Premium      starts a period today with no end (unless one is still
 *                      running, which is kept), and lifts a pause.
 *       → Free / No access
 *                      ends whatever premium access is running, NOW — a paid
 *                      period, a legacy "paid with no end", a 7-day trial. Otherwise
 *                      "Free" in the panel would sit on a person who still reads the
 *                      paid data (dates drive access, the type alone does not), and
 *                      the database gate does not exclude 'pending', so "No access"
 *                      would not be no access. The ended period stays on the row as
 *                      a record ("Premium 1. 9. – 6. 10.").
 *       → Admin        nothing else; admin sees everything regardless of dates.
 *
 *     Dates are editable only on a Premium account: a date on a Free account would
 *     make it Premium in all but name. "From" cannot lie in the future — access is
 *     not gated on it (a scheduled start would read as Premium and not be one) —
 *     and "to" cannot precede "from".
 *
 *   · A day picked in the panel means a Bratislava calendar day: "from" = that
 *     day's 00:00, "to" = that day's 23:59:59.999 — premium lasts THROUGH the
 *     day shown, as anyone reading "Premium do 31. 12." would assume.
 *
 * The old one-click shortcuts (+7-day trial, restart trial, +30 days, pause) are
 * gone: with the period editable they were a second, less exact way to say the
 * same thing (Boss, 2026-10-06: remove them).
 */
import { resolveAccess } from "./access.js";
import { cleanText, cleanUrl, cleanPhone, cleanEmail } from "./sanitize.js";

export const TZ = "Europe/Bratislava";
export const ACCOUNT_TYPES = ["free", "paid", "admin", "pending"];
/** The types an admin can create an account with ("No access" is not a new account). */
export const CREATE_TYPES = ["free", "paid", "admin"];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

// ── Bratislava calendar days ↔ timestamps ─────────────────────────────────

/** Offset of `tz` from UTC at the instant `utcMs`, in ms (CET = +3 600 000). */
function tzOffsetMs(utcMs, tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  return asUtc - (utcMs - (((utcMs % 1000) + 1000) % 1000));
}

/** The UTC instant of a Bratislava wall-clock time (DST-safe). */
function zonedToUtcMs(y, mo, d, h, mi, s, ms, tz = TZ) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}

/** "YYYY-MM-DD" → [y, m, d] if it is a real calendar day in our range, else null. */
export function parseDay(s) {
  const m = typeof s === "string" ? DATE_RE.exec(s.trim()) : null;
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim) return null;
  return [y, mo, d];
}

/** The Bratislava calendar day of a timestamp, as "YYYY-MM-DD" (null for null). */
export function dayKey(ts, tz = TZ) {
  if (ts == null || ts === "") return null;
  const t = ts instanceof Date ? ts : new Date(ts);
  if (!Number.isFinite(t.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}

/** "YYYY-MM-DD" → ISO of that Bratislava day's first millisecond. */
export function startOfDayIso(day, tz = TZ) {
  const p = parseDay(day);
  return p ? new Date(zonedToUtcMs(p[0], p[1], p[2], 0, 0, 0, 0, tz)).toISOString() : null;
}

/** "YYYY-MM-DD" → ISO of that Bratislava day's last millisecond. */
export function endOfDayIso(day, tz = TZ) {
  const p = parseDay(day);
  return p ? new Date(zonedToUtcMs(p[0], p[1], p[2], 23, 59, 59, 999, tz)).toISOString() : null;
}

// ── Errors the server returns; the panel says them in words ───────────────

export const ERRORS = {
  bad_tier:            ["Neplatný typ účtu.", "Invalid account type."],
  self_tier:           ["Vlastný typ účtu meniť nemôžeš.", "You cannot change your own account type."],
  bad_date:            ["Neplatný dátum.", "Invalid date."],
  dates_need_premium:  ["Dátumy Premium sa dajú nastaviť len účtu typu Premium — najprv ho prepni na Premium.", "Premium dates can only be set on a Premium account — switch it to Premium first."],
  start_in_future:     ["„Premium od“ nemôže byť v budúcnosti — prístup sa podľa neho nezapína. Nastav dnešný alebo skorší deň.", "'Premium from' cannot be in the future — access does not wait for it. Use today or an earlier day."],
  end_before_start:    ["„Premium do“ je skôr ako „Premium od“.", "'Premium to' is earlier than 'Premium from'."],
  name_required:       ["Meno je povinné.", "Name is required."],
  email_invalid:       ["Neplatný e-mail.", "Invalid e-mail address."],
  email_exists:        ["Užívateľ s týmto e-mailom už existuje.", "A user with this e-mail already exists."],
  personal_email_setup:["Účet s osobným e-mailom (gmail, azet, …) sa zatiaľ nedá vytvoriť — databáza ešte nemá povolenie, ktoré ho pustí cez filter firemných e-mailov.", "An account with a personal e-mail (gmail, …) cannot be created yet — the database does not yet have the permission that lets it past the business-e-mail filter."],
  nothing_to_change:   ["Nič sa nezmenilo.", "Nothing to change."],
};

/** A server error object → one sentence in the panel's language. */
export function errorText(j, lang = "sk", status) {
  const pair = j && ERRORS[j.error];
  if (pair) return lang === "sk" ? pair[0] : pair[1];
  const detail = (j && (j.message || j.detail || j.error)) || (status ? `HTTP ${status}` : "");
  return (lang === "sk" ? "Nepodarilo sa: " : "Failed: ") + detail;
}

const fail = (error, message) => ({ error, message: message || (ERRORS[error] ? ERRORS[error][1] : error) });

// ── Dates in a request ─────────────────────────────────────────────────────

/**
 * A date field from a request: "YYYY-MM-DD" (a Bratislava day — what the panel
 * sends), a full ISO timestamp (kept exactly), or null. `edge` says which end of
 * a bare day it means. Returns { ok, value } — value null = "no date".
 */
export function readDateField(v, edge) {
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const s = v.trim();
  if (DATE_RE.test(s)) {
    const iso = edge === "end" ? endOfDayIso(s) : startOfDayIso(s);
    return iso ? { ok: true, value: iso } : { ok: false };
  }
  // Anything else must be a full ISO timestamp — never Date()'s loose guessing,
  // which reads "2026-1-5" or "5/1/2026" as some day it picks.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return { ok: false };
  const t = new Date(s);
  if (!Number.isFinite(t.getTime())) return { ok: false };
  const y = t.getUTCFullYear();
  if (y < MIN_YEAR || y > MAX_YEAR) return { ok: false };
  return { ok: true, value: t.toISOString() };
}

/** "From" may be any moment up to the end of TODAY (Bratislava) — never a later day. */
function startIsInFuture(iso, now) {
  return dayKey(iso) > dayKey(now);
}

// ── Profile fields an admin may set ────────────────────────────────────────

function cleanProfileFields(body) {
  const out = {};
  if ("full_name" in body) out.full_name = cleanText(body.full_name ?? "", { max: 120 }) || null;
  if ("company" in body)   out.company   = cleanText(body.company ?? "", { max: 160 }) || null;
  if ("position" in body)  out.position  = cleanText(body.position ?? "", { max: 120 }) || null;
  if ("phone" in body)     out.phone     = cleanPhone(body.phone ?? "") || null;
  if ("linkedin_url" in body) out.linkedin_url = cleanUrl(body.linkedin_url ?? "") || null;
  if ("subscription_note" in body) out.subscription_note = cleanNote(body.subscription_note);
  return out;
}

/** The internal note keeps its line breaks (it is read in a text box, not a cell). */
function cleanNote(v) {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const s = v.replace(/[<>]/g, "").replace(/[\x00-\x09\x0B-\x1F\x7F]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 500);
  return s || null;
}

// ── Changing an existing account ───────────────────────────────────────────

/**
 * What an admin's change does to a profile row.
 *
 * @param current  the row as it is now (needs tier, approved_at, paid_started_at,
 *                 paid_until, paid_pause_started, trial_until)
 * @param body     any of: tier, paid_started_at, paid_until, full_name, company,
 *                 position, phone, linkedin_url, subscription_note
 * @param opts     { now: Date|ms, isSelf: boolean }
 * @returns { patch } or { error, message }
 */
export function planProfileUpdate(current, body, { now = Date.now(), isSelf = false } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const nowIso = new Date(nowMs).toISOString();
  if (!current) return fail("not_found", "target user not found");
  const patch = cleanProfileFields(body || {});
  if ("full_name" in patch && !patch.full_name && current.full_name) return fail("name_required");

  const access = resolveAccess(current.tier || "pending", current, nowMs);

  // 1. Account type, with what it means for the premium period.
  if (body && "tier" in body) {
    if (!ACCOUNT_TYPES.includes(body.tier)) return fail("bad_tier");
    if (body.tier !== current.tier) {
      if (isSelf) return fail("self_tier");
      patch.tier = body.tier;
      if (body.tier !== "pending" && !current.approved_at) patch.approved_at = nowIso;

      if (body.tier === "paid") {
        // A period still running is kept (e.g. Stripe paid up to next month);
        // otherwise a new one starts today with no end.
        const running = current.paid_until && new Date(current.paid_until).getTime() > nowMs;
        if (!running) { patch.paid_started_at = nowIso; patch.paid_until = null; }
        if (current.paid_pause_started) patch.paid_pause_started = null;
      } else if (body.tier === "free" || body.tier === "pending") {
        // End every kind of premium access that is running — now.
        const windowRunning = current.paid_until && new Date(current.paid_until).getTime() > nowMs;
        const legacyRunning = current.tier === "paid" && !current.paid_until;
        if (windowRunning || legacyRunning) patch.paid_until = nowIso;
        if (access.trialActive) patch.trial_until = nowIso;
        if (current.paid_pause_started) patch.paid_pause_started = null;
      }
    }
  }

  // 2. The premium period, set by hand.
  const touchesStart = body && "paid_started_at" in body;
  const touchesEnd = body && "paid_until" in body;
  if (touchesStart || touchesEnd) {
    const nextTier = patch.tier ?? current.tier;
    if (nextTier !== "paid") return fail("dates_need_premium");
    if (touchesStart) {
      const r = readDateField(body.paid_started_at, "start");
      if (!r.ok) return fail("bad_date");
      if (r.value && startIsInFuture(r.value, nowMs)) return fail("start_in_future");
      patch.paid_started_at = r.value;
    }
    if (touchesEnd) {
      const r = readDateField(body.paid_until, "end");
      if (!r.ok) return fail("bad_date");
      patch.paid_until = r.value;
    }
    const start = "paid_started_at" in patch ? patch.paid_started_at : current.paid_started_at;
    const end = "paid_until" in patch ? patch.paid_until : current.paid_until;
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) return fail("end_before_start");
    // Setting the period by hand is the admin saying what access this person
    // has — a pause left over from the old Pause button would silently void it.
    if (current.paid_pause_started) patch.paid_pause_started = null;
  }

  // Drop fields that would not change anything (keeps the audit log honest).
  for (const k of Object.keys(patch)) {
    const before = current[k] ?? null;
    const after = patch[k] ?? null;
    const same = (before === after) ||
      (before && after && /_at$|_until$|_started$/.test(k) && new Date(before).getTime() === new Date(after).getTime());
    if (same) delete patch[k];
  }
  if (Object.keys(patch).length === 0) return fail("nothing_to_change");
  return { patch };
}

// ── Creating an account ────────────────────────────────────────────────────

/**
 * Validate an admin's "Add user" form and build the profile row it produces.
 * The account is complete and approved at once — the person signs in with their
 * e-mail (a one-time code, like everyone) and is straight in: no confirmation
 * mail, no profile form.
 *
 * @returns { email, profile, sendInvite, inviteLang } or { error, message }
 */
export function planNewUser(body, { now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const nowIso = new Date(nowMs).toISOString();
  const b = body || {};
  const email = cleanEmail(typeof b.email === "string" ? b.email : "");
  if (!email) return fail("email_invalid");
  const tier = b.tier || "free";
  if (!CREATE_TYPES.includes(tier)) return fail("bad_tier");

  const profile = cleanProfileFields({
    full_name: b.full_name ?? "", company: b.company ?? "", position: b.position ?? "",
    phone: b.phone ?? "", linkedin_url: b.linkedin_url ?? "", subscription_note: b.subscription_note ?? null,
  });
  if (!profile.full_name) return fail("name_required");

  profile.tier = tier;
  profile.approved_at = nowIso;
  // Complete from the start: the person never sees the "complete your profile"
  // form, and the trigger that reacts to completion finds both e-mails already
  // "sent" — so it sends neither the admin FYI (the admin made this account) nor
  // the generic "You're approved" (we send our own invitation, or none, below).
  // The daily safety net (notify_auth_events.py) keys on the same two columns.
  profile.profile_completed = true;
  profile.admin_notified_at = nowIso;
  profile.approval_notified_at = nowIso;

  if (tier === "paid") {
    const s = readDateField(b.paid_started_at ?? "", "start");
    const e = readDateField(b.paid_until ?? "", "end");
    if (!s.ok || !e.ok) return fail("bad_date");
    const start = s.value || nowIso;
    if (startIsInFuture(start, nowMs)) return fail("start_in_future");
    if (e.value && new Date(e.value).getTime() < new Date(start).getTime()) return fail("end_before_start");
    profile.paid_started_at = start;
    profile.paid_until = e.value;
  } else if (b.paid_started_at || b.paid_until) {
    return fail("dates_need_premium");
  }

  return {
    email,
    profile,
    sendInvite: b.send_invite === true,
    inviteLang: b.invite_lang === "en" ? "en" : "sk",
  };
}

// ── What the panel shows ───────────────────────────────────────────────────

/**
 * One status per account — what the person actually has today.
 * key: admin | premium | trial | free | expired | paused | blocked | incomplete
 */
export function accountStatus(u, now = Date.now()) {
  const tier = u?.tier || "pending";
  if (tier === "admin") return { key: "admin" };
  if (tier === "pending") return { key: u?.profile_completed ? "blocked" : "incomplete" };
  const a = resolveAccess(tier, u, now);
  if (a.paidPaused) return { key: "paused" };
  if (a.paidWindowActive || a.paidLegacyActive) return { key: "premium", until: a.paidUntil };
  if (a.trialActive) return { key: "trial", until: a.trialUntil };
  if (tier === "paid" && a.paidUntil) return { key: "expired", ended: a.paidUntil };
  return { key: "free" };
}

export const STATUS_LABELS = {
  admin:      ["Admin", "Admin"],
  premium:    ["Premium", "Premium"],
  trial:      ["Trial", "Trial"],
  free:       ["Free", "Free"],
  expired:    ["Premium skončilo", "Premium ended"],
  paused:     ["Pozastavené", "Paused"],
  blocked:    ["Bez prístupu", "No access"],
  incomplete: ["Registrácia nedokončená", "Sign-up not finished"],
};

export const TYPE_LABELS = {
  free:    ["Free", "Free"],
  paid:    ["Premium", "Premium"],
  admin:   ["Admin", "Admin"],
  pending: ["Bez prístupu", "No access"],
};

export const label = (map, key, lang) => (map[key] ? map[key][lang === "sk" ? 0 : 1] : key);

/** Counts for the strip above the table, by what people actually have. */
export function statusCounts(users, now = Date.now()) {
  const c = { total: 0, premium: 0, trial: 0, free: 0, admin: 0, none: 0 };
  for (const u of users || []) {
    c.total += 1;
    const k = accountStatus(u, now).key;
    if (k === "premium") c.premium += 1;
    else if (k === "trial") c.trial += 1;
    else if (k === "admin") c.admin += 1;
    else if (k === "blocked" || k === "incomplete") c.none += 1;
    else c.free += 1;           // free, expired, paused — reads the free product
  }
  return c;
}

/** Which filter chip a user falls under. */
export function filterKey(u, now = Date.now()) {
  const k = accountStatus(u, now).key;
  if (k === "premium" || k === "trial" || k === "admin") return k;
  if (k === "blocked" || k === "incomplete") return "none";
  return "free";
}
