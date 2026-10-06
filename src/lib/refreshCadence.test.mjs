// How often the market is read is a SETTING (admin → Kontrola dát → Zber dát),
// so no public sentence may type it. On 2026-10-05 it moved to every four days
// and some thirty sentences went on saying "refreshed daily". The copy now
// carries __EVERY__ / __EVERY_CAP__ (or calls everyPhrase) — see
// ./refreshCadence.js. This test is structural: a source line that types a
// daily claim fails unless the file is listed below WITH THE REASON it is not
// a claim about how often the market is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { collectionEveryDays, everyPhrase, EveryPhrase, fillEvery } from "./refreshCadence.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("the interval in words, both languages, every count", () => {
  const at = (n) => ({ scrape_every_days: n });
  assert.equal(everyPhrase("en", at(1)), "every day");
  assert.equal(everyPhrase("en", at(4)), "every 4 days");
  assert.equal(everyPhrase("sk", at(1)), "každý deň");
  assert.equal(everyPhrase("sk", at(3)), "každé 3 dni");
  assert.equal(everyPhrase("sk", at(7)), "každých 7 dní");
  assert.equal(EveryPhrase("sk", at(4)), "Každé 4 dni");
});

test("no interval it cannot see — the fallback carries no number", () => {
  for (const s of [{}, { scrape_every_days: 0 }, { scrape_every_days: 31 }, { scrape_every_days: 2.5 }, { scrape_every_days: null }]) {
    assert.equal(collectionEveryDays(s), null);
  }
  assert.equal(everyPhrase("en", {}), "regularly");
  assert.equal(everyPhrase("sk", {}), "pravidelne");
});

test("tokens are filled through strings, arrays and objects", () => {
  const copy = { a: "refreshed __EVERY__", b: [["__EVERY_CAP__.", "x"]], n: 3, t: true };
  assert.deepEqual(fillEvery(copy, "en", { scrape_every_days: 4 }),
    { a: "refreshed every 4 days", b: [["Every 4 days.", "x"]], n: 3, t: true });
});

// A daily claim, typed. The forms that shipped: "refreshed daily", "updated
// daily", "Daily refresh", "Daily-refreshed", "re-scraped every day", "Daily
// snapshot", "aktualizovaný/é každý deň", "aktualizované denne", "Denne
// aktualizované", "obnovovaný každý deň", "obnovujú … každý deň", and the bare
// stat "Denne"/"Daily".
const TYPED = /refreshe[sd] daily|updated daily|daily refresh|daily-(refreshed|updated)|re-scraped every day|daily snapshot|aktualizovan\w* (každý deň|denne)|denne aktualizovan|obnovovan\w* každý deň|obnovujú[^\n]{0,60}každý deň|"Denne"|"Daily"/i;

const NOT_A_CLAIM_ABOUT_THE_MARKET = {
  "src/pages/HeroVariants.jsx": "/hero-lab: a hidden design lab (robots.txt Disallow, not in the nav), sketches of hero variants",
  "src/components/ScrapeCadenceEditor.jsx": "the admin control that SETS the interval; its button labels name the choices",
};

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "content", "analyzy", "dist"].includes(name)) continue;
      out.push(...files(p));
    } else if (/\.(js|jsx|mjs|html)$/.test(name) && !/\.test\.mjs$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

test("no source types how often the market is read", () => {
  const candidates = [
    ...files(join(ROOT, "src")),
    join(ROOT, "index.html"),
    join(ROOT, "scripts", "generate-static-content.mjs"),
  ];
  const bad = [];
  for (const f of candidates) {
    const rel = relative(ROOT, f);
    if (NOT_A_CLAIM_ABOUT_THE_MARKET[rel]) continue;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
      if (TYPED.test(line)) bad.push(`${rel}:${i + 1}: ${code.slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, [], "typed daily claims — use __EVERY__ / everyPhrase (lib/refreshCadence.js):\n" + bad.join("\n"));
});

test("the exemption list cannot rot", () => {
  for (const rel of Object.keys(NOT_A_CLAIM_ABOUT_THE_MARKET)) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.ok(src.split("\n").some((l) => TYPED.test(l)), `${rel} is exempted but no longer types a daily claim`);
  }
});
