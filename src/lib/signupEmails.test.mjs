/**
 * The three e-mails around a new account: Boss's "someone signed up" note, the
 * welcome a web sign-up gets, and the "your account is ready" an admin can send.
 *
 * What went wrong before 2026-10-06, and is pinned here:
 *   · the admin note printed what the person typed (name, company, LinkedIn)
 *     straight into HTML in Boss's inbox, and offered an "Upgrade to paid"
 *     button that could never work (it only acts on pending accounts);
 *   · the welcome was English only, said "You're approved 🎉 … as free" and
 *     never mentioned the 7-day trial;
 *   · re-sent after a Premium period ended, the invitation would have read
 *     "Premium until <a past date>".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminDigestHtml, adminDigestSubject, adminUnfinishedHtml, approvedUserHtml, welcomeSubject, accountCreatedHtml, inviteSubject } from "../../api/_lib/emails.js";

const WEB = "https://residata.eu";
const NOW = Date.parse("2026-10-06T12:00:00Z");
const nasty = {
  id: "u1", email: "eve@firma.sk", tier: "free",
  full_name: '<a href="https://evil.example">Click</a>', company: "<img src=x onerror=alert(1)>",
  position: "other", linkedin_url: 'javascript:alert(1)', phone: '"><script>x</script>',
  created_at: "2026-10-06T13:26:01Z",
};

test("admin note: everything the person typed is escaped, a non-http link is dropped", () => {
  const html = adminDigestHtml(nasty, WEB);
  assert.ok(!html.includes('<a href="https://evil.example">'), "name rendered as a live link");
  assert.ok(!html.includes("<img src=x"), "company rendered as an image tag");
  assert.ok(!html.includes("<script>"), "phone rendered as a script tag");
  assert.ok(!html.includes("javascript:"), "a javascript: LinkedIn became a link");
  assert.ok(html.includes("&lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt;"));
});

test("admin note: no dead one-click upgrade, one way to the admin panel", () => {
  const html = adminDigestHtml({ ...nasty, full_name: "Ján" }, WEB);
  assert.ok(!html.includes("approve-user"), "the approve-user link is back — it only acts on pending accounts");
  assert.ok(html.includes(`${WEB}/app/admin?tab=users`), "the button opens the Users tab");
  assert.ok(html.includes("2026-10-06 15:26"), "the sign-up time is Bratislava time");
});

test("admin notes: the newer fields are escaped too (colleagues, the unfinished note)", () => {
  const html = adminDigestHtml(nasty, WEB, { colleagues: ['<b onmouseover=x>@firma.sk'] });
  assert.ok(!html.includes("<b onmouseover"), "a colleague address rendered as markup");
  assert.ok(html.includes(`${WEB}/app/admin?tab=users&user=u1`), "the main button opens the person");
  const un = adminUnfinishedHtml({ ...nasty, email: 'x"><script>@firma.sk' }, WEB, {});
  assert.ok(!un.includes("<script>"), "the unfinished note rendered an address as a script");
  assert.match(adminDigestSubject({ email: "a@b.sk" }), /^\[Residata\] New sign-up: a@b\.sk$/);
});

test("welcome: Slovak by default, English when asked, name escaped", () => {
  const sk = approvedUserHtml({ ...nasty, full_name: "Ján <b>", trial_started_at: null }, WEB, "sk", NOW);
  assert.ok(sk.includes('lang="sk"') && sk.includes("Váš účet na Residata je aktívny"));
  assert.ok(sk.includes("Ján &lt;b&gt;") && !sk.includes("Ján <b>"));
  assert.equal(welcomeSubject("sk"), "Vitajte v Residata — váš účet je aktívny");
  const en = approvedUserHtml({ ...nasty, full_name: "Jane" }, WEB, "en", NOW);
  assert.ok(en.includes('lang="en"') && en.includes("Your Residata account is active"));
  assert.ok(!/approved 🎉/.test(sk + en), "the old 'You're approved 🎉' wording is back");
});

test("welcome: a free account is offered the trial; a running trial is announced with its end", () => {
  const offer = approvedUserHtml({ ...nasty, trial_started_at: null }, WEB, "sk", NOW);
  assert.ok(offer.includes("7 dní zadarmo"));
  const running = approvedUserHtml({ ...nasty, trial_started_at: "2026-10-06T11:00:00Z", trial_until: "2026-10-13T11:00:00Z" }, WEB, "sk", NOW);
  assert.ok(running.includes("13. októbra 2026"), "the trial's end date is missing");
  assert.ok(!running.includes("7 dní zadarmo — všetky"), "offers a trial that is already running");
  const used = approvedUserHtml({ ...nasty, trial_started_at: "2026-09-01T00:00:00Z", trial_until: "2026-09-08T00:00:00Z" }, WEB, "sk", NOW);
  assert.ok(!used.includes("Vyskúšajte Premium"), "offers a trial that was already used");
});

test("invitation: Premium with an end says the date; once ended it is no longer Premium", () => {
  const live = accountCreatedHtml({ email: "m@gmail.com", full_name: "Matej", tier: "paid", paid_until: "2026-11-03T22:59:59.999Z" }, WEB, "sk", NOW);
  assert.ok(live.includes("Premium") && live.includes("3. novembra 2026"));
  const ended = accountCreatedHtml({ email: "m@gmail.com", full_name: "Matej", tier: "paid", paid_until: "2026-10-01T21:59:59.999Z" }, WEB, "sk", NOW);
  assert.ok(!ended.includes("Premium</strong> do"), "an ended period is announced as Premium");
  assert.ok(ended.includes("bezplatný prístup"));
  assert.equal(inviteSubject("en"), "Your Residata account is ready");
});
