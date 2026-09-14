/* How a price is written. These exist because on 2026-09-14 the Unit database and Sales
 * rendered "Kč4 958 193" — symbol in front, no space — while eleven other sites wrote
 * "4 958 193 Kč". Nobody writes the first one in Czech. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setMoney, formatMoney, formatPerM2, moneyFromEur, moneyToEur } from "./money.js";

const NBSP = " ";

test("EUR: the symbol FOLLOWS the amount, after a non-breaking space", () => {
  setMoney({ code: "EUR", symbol: "€", unitsPerEur: 1 });
  assert.equal(formatMoney(204342), `204${NBSP}342${NBSP}€`);
  assert.equal(formatPerM2(4813), `4${NBSP}813${NBSP}€/m²`);
});

test("CZK: converts AND writes it the Czech way", () => {
  setMoney({ code: "CZK", symbol: "Kč", unitsPerEur: 24.26 });
  // 204 342 € × 24.26 = 4 957 336 Kč — and the symbol is never a prefix.
  const out = formatMoney(204342);
  assert.ok(out.endsWith(`${NBSP}Kč`), out);
  assert.ok(!out.startsWith("Kč"), out);
  assert.equal(out, `4${NBSP}957${NBSP}337${NBSP}Kč`);
});

test("the space before the symbol never wraps", () => {
  setMoney({ code: "CZK", symbol: "Kč", unitsPerEur: 24.26 });
  assert.ok(!/ Kč$/.test(formatMoney(1000)), "must be NBSP, not a plain space");
});

test("a missing price is a dash, not NaN or a bare symbol", () => {
  setMoney({ code: "EUR", symbol: "€", unitsPerEur: 1 });
  for (const v of [null, undefined, "", "n/a", NaN]) {
    assert.equal(formatMoney(v), "—", `formatMoney(${String(v)})`);
    assert.equal(formatPerM2(v), "—", `formatPerM2(${String(v)})`);
  }
});

test("a typed bound round-trips through the display currency", () => {
  setMoney({ code: "CZK", symbol: "Kč", unitsPerEur: 24.26 });
  assert.equal(Math.round(moneyToEur(moneyFromEur(200000))), 200000);
});
