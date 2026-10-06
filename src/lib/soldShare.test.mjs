// The sold-share note beside a per-project average price (board decision 186771).
import { test } from "node:test";
import assert from "node:assert/strict";
import { soldSharePct, soldShareText, soldShareTitle } from "./soldShare.js";

test("the share is the ledger's sold flats out of every flat the project has had", () => {
  // Dostupné bývanie Nitra, projects_live 2026-10-06
  assert.equal(soldSharePct({ total_units: 284, sold_units: 184, sold_percentage: 69.0 }), 65);
});

test("it is NOT sold_percentage, which counts reserved flats — they are still in the average", () => {
  const novyRuzinov = { total_units: 122, sold_units: 9, prereserved_units: 21, sold_percentage: 24.6 };
  assert.equal(soldSharePct(novyRuzinov), 7);
});

test("nothing sold, or nothing known: no note — the average then is the project", () => {
  assert.equal(soldShareText(soldSharePct({ total_units: 40, sold_units: 0 }), "sk"), "");
  assert.equal(soldSharePct({ total_units: 0, sold_units: 0 }), null);
  assert.equal(soldSharePct({}), null);
  assert.equal(soldSharePct(null), null);
  assert.equal(soldShareTitle(null), "");
});

test("both languages say what the number is and why it matters", () => {
  assert.equal(soldShareText(65, "sk"), "65 % predaných");
  assert.equal(soldShareText(65, "en"), "65% sold");
  assert.match(soldShareTitle(65, "sk"), /zvyšok ponuky, nie celý projekt/);
  assert.match(soldShareTitle(65, "en"), /remaining offer, not the whole project/);
});

test("a ledger count above the total cannot print more than 100 %", () => {
  assert.equal(soldSharePct({ total_units: 10, sold_units: 12 }), 100);
});
