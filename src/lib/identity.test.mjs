/**
 * Guards for the two "one source of truth" claims this codebase makes, because
 * both of them had already quietly stopped being true once:
 *
 *   1. COMPANY LEGAL IDENTITY — the Imprint, Terms, Privacy, footer and the
 *      structured data in index.html must all name the same company. They do
 *      that by reading src/lib/company.js, so the test's job is to prove that
 *      no surface has gone back to writing a company detail by hand.
 *
 *   2. PRICE FALLBACKS — the live price comes from public.pricing_config, but
 *      every reader needs a value for when that read fails. Those fallbacks had
 *      drifted to four different numbers, including one on the CHARGING path
 *      (€79.99 while the site showed €279.99). There is now one constant; this
 *      test proves nobody has added a second.
 *
 * These are structural checks against the source files, deliberately: a unit
 * test that only imported the modules would pass while a page hardcoded its own
 * copy right next to the import.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COMPANY, statutoryWebsiteData, registrationLine, isVatRegistered, vatNotice } from "./company.js";
import { FALLBACK_MONTHLY_CENTS, FALLBACK_ANCHOR_CENTS } from "./pricingDefaults.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf-8");

// Files that name the operator or render a price. If a new one is added, add it
// here — the point of the list is that it is exhaustive.
const SURFACES = [
  "src/pages/LegalPages.jsx",
  "src/App.jsx",
  "src/pages/Platform.jsx",
  "src/lib/marketingCopy.js",
  "src/lib/pricing.js",
  "src/pages/StatusPage.jsx",
  "src/pages/DataSourcesPage.jsx",
  "api/stripe.js",
  "api/_lib/emails.js",
  "vite.config.js",
  "scripts/generate-static-content.mjs",
];

test("§ 3a: the imprint data set is complete", () => {
  const labels = statutoryWebsiteData("sk").map((r) => r.label);
  // Business name, seat, legal form, IČO and the register entry are the five
  // the Commercial Code requires on the website.
  for (const required of ["Obchodné meno", "Sídlo", "Právna forma", "IČO", "Zápis v registri"]) {
    assert.ok(labels.includes(required), `imprint is missing the § 3a item: ${required}`);
  }
  assert.match(registrationLine("sk"), /oddiel: \w+, vložka č\. \S+/);
  assert.ok(COMPANY.legalName && COMPANY.ico && COMPANY.street && COMPANY.postalCode);
});

test("unissued identifiers stay empty and are never rendered as placeholders", () => {
  // DIČ and IČ DPH do not exist yet. If someone fills one in, this test should
  // be updated in the same change — deliberately, not by accident.
  // `iban` is deliberately absent from COMPANY — see the bank-account test below.
  for (const [field, value] of Object.entries({ dic: COMPANY.dic, icDph: COMPANY.icDph })) {
    assert.equal(typeof value, "string", `${field} must be a string`);
    assert.ok(!/[-–—?xX]{2,}|TBD|TODO|N\/A/.test(value), `${field} must be empty or a real value, never a placeholder`);
  }
  // A value that exists must actually look like the thing it claims to be.
  if (COMPANY.icDph) assert.match(COMPANY.icDph, /^SK\d{10}$/, "IČ DPH must be SK + 10 digits");
  if (COMPANY.dic) assert.match(COMPANY.dic, /^\d{10}$/, "DIČ must be 10 digits");
});

test("VAT wording follows the VAT number, and is never hand-written", () => {
  // While there is no VAT number the site must say so, in both languages.
  if (!isVatRegistered()) {
    assert.match(vatNotice("sk"), /Nie sme platiteľmi DPH/);
    assert.match(vatNotice("en"), /not registered for VAT/i);
  } else {
    assert.match(vatNotice("sk"), /DPH v sadzbe/);
  }
  // No page may write its own version of that sentence.
  for (const f of SURFACES) {
    const src = read(f);
    assert.ok(
      !/nie sme platite[ľl]mi DPH/i.test(src.replace(/vatNotice/g, "")),
      `${f} hand-writes the VAT sentence — use vatNotice() from lib/company`,
    );
  }
});

test("no surface hardcodes a company detail", () => {
  const banned = [
    [COMPANY.icoPlain, "IČO"],
    [COMPANY.ico, "IČO"],
    [COMPANY.registerInsert, "register insert number"],
  ];
  for (const f of SURFACES) {
    const src = read(f);
    for (const [needle, what] of banned) {
      assert.ok(!src.includes(needle), `${f} hardcodes the ${what} — import it from lib/company`);
    }
  }
});

test("there is exactly one price fallback", () => {
  const priceLiteral = /(?:^|[^\d])(?:7999|27999|34999|47999)(?![\d])/;
  const eurLiteral = /"€\s?\d{2,4}[.,]\d{2}"/;
  for (const f of SURFACES) {
    // Comments explain the history of these numbers on purpose, so strip them
    // first — block comments, and line comments including trailing ones (but
    // never the "//" inside a URL).
    const src = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!priceLiteral.test(src), `${f} hardcodes a price in cents — import it from lib/pricingDefaults`);
    assert.ok(!eurLiteral.test(src), `${f} hardcodes a formatted price — import it from lib/pricingDefaults`);
  }
  // And the one that exists is a sane pair.
  assert.ok(Number.isInteger(FALLBACK_MONTHLY_CENTS) && FALLBACK_MONTHLY_CENTS > 0);
  assert.ok(
    FALLBACK_ANCHOR_CENTS > FALLBACK_MONTHLY_CENTS,
    "the anchor (regular) price must be higher than the price it is discounting — " +
    "they were once identical, which struck through the same number",
  );
});

test("index.html reads the company from the build, not from a typed-in copy", () => {
  const html = read("index.html");
  assert.ok(html.includes("__COMPANY_LEGAL_NAME__"), "index.html must take legalName from the build token");
  assert.ok(html.includes("__COMPANY_ICO__"), "index.html must take the IČO from the build token");
  assert.ok(!html.includes(COMPANY.icoPlain), "index.html hardcodes the IČO");
});

test("Stripe checkout parameters obey the API's own constraints", () => {
  // A rejected parameter fails the WHOLE session, so a typo here is not a
  // degraded invoice — it is a checkout that does not open. This shipped once:
  // the custom field key was "company_id", and Stripe requires the key to be
  // alphanumeric, so every checkout would have failed.
  const src = read("api/stripe.js");

  for (const m of src.matchAll(/key:\s*"([^"]+)"/g)) {
    assert.match(m[1], /^[A-Za-z0-9]+$/,
      `Stripe custom_fields.key "${m[1]}" must be alphanumeric — no underscores, dashes or spaces`);
    assert.ok(m[1].length <= 200, `custom_fields.key "${m[1]}" exceeds 200 characters`);
  }
  for (const m of src.matchAll(/custom:\s*"([^"]+)"/g)) {
    assert.ok([...m[1]].length <= 50,
      `Stripe custom_fields.label.custom "${m[1]}" exceeds the documented 50-character limit`);
  }

  // The enhancements that make an invoice usable must be able to fall away
  // without taking checkout down with them.
  assert.match(src, /const DEGRADABLE = \[/,
    "checkout must degrade rather than fail when Stripe rejects an optional parameter");
  for (const p of ["adaptive_pricing", "custom_fields", "tax_id_collection", "customer_update"]) {
    assert.ok(new RegExp(`DEGRADABLE = \\[[^\\]]*"${p}"`, "s").test(src),
      `"${p}" is sent to Stripe but is not in DEGRADABLE — a version mismatch would break checkout`);
  }

  // The webhook must look for the same key checkout writes.
  const sent = [...src.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const k of sent) {
    assert.ok(src.includes(`f.key === "${k}"`),
      `checkout collects custom field "${k}" but nothing reads it back in the webhook`);
  }
});

test("the bank account never reaches the browser or the repository", () => {
  // This repo is public and src/ is bundled into the client. An IBAN in either
  // is downloadable by anyone and permanent in git history — which is exactly
  // what invoice-redirection fraud is built from. The account number lives in
  // public.app_secrets and is read server-side only.
  const IBAN = /\bSK\s?\d{2}[\s\d]{18,26}\b/;
  for (const f of ["src/lib/company.js", ...SURFACES]) {
    if (f.startsWith("api/")) continue;          // server-side is where it belongs
    assert.ok(!IBAN.test(read(f)),
      `${f} contains what looks like an IBAN — bank details are server-side only, from app_secrets`);
  }
  // And nothing may reintroduce the fields on the shared company object.
  const company = read("src/lib/company.js");
  for (const field of ["iban:", "bankName:", "swift:"]) {
    assert.ok(!new RegExp(`^\\s*${field}`, "m").test(company),
      `src/lib/company.js declares ${field} — bank details belong in app_secrets, not in a browser bundle`);
  }
});

test("checkout cannot be bought twice by an impatient customer", () => {
  // A double-click, two tabs, or an impatient retry must not create two live
  // subscriptions. The customer is charged twice, notices before we do, and
  // their first experience of paying us is asking for a refund. The sister
  // product has had both guards since its billing was written; this one did not.
  const src = read("api/stripe.js");

  assert.match(src, /already subscribed/i,
    "checkout must refuse to open for an account that already has an active subscription");

  // A guard is only real if the data it reads is actually fetched. This one was
  // written reading profile.paid_until and profile.stripe_subscription_id while
  // getUserFromRequest selected neither — so both were undefined and the guard
  // never fired. It looked like protection and was dead code.
  const lib = read("api/_lib/stripe.js");
  for (const field of (src.match(/profile\?\.(\w+)/g) || []).map((m) => m.split(".")[1])) {
    assert.ok(lib.includes(field),
      `handleCheckout reads profile.${field} but api/_lib/stripe.js does not select it — the check is dead code`);
  }

  // Stripe's Node SDK takes the idempotency key as a REQUEST OPTION, not a body
  // parameter. As a body parameter it is an unknown field that buys nothing —
  // and it looks correct, which is worse. (The Python SDK does accept it inline,
  // so this is exactly the mistake a port from the other product produces.)
  assert.ok(!/idempotency_key\s*:/.test(src),
    "idempotency_key as a body parameter does nothing in the Node SDK — pass { idempotencyKey } as the second argument");
  assert.match(src, /sessions\.create\([^)]*,\s*\{\s*idempotencyKey\s*\}/,
    "checkout must send an idempotency key as a request option");
});

test("every parameter we send to Stripe checkout exists in the SDK", () => {
  // A parameter Stripe does not recognise fails the WHOLE session — nobody can
  // subscribe. That happened today: custom_fields.key was "company_id" and the
  // underscore made Stripe reject the request outright. The SDK ships the
  // authoritative parameter list for the version we have installed, so there is
  // no reason to find out from a customer instead.
  const src = read("api/stripe.js");

  // Top-level keys of the `const params = { ... }` literal, plus later
  // `params.x = ...` assignments.
  const start = src.indexOf("const params = {");
  assert.ok(start > 0, "could not find the checkout params object");
  let depth = 0, i = start + "const params = ".length;
  for (;; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  const body = src.slice(start, i + 1);

  const keys = new Set();
  let d = 0;
  for (const line of body.split("\n")) {
    const m = line.trim().match(/^([a-z_][a-zA-Z0-9_]*)\s*:/);
    if (d === 1 && m) keys.add(m[1]);
    d += (line.match(/[{[]/g) || []).length - (line.match(/[}\]]/g) || []).length;
  }
  for (const m of src.matchAll(/params\.([a-z_][a-zA-Z0-9_]*)\s*=/g)) keys.add(m[1]);

  const dts = read("node_modules/stripe/esm/resources/Checkout/Sessions.d.ts");
  const from = dts.indexOf("interface SessionCreateParams");
  const to = dts.indexOf("\n    namespace SessionCreateParams", from);
  const valid = new Set([...dts.slice(from, to).matchAll(/^ {8}(\w+)\??:/gm)].map((m) => m[1]));

  for (const k of keys) {
    assert.ok(valid.has(k),
      `checkout sends "${k}", which is not a parameter of SessionCreateParams in the installed Stripe SDK — Stripe rejects the whole session, so nobody can subscribe`);
  }
  assert.ok(keys.size >= 10, "params extraction found suspiciously few keys — the test is not reading the object");
});
