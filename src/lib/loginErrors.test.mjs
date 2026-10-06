import { test } from "node:test";
import assert from "node:assert/strict";
import { loginErrorMessage } from "./loginErrors.js";

test("the project-wide e-mail limit is said as a limit, not as a sent code", () => {
  const e = { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" };
  assert.match(loginErrorMessage(e, "sk"), /priveľa prihlasovacích kódov/);
  assert.match(loginErrorMessage(e, "en"), /Too many sign-in codes/);
});
test("the per-address wait says how long", () => {
  const e = { status: 429, message: "For security purposes, you can only request this after 42 seconds." };
  assert.match(loginErrorMessage(e, "sk"), /o 42 s/);
  assert.match(loginErrorMessage(e, "en"), /in 42 s/);
});
test("anything else passes through, and no error means no message", () => {
  assert.equal(loginErrorMessage({ message: "Signups not allowed" }, "en"), "Signups not allowed");
  assert.equal(loginErrorMessage(null, "en"), null);
});
