/**
 * The sign-in and confirmation emails are the FIRST thing a new customer ever
 * receives from us, and the only Residata page many of them will read before
 * deciding whether to trust the product.
 *
 * They do not live in this repo. They live in Supabase's auth config, and these
 * two files are the working copies someone pastes back in. On 2026-09-03 the
 * copies had drifted badly from what was actually deployed:
 *
 *   · they linked to `residata-gamma.vercel.app` — the Vercel preview origin.
 *     That is a DIFFERENT origin from residata.eu, and only residata.eu is in
 *     the API origin allow-list, so following that link logs the reader out;
 *   · the footer read "Bratislava residential market intelligence", months
 *     after the product covered dozens of towns across Slovakia AND Czechia.
 *     A Czech developer reading their own sign-in mail would have been told,
 *     by us, that we do not cover them.
 *
 * Nothing broke, which is the problem — the drift was only found by reading the
 * files. So the two claims that matter are asserted here, and the files were
 * re-synced from the live config rather than hand-edited, so the repo is a
 * record of what is deployed instead of a second opinion about it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase_email_templates");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".html"));

test("the templates are actually there — otherwise the rest asserts nothing", () => {
  assert.ok(FILES.length >= 2, `expected the auth email templates, found: ${FILES}`);
});

for (const file of FILES) {
  const html = readFileSync(join(DIR, file), "utf8");

  test(`${file} points at the live domain, not a preview origin`, () => {
    for (const origin of ["residata-gamma.vercel.app", "residata.vercel.app", "localhost"]) {
      assert.ok(!html.includes(origin),
        `${origin} is a different origin from residata.eu — a reader who follows it ` +
        `arrives logged out, because only residata.eu is in the API origin allow-list`);
    }
    assert.ok(html.includes("residata.eu"), "the template links nowhere we own");
  });

  test(`${file} does not tell the reader we only cover Bratislava`, () => {
    // The product covers dozens of towns across Slovakia and Czechia. Anything
    // that names one city as the scope is a claim that shrank while we weren't
    // looking — the same rot that had to be cleared out of the SEO copy.
    assert.ok(!/Bratislava/i.test(html),
      "a Czech customer reading their own sign-in email would be told we do not cover them");
  });

  test(`${file} still carries the code placeholder it exists to deliver`, () => {
    // A template that lost {{ .Token }} renders a beautiful email with no code
    // in it, and the customer simply cannot log in.
    assert.ok(/\{\{\s*\.Token\s*\}\}/.test(html),
      "the one-time code placeholder is gone — the email would arrive with no code");
  });
}
