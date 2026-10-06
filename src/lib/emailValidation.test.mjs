/**
 * Personal e-mail providers — the form's list and the database's must be the
 * SAME list. The database decides (a trigger refuses the account); the form only
 * answers while the person types. When the two drifted, a domain the database
 * knew and the form did not let the person press "send code" and then hit a raw
 * "Database error saving new user"; the other way round, the form said "not
 * accepted" for an address the database would have taken.
 *
 * The SQL here is the migration that defines public.is_personal_email, so a
 * change to one list without the other fails this test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL_DOMAINS, PERSONAL_BRANDS, isPersonalEmail, validateBusinessEmail } from "./emailValidation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL = fs.readFileSync(path.join(ROOT, "supabase_migration_2026_10_personal_email_domains.sql"), "utf8");

test("the database has exactly the form's domains", () => {
  const arr = SQL.slice(SQL.indexOf("any (array["), SQL.indexOf("]) then"));
  const sqlDomains = new Set([...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...sqlDomains].sort(), [...PERSONAL_DOMAINS].sort());
});

test("the database has exactly the form's brands", () => {
  const m = SQL.match(/d ~ '\^\(([^)]+)\)/);
  assert.ok(m, "brand pattern not found in the migration");
  assert.deepEqual(m[1].split("|").sort(), [...PERSONAL_BRANDS].sort());
});

test("personal providers are caught, in any country", () => {
  for (const e of ["a@gmail.com", "a@googlemail.com", "a@yahoo.co.uk", "a@yahoo.com.br", "a@hotmail.de",
    "a@outlook.sk", "a@live.cz", "a@gmx.at", "a@icloud.com", "a@me.com", "a@proton.me",
    "a@azet.sk", "a@zoznam.sk", "a@seznam.cz", "a@post.cz", "a@yopmail.fr", "a@mailinator.com",
    "a@duck.com", "a@privaterelay.appleid.com", "A@Gmail.COM", "a@gmail.com "]) {
    assert.equal(isPersonalEmail(e), true, e);
  }
});

test("work addresses are not — including look-alikes", () => {
  for (const e of ["a@sympatia.sk", "a@residata.eu", "a@yahoo-partners.com", "a@gmail.company.com",
    "a@mail.company.sk", "a@live.example.com", "a@outlookgroup.sk", "a@iitdevelopment.sk"]) {
    assert.equal(isPersonalEmail(e), false, e);
  }
});

test("the form's message names the rule in the visitor's language", () => {
  assert.match(validateBusinessEmail("a@gmail.com", "sk"), /pracovn/);
  assert.match(validateBusinessEmail("a@gmail.com", "en"), /work email/);
  assert.equal(validateBusinessEmail("a@sympatia.sk", "sk"), null);
});
