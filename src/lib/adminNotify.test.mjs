// Boss 2026-10-07: "i want to receive an email every time a new user registers".
// The real handler (api/webhooks/admin-notify.js) runs here against a fake
// database and a fake mail server, so each promise is pinned:
//   · a finished sign-up → one e-mail with who, company, plan and a link to the person;
//   · a sign-up that stopped after the e-mail code → one "not finished" e-mail;
//   · never twice (each kind has its own stamp), never for a typo'd code, never with a
//     bad secret, and a failed send leaves no stamp so the safety net retries.

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const sent = [];
let smtpFails = false;
mock.module("nodemailer", {
  defaultExport: {
    createTransport: () => ({
      sendMail: async (m) => { if (smtpFails) throw new Error("smtp down"); sent.push(m); return { messageId: "m1" }; },
    }),
  },
});

const ID = "11111111-2222-4333-8444-555555555555";
let profile;
let authUser;
let patches;
let colleagues;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (body, headers = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Map(Object.entries(headers)) });
  if (u.includes("/auth/v1/admin/users/")) return json(authUser);
  if (u.includes("/rest/v1/user_profiles") && opts.method === "PATCH") { patches.push(JSON.parse(opts.body)); return { ok: true, status: 204, text: async () => "" }; }
  if (u.includes("email_domain=eq.")) return json(colleagues);
  if (u.includes("select=id&created_at=lte.")) return { ok: true, status: 206, json: async () => [], headers: new Map([["content-range", "0-0/42"]]) };
  if (u.includes(`/rest/v1/user_profiles?id=eq.${ID}`)) return json(profile ? [profile] : []);
  throw new Error(`unexpected fetch ${u}`);
};

process.env.WEBHOOK_SECRET = "s3cret";
process.env.SUPABASE_URL = "https://db.example";
process.env.SUPABASE_SECRET_KEY = "service";
process.env.SMTP_PASS = "x";
process.env.ADMIN_EMAIL = "boss@example.com";
process.env.WEB_URL = "https://residata.eu";

const { default: handler } = await import("../../api/webhooks/admin-notify.js");

function call(body, secret = "s3cret") {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
    };
    handler({ method: "POST", headers: { "x-webhook-secret": secret }, body }, res);
  });
}

beforeEach(() => {
  sent.length = 0;
  smtpFails = false;
  patches = [];
  colleagues = [{ email: "peter@firma.sk" }];
  profile = {
    id: ID, email: "jana@firma.sk", tier: "free", profile_completed: true,
    full_name: "Jana Nováková", company: "Firma s.r.o.", position: "CEO",
    created_at: "2026-10-07T08:00:00Z", admin_notified_at: null, unfinished_notified_at: null,
  };
  authUser = { id: ID, email_confirmed_at: "2026-10-07T07:59:00Z", user_metadata: { lang: "sk", trial_intent_at: null } };
});

test("a finished sign-up: one e-mail to Boss, saying who and which company, linking to the person", async () => {
  const r = await call({ user_id: ID });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "boss@example.com");
  assert.equal(sent[0].subject, "[Residata] New sign-up: Jana Nováková (Firma s.r.o.) — jana@firma.sk");
  assert.match(sent[0].html, new RegExp(`/app/admin\\?tab=users&amp;user=${ID}|/app/admin\\?tab=users&user=${ID}`));
  assert.match(sent[0].html, /Free — market overview/);
  assert.match(sent[0].html, /peter@firma\.sk/, "colleagues from the same company are named");
  assert.match(sent[0].html, /#42/);
  assert.match(sent[0].html, /Slovak/);
  assert.deepEqual(Object.keys(patches[0]), ["admin_notified_at"]);
});

test("the plan line says what is true: trial requested, or already running", async () => {
  authUser.user_metadata.trial_intent_at = new Date(Date.now() - 60_000).toISOString();
  await call({ user_id: ID });
  assert.match(sent[0].html, /7-day Premium trial<\/strong> requested at sign-up/);

  sent.length = 0; patches = [];
  profile.trial_started_at = new Date().toISOString();
  profile.trial_until = new Date(Date.now() + 7 * 86400000).toISOString();
  await call({ user_id: ID });
  assert.match(sent[0].html, /7-day Premium trial<\/strong> running until/);
});

test("never twice: a stamped profile is skipped", async () => {
  profile.admin_notified_at = "2026-10-07T08:00:02Z";
  const r = await call({ user_id: ID });
  assert.equal(r.body.skipped, "admin already notified");
  assert.equal(sent.length, 0);
});

test("a sign-up that stopped after the code: its own e-mail, its own stamp", async () => {
  profile.profile_completed = false;
  profile.tier = "pending";
  const done = await call({ user_id: ID });                     // the finished-kind waits
  assert.equal(done.body.skipped, "profile not completed yet");
  const r = await call({ user_id: ID, kind: "unfinished" });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "[Residata] Sign-up not finished: jana@firma.sk");
  assert.match(sent[0].html, /mailto:jana@firma\.sk/);
  assert.deepEqual(Object.keys(patches[0]), ["unfinished_notified_at"]);
});

test("not finished, but no confirmed code: not a sign-up, no e-mail", async () => {
  profile.profile_completed = false;
  authUser.email_confirmed_at = null;
  const r = await call({ user_id: ID, kind: "unfinished" });
  assert.equal(r.body.skipped, "e-mail not confirmed");
  assert.equal(sent.length, 0);
});

test("finished meanwhile: the unfinished e-mail is not sent", async () => {
  const r = await call({ user_id: ID, kind: "unfinished" });
  assert.match(r.body.skipped, /profile completed/);
  assert.equal(sent.length, 0);
});

test("a failed send leaves no stamp, so the safety net tries again", async () => {
  smtpFails = true;
  const r = await call({ user_id: ID });
  assert.equal(r.status, 500);
  assert.equal(patches.length, 0);
});

test("a wrong secret or a malformed id is refused before anything is read", async () => {
  assert.equal((await call({ user_id: ID }, "nope")).status, 401);
  assert.equal((await call({ user_id: "1 or 1=1" })).status, 400);
  assert.equal(sent.length, 0);
});
