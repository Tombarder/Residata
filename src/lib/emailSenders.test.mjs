/**
 * The From address of every customer email is a thing people notice and nobody
 * tests. These tests exist because the sender was changed on 2026-09-03 with no
 * coverage at all: one wrong default, or one caller forgetting to declare itself
 * conversational, and either a support reply goes out as noreply@ (the customer's
 * answer vanishes) or a machine blast goes out as info@.
 *
 * Two halves:
 *   1. the policy itself — a pure function, so it can just be called;
 *   2. the callers — read as source text, the way identity.test.mjs does, so a
 *      new email cannot quietly introduce a fourth sender.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveSender,
  DEFAULT_AUTOMATED_SENDER,
  DEFAULT_CONVERSATIONAL_SENDER,
} from "../../api/_lib/senders.js";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "api");

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}
const API_FILES = walk(API_DIR);
const read = (p) => readFileSync(p, "utf8");

// ── 1. the policy ──────────────────────────────────────────────────────────

test("the two senders are the mailboxes that actually exist on residata.eu", () => {
  assert.equal(DEFAULT_AUTOMATED_SENDER, "noreply@residata.eu");
  assert.equal(DEFAULT_CONVERSATIONAL_SENDER, "info@residata.eu");
});

test("tomas@ is never a machine sender — it is his personal address", () => {
  // Behavioural, not textual: senders.js *documents* tomas@ on purpose, so
  // grepping the file would only ever flag its own explanation.
  for (const conversational of [true, false]) {
    const { from, replyTo } = resolveSender({ conversational, env: {} });
    assert.ok(!from.startsWith("tomas@"), `tomas@ used as a From (conversational=${conversational})`);
    assert.ok(!String(replyTo || "").startsWith("tomas@"), "tomas@ used as a Reply-To");
  }
  assert.ok(!DEFAULT_AUTOMATED_SENDER.startsWith("tomas@"));
  assert.ok(!DEFAULT_CONVERSATIONAL_SENDER.startsWith("tomas@"));
});

test("automated mail comes from noreply@ but replies reach a monitored mailbox", () => {
  const { from, replyTo } = resolveSender({ env: {} });
  assert.equal(from, "noreply@residata.eu");
  assert.equal(replyTo, "info@residata.eu",
    "'noreply' is a convention — people reply anyway, and it must not vanish");
});

test("a human answering a customer sends from info@, not noreply@", () => {
  const { from } = resolveSender({ conversational: true, env: {} });
  assert.equal(from, "info@residata.eu");
});

test("an explicit replyTo always wins", () => {
  assert.equal(resolveSender({ replyTo: "x@y.z", env: {} }).replyTo, "x@y.z");
  assert.equal(
    resolveSender({ conversational: true, replyTo: "x@y.z", env: {} }).replyTo, "x@y.z");
});

test("the env escape hatch works but nothing depends on it", () => {
  const env = { MAIL_FROM: "a@b.c", MAIL_FROM_CONVERSATIONAL: "d@e.f" };
  assert.equal(resolveSender({ env }).from, "a@b.c");
  assert.equal(resolveSender({ conversational: true, env }).from, "d@e.f");
});

test("resolveSender never returns an empty From", () => {
  for (const conversational of [true, false]) {
    for (const env of [{}, { MAIL_FROM: "" }, { MAIL_FROM_CONVERSATIONAL: "" }]) {
      const { from } = resolveSender({ conversational, env });
      assert.ok(from && from.includes("@"), `empty From for ${JSON.stringify({ conversational, env })}`);
    }
  }
});

// ── 2. the callers ─────────────────────────────────────────────────────────

test("only feedback/reply.js declares itself conversational", () => {
  // senders.js documents the flag, so it is the policy, not a caller.
  const marked = API_FILES
    .filter((p) => !p.endsWith(join("_lib", "senders.js")))
    .filter((p) => /conversational:\s*true/.test(read(p)));
  assert.deepEqual(
    marked.map((p) => p.slice(API_DIR.length + 1)).sort(),
    ["feedback/reply.js"],
    "a human answering a customer is the only conversational send; if you added " +
    "another, say so here — and if this list SHRANK, support replies are now " +
    "going out as noreply@ and customers' answers are being lost",
  );
});

test("no API file hardcodes a residata.eu From outside the senders module", () => {
  const offenders = API_FILES
    .filter((p) => !p.endsWith(join("_lib", "senders.js")))
    .filter((p) => /(from|From)\s*[:=]\s*["'`][^"'`]*@residata\.eu/.test(read(p)))
    .map((p) => p.slice(API_DIR.length + 1));
  assert.deepEqual(offenders, [], "senders belong in api/_lib/senders.js only");
});

test("nobody sends as the founder's personal Gmail", () => {
  const offenders = API_FILES
    .filter((p) => /(from|From)\s*[:=]\s*["'`]tkamhal@gmail\.com["'`]/.test(read(p)))
    .map((p) => p.slice(API_DIR.length + 1));
  assert.deepEqual(offenders, [],
    "customer mail must come from a residata.eu mailbox, never a personal Gmail");
});

test("no caller passes a `from:` — the sender is not theirs to choose", () => {
  const offenders = API_FILES
    .filter((p) => !p.endsWith(join("_lib", "emails.js")))
    .filter((p) => /^\s*from:\s/m.test(read(p)))
    .map((p) => p.slice(API_DIR.length + 1));
  assert.deepEqual(offenders, [],
    "sendEmail ignores `from`, so passing one is dead code that reads as though " +
    "it works — exactly how tkamhal@gmail.com would creep back in as a sender");
});

test("every 'is email configured' gate knows the product runs on Resend", () => {
  // A gate testing GMAIL_APP_PASSWORD alone silently stops sending the day the
  // obsolete Gmail password is removed. feedback/submit.js's user receipt did.
  const offenders = [];
  for (const p of API_FILES) {
    for (const line of read(p).split("\n")) {
      if (!/\bGMAIL_APP_PASSWORD\b/.test(line)) continue;
      if (!/^\s*(if|return|\}|\s)*.*\bif\s*\(/.test(line)) continue;
      if (!/SMTP_PASS/.test(line)) offenders.push(`${p.slice(API_DIR.length + 1)}: ${line.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every send goes through sendEmail, so none can bypass the policy", () => {
  const offenders = API_FILES
    .filter((p) => !p.endsWith(join("_lib", "emails.js")))
    .filter((p) => /\.sendMail\s*\(|createTransport\s*\(/.test(read(p)))
    .map((p) => p.slice(API_DIR.length + 1));
  assert.deepEqual(offenders, [],
    "a direct nodemailer call would sidestep resolveSender entirely");
});
