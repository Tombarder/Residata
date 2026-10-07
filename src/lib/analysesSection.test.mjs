// The /analyzy section is on the site exactly while something is published
// (lib/analysesSection). Boss withdrew every analysis on 2026-10-07; publishing
// one in /app/articles must bring the whole section back with no second switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionIsLive, analysesLiveDefine, ANALYSES_LIVE, navPagesFor, shownPage } from "./analysesSection.js";

test("the section is live while anything is published", () => {
  assert.equal(sectionIsLive(0), false);
  assert.equal(sectionIsLive(1), true);
  assert.equal(sectionIsLive(19), true);
});

test("the build injects the answer from its own article list", () => {
  assert.deepEqual(analysesLiveDefine([]), { __ANALYSES_LIVE__: "false" });
  assert.deepEqual(analysesLiveDefine([{ slug: "a" }]), { __ANALYSES_LIVE__: "true" });
});

test("a build that could not read the list keeps the section", () => {
  assert.deepEqual(analysesLiveDefine(null), {});
  assert.equal(ANALYSES_LIVE, true, "no define (node, local build) = the section stays");
});

test("the menu drops the analyses link, in every language, only when off", () => {
  const en = ["Home", "Live", "What we deliver", "Use Cases", "Insights", "Pricing & Contact"];
  const sk = ["Domov", "Live", "Čo dostanete", "Využitie", "Analýzy", "Cenník & Kontakt"];
  const at = en.indexOf("Insights");
  assert.deepEqual(navPagesFor(en, at, true), en);
  assert.deepEqual(navPagesFor(en, at, false), ["Home", "Live", "What we deliver", "Use Cases", "Pricing & Contact"]);
  assert.deepEqual(navPagesFor(sk, at, false), ["Domov", "Live", "Čo dostanete", "Využitie", "Cenník & Kontakt"]);
});

test("an /analyzy address shows the homepage while the section is off", () => {
  assert.equal(shownPage("Insights", false), "Home");
  assert.equal(shownPage("Analyza:ba-prehlad-2026-q3", false), "Home");
  assert.equal(shownPage("Pricing", false), "Pricing", "only the analyses addresses move");
  assert.equal(shownPage("Insights", true), "Insights");
  assert.equal(shownPage("Analyza:ba-prehlad-2026-q3", true), "Analyza:ba-prehlad-2026-q3");
});
