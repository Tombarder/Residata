/**
 * The admin Users panel's rules (lib/adminUsers.js): what a type change or a date
 * edit WRITES, and that what the admin sets is what the person then gets
 * (resolveAccess, the rule the site enforces).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  planProfileUpdate, planNewUser, accountStatus, statusCounts, readDateField,
  startOfDayIso, endOfDayIso, dayKey, parseDay, errorText,
} from "./adminUsers.js";
import { resolveAccess } from "./access.js";

// 2026-10-06 14:00 Bratislava (CEST, UTC+2) = 12:00 UTC
const NOW = Date.parse("2026-10-06T12:00:00Z");
const iso = (s) => new Date(s).toISOString();
const DAY = 86400000;
const gets = (row) => resolveAccess(row.tier, row, NOW).effectiveTier;
const apply = (row, body, opts = {}) => {
  const r = planProfileUpdate(row, body, { now: NOW, ...opts });
  if (r.error) return r;
  return { ...row, ...r.patch, _patch: r.patch };
};

// ── Bratislava days ──────────────────────────────────────────────────────

test("a picked day is a Bratislava day: from = its 00:00, to = its last ms (summer and winter)", () => {
  assert.equal(startOfDayIso("2026-10-06"), "2026-10-05T22:00:00.000Z");   // CEST
  assert.equal(endOfDayIso("2026-10-06"), "2026-10-06T21:59:59.999Z");
  assert.equal(startOfDayIso("2026-12-31"), "2026-12-30T23:00:00.000Z");   // CET
  assert.equal(endOfDayIso("2026-12-31"), "2026-12-31T22:59:59.999Z");
  // the night the clocks go back (25 Oct 2026) — still that whole day
  assert.equal(startOfDayIso("2026-10-25"), "2026-10-24T22:00:00.000Z");
  assert.equal(endOfDayIso("2026-10-25"), "2026-10-25T22:59:59.999Z");
  assert.equal(dayKey(endOfDayIso("2026-10-25")), "2026-10-25");
  assert.equal(dayKey(startOfDayIso("2026-03-29")), "2026-03-29");
});

test("only real calendar days in a sane range are dates", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "0002-10-06", "2026-1-5", "tomorrow", "2101-01-01"]) {
    assert.equal(parseDay(bad), null, bad);
    assert.equal(readDateField(bad, "start").ok, false, bad);
  }
  assert.deepEqual(readDateField(null, "end"), { ok: true, value: null });
  assert.deepEqual(readDateField("", "end"), { ok: true, value: null });
  assert.equal(readDateField("2026-11-06T14:03:00Z", "end").value, "2026-11-06T14:03:00.000Z");
});

// ── Changing the account type ───────────────────────────────────────────

test("Free → Premium starts a period today with no end, and the person gets Premium", () => {
  const row = { tier: "free", approved_at: iso("2026-09-01"), paid_started_at: null, paid_until: null };
  const out = apply(row, { tier: "paid" });
  assert.equal(out._patch.tier, "paid");
  assert.equal(out._patch.paid_started_at, new Date(NOW).toISOString());
  assert.equal(out.paid_until, null);
  assert.equal(gets(out), "paid");
  assert.equal(accountStatus(out, NOW).key, "premium");
});

test("→ Premium keeps a period that is still running (e.g. Stripe paid to next month)", () => {
  const row = { tier: "free", paid_started_at: iso("2026-09-15"), paid_until: iso("2026-11-15") };
  const out = apply(row, { tier: "paid" });
  assert.deepEqual(Object.keys(out._patch).sort(), ["approved_at", "tier"]);
  assert.equal(out.paid_until, row.paid_until);
});

test("→ Premium after an ended period starts a NEW one today", () => {
  const row = { tier: "free", approved_at: iso("2026-08-01"), paid_started_at: iso("2026-09-01"), paid_until: iso("2026-09-30") };
  const out = apply(row, { tier: "paid" });
  assert.equal(out._patch.paid_started_at, new Date(NOW).toISOString());
  assert.equal(out._patch.paid_until, null);
});

test("→ Premium lifts a pause left by the old Pause button", () => {
  const row = { tier: "free", paid_started_at: iso("2026-09-01"), paid_until: iso("2026-12-01"), paid_pause_started: iso("2026-10-01") };
  const out = apply(row, { tier: "paid" });
  assert.equal(out._patch.paid_pause_started, null);
  assert.equal(gets(out), "paid");
});

test("Premium → Free ends the premium NOW and keeps the period on record", () => {
  const row = { tier: "paid", approved_at: iso("2026-09-01"), paid_started_at: iso("2026-09-01"), paid_until: null };
  const out = apply(row, { tier: "free" });
  assert.equal(out._patch.paid_until, new Date(NOW).toISOString());
  assert.equal(out.paid_started_at, row.paid_started_at, "the start stays — the record of the period");
  assert.equal(gets(out), "free");
  assert.equal(accountStatus(out, NOW + 1).key, "free");
});

test("→ Free ends a running trial and a running paid window too — 'Free' must mean free", () => {
  const row = { tier: "free", approved_at: iso("2026-09-01"), trial_started_at: iso("2026-10-04"), trial_until: iso("2026-10-11") };
  // Picking the type the row already has changes nothing…
  assert.equal(planProfileUpdate(row, { tier: "free" }, { now: NOW }).error, "nothing_to_change");
  // …but from Premium with a trial also running, BOTH end.
  const paid = { ...row, tier: "paid", paid_started_at: iso("2026-09-01"), paid_until: iso("2026-12-31") };
  const out = apply(paid, { tier: "free" });
  assert.equal(out._patch.paid_until, new Date(NOW).toISOString());
  assert.equal(out._patch.trial_until, new Date(NOW).toISOString());
  assert.equal(resolveAccess(out.tier, out, NOW + 1).effectiveTier, "free");
});

test("→ No access ends premium too (the database gate does not exclude 'pending')", () => {
  const row = { tier: "paid", approved_at: iso("2026-09-01"), paid_started_at: iso("2026-09-01"), paid_until: iso("2027-01-01") };
  const out = apply(row, { tier: "pending" });
  assert.equal(out._patch.paid_until, new Date(NOW).toISOString());
  // what public.current_user_is_paid() computes, written out
  const dbPaid = (r, t) => r.tier === "admin" || (r.trial_until && Date.parse(r.trial_until) > t) ||
    (!r.paid_pause_started && ((r.paid_until && Date.parse(r.paid_until) > t) || (r.tier === "paid" && !r.paid_until)));
  assert.equal(Boolean(dbPaid(out, NOW + 1)), false);
  assert.equal(accountStatus({ ...out, profile_completed: true }, NOW).key, "blocked");
});

test("→ Admin touches no dates; approval is stamped once, never moved", () => {
  const row = { tier: "free", approved_at: iso("2026-09-01") };
  const out = apply(row, { tier: "admin" });
  assert.deepEqual(Object.keys(out._patch), ["tier"]);
  const fresh = apply({ tier: "pending", approved_at: null, profile_completed: false }, { tier: "free" });
  assert.equal(fresh._patch.approved_at, new Date(NOW).toISOString());
});

test("you cannot change your own type; a bad type is refused", () => {
  assert.equal(planProfileUpdate({ tier: "admin" }, { tier: "free" }, { now: NOW, isSelf: true }).error, "self_tier");
  assert.equal(planProfileUpdate({ tier: "free" }, { tier: "owner" }, { now: NOW }).error, "bad_tier");
});

// ── Editing the period by hand ──────────────────────────────────────────

test("extending 'Premium to' works, and lasts THROUGH the day shown", () => {
  const row = { tier: "paid", paid_started_at: iso("2026-09-01"), paid_until: iso("2026-10-01") };
  assert.equal(accountStatus(row, NOW).key, "expired");
  const out = apply(row, { paid_until: "2026-12-31" });
  assert.equal(out._patch.paid_until, "2026-12-31T22:59:59.999Z");
  assert.equal(gets(out), "paid");
  assert.equal(resolveAccess("paid", out, Date.parse("2026-12-31T22:30:00Z")).effectiveTier, "paid", "still Premium late on 31 Dec");
  assert.equal(resolveAccess("paid", out, Date.parse("2026-12-31T23:00:01Z")).effectiveTier, "free", "and not on 1 Jan");
});

test("clearing 'Premium to' = Premium with no end", () => {
  const row = { tier: "paid", paid_started_at: iso("2026-09-01"), paid_until: iso("2026-10-01") };
  const out = apply(row, { paid_until: null });
  assert.equal(out._patch.paid_until, null);
  assert.equal(gets(out), "paid");
});

test("'Premium to' in the past ends the access (an honest way to close a period)", () => {
  const row = { tier: "paid", paid_started_at: iso("2026-09-01"), paid_until: null };
  const out = apply(row, { paid_until: "2026-10-05" });
  assert.equal(gets(out), "free");
  assert.equal(accountStatus(out, NOW).key, "expired");
});

test("a start in the future is refused — access does not wait for it", () => {
  const row = { tier: "paid", paid_started_at: iso("2026-09-01"), paid_until: null };
  assert.equal(planProfileUpdate(row, { paid_started_at: "2026-10-07" }, { now: NOW }).error, "start_in_future");
  // today is fine, so is backdating
  assert.ok(planProfileUpdate(row, { paid_started_at: "2026-10-06" }, { now: NOW }).patch);
  assert.ok(planProfileUpdate(row, { paid_started_at: "2026-01-15" }, { now: NOW }).patch);
});

test("'to' before 'from' is refused, against the stored value too", () => {
  const row = { tier: "paid", paid_started_at: iso("2026-09-10"), paid_until: null };
  assert.equal(planProfileUpdate(row, { paid_until: "2026-09-09" }, { now: NOW }).error, "end_before_start");
  assert.equal(planProfileUpdate(row, { paid_started_at: "2026-09-01", paid_until: "2026-08-31" }, { now: NOW }).error, "end_before_start");
  // same day both ends is a one-day Premium, allowed
  assert.ok(planProfileUpdate(row, { paid_started_at: "2026-09-10", paid_until: "2026-09-10" }, { now: NOW }).patch);
});

test("dates only on a Premium account — but type + dates in one save is fine", () => {
  const row = { tier: "free", approved_at: iso("2026-09-01") };
  assert.equal(planProfileUpdate(row, { paid_until: "2026-12-31" }, { now: NOW }).error, "dates_need_premium");
  const out = apply(row, { tier: "paid", paid_started_at: "2026-10-01", paid_until: "2026-12-31" });
  assert.equal(out._patch.paid_started_at, "2026-09-30T22:00:00.000Z");
  assert.equal(out._patch.paid_until, "2026-12-31T22:59:59.999Z");
  assert.equal(gets(out), "paid");
});

test("garbage dates are refused, never stored", () => {
  const row = { tier: "paid", paid_started_at: iso("2026-09-01"), paid_until: null };
  for (const v of ["0002-12-31", "2026-02-31", 42, "soon"]) {
    assert.equal(planProfileUpdate(row, { paid_until: v }, { now: NOW }).error, "bad_date", String(v));
  }
});

test("a date edit lifts an old pause, so the period set is the access given", () => {
  const row = { tier: "paid", paid_started_at: iso("2026-09-01"), paid_until: iso("2026-12-01"), paid_pause_started: iso("2026-10-01") };
  assert.equal(gets(row), "free");
  const out = apply(row, { paid_until: "2027-01-31" });
  assert.equal(out._patch.paid_pause_started, null);
  assert.equal(gets(out), "paid");
});

test("re-saving the same values writes nothing", () => {
  const row = { tier: "paid", full_name: "Ján Novák", paid_started_at: "2026-09-30T22:00:00+00:00", paid_until: null };
  assert.equal(planProfileUpdate(row, { tier: "paid", paid_started_at: "2026-10-01", paid_until: null, full_name: " Ján  Novák " }, { now: NOW }).error, "nothing_to_change");
});

// ── Profile fields ──────────────────────────────────────────────────────

test("profile fields are cleaned; a name cannot be blanked; the note keeps its lines", () => {
  const row = { tier: "free", full_name: "Old", company: null };
  const out = apply(row, { full_name: "<b>Eva</b>  Malá", company: "=HYPERLINK(1)", linkedin_url: "javascript:alert(1)", phone: "+421 900 (123) abc", subscription_note: "line one\nline two<script>" });
  assert.equal(out._patch.full_name, "bEva/b Malá");
  assert.equal(out._patch.company, "HYPERLINK(1)");
  assert.equal(out._patch.linkedin_url, undefined, "an unsafe URL that was null stays null — no change written");
  assert.equal(out._patch.phone, "+421 900 (123)");
  assert.equal(out._patch.subscription_note, "line one\nline twoscript");
  assert.equal(planProfileUpdate(row, { full_name: "   " }, { now: NOW }).error, "name_required");
});

// ── Creating an account ─────────────────────────────────────────────────

test("a new account is complete and approved at once, and neither automatic e-mail fires", () => {
  const r = planNewUser({ email: "  Jana.Kova@Firma.SK ", full_name: "Jana Ková", company: "Firma", tier: "free" }, { now: NOW });
  assert.equal(r.email, "jana.kova@firma.sk");
  assert.equal(r.profile.tier, "free");
  assert.equal(r.profile.profile_completed, true);
  assert.ok(r.profile.approved_at && r.profile.admin_notified_at && r.profile.approval_notified_at);
  assert.equal(r.profile.paid_until, undefined);
  assert.equal(r.sendInvite, false);
  assert.equal(r.inviteLang, "sk");
});

test("a new Premium account: from today with no end by default, or the dates given", () => {
  const a = planNewUser({ email: "a@b.sk", full_name: "A", tier: "paid" }, { now: NOW });
  assert.equal(a.profile.paid_started_at, new Date(NOW).toISOString());
  assert.equal(a.profile.paid_until, null);
  assert.equal(resolveAccess("paid", a.profile, NOW).effectiveTier, "paid");
  const b = planNewUser({ email: "a@b.sk", full_name: "A", tier: "paid", paid_started_at: "2026-10-01", paid_until: "2027-03-31", send_invite: true, invite_lang: "en" }, { now: NOW });
  assert.equal(b.profile.paid_started_at, "2026-09-30T22:00:00.000Z");
  assert.equal(b.profile.paid_until, "2027-03-31T21:59:59.999Z");
  assert.equal(b.sendInvite, true);
  assert.equal(b.inviteLang, "en");
});

test("a new account refuses: no e-mail, no name, a bad type, dates without Premium, a future start", () => {
  const e = (body) => planNewUser(body, { now: NOW }).error;
  assert.equal(e({ email: "nope", full_name: "A" }), "email_invalid");
  assert.equal(e({ email: "a@b.sk", full_name: "  " }), "name_required");
  assert.equal(e({ email: "a@b.sk", full_name: "A", tier: "pending" }), "bad_tier");
  assert.equal(e({ email: "a@b.sk", full_name: "A", tier: "free", paid_until: "2026-12-31" }), "dates_need_premium");
  assert.equal(e({ email: "a@b.sk", full_name: "A", tier: "paid", paid_started_at: "2026-10-07" }), "start_in_future");
  assert.equal(e({ email: "a@b.sk", full_name: "A", tier: "paid", paid_started_at: "2026-10-01", paid_until: "2026-09-01" }), "end_before_start");
});

// ── What the panel shows ────────────────────────────────────────────────

test("status says what the person HAS, whatever the type column says", () => {
  const s = (row) => accountStatus(row, NOW).key;
  assert.equal(s({ tier: "admin" }), "admin");
  assert.equal(s({ tier: "pending", profile_completed: false }), "incomplete");
  assert.equal(s({ tier: "pending", profile_completed: true, paid_until: iso("2027-01-01") }), "blocked");
  assert.equal(s({ tier: "paid" }), "premium");                                   // legacy, no end
  assert.equal(s({ tier: "paid", paid_until: iso("2026-10-01") }), "expired");
  assert.equal(s({ tier: "free", trial_until: iso(NOW + 2 * DAY) }), "trial");
  assert.equal(s({ tier: "free", paid_until: iso("2026-09-01") }), "free");
  assert.equal(s({ tier: "paid", paid_until: iso("2027-01-01"), paid_pause_started: iso("2026-10-01") }), "paused");
  const c = statusCounts([{ tier: "admin" }, { tier: "paid" }, { tier: "free" }, { tier: "pending" }, { tier: "free", trial_until: iso(NOW + DAY) }], NOW);
  assert.deepEqual(c, { total: 5, premium: 1, trial: 1, free: 1, admin: 1, none: 1 });
});

test("server errors are said in words, in the panel's language", () => {
  assert.match(errorText({ error: "start_in_future" }, "sk"), /budúcnosti/);
  assert.match(errorText({ error: "start_in_future" }, "en"), /future/);
  assert.match(errorText({ error: "weird", message: "boom" }, "en"), /boom/);
  assert.match(errorText(null, "sk", 502), /502/);
});
