/**
 * One list of AI questions per day. Until 2026-10-06 Billing sold Premium on
 * "30 questions / day" while the server cut a paying customer off at 15 — three
 * copies of one number. The server, the chat window and Billing now read
 * src/lib/aiLimits.js; this fails if any of them grows its own copy again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_DAILY_LIMITS } from "./aiLimits.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("the server, the chat window and Billing all read the one list", () => {
  for (const f of ["api/ai/chat.js", "src/lib/useChat.js", "src/pages/Platform.jsx"]) {
    assert.match(read(f), /AI_DAILY_LIMITS/, `${f} does not use the shared list`);
    assert.doesNotMatch(read(f), /\{\s*anon:\s*\d+,\s*free:\s*\d+,\s*paid:\s*\d+/, `${f} has its own copy of the limits`);
  }
});

test("Billing promises no number of its own", () => {
  assert.doesNotMatch(read("src/pages/Platform.jsx"), /\b\d+ (otázok|questions) \/ (deň|day)/);
});

test("the limits are sane", () => {
  assert.ok(AI_DAILY_LIMITS.paid > AI_DAILY_LIMITS.free && AI_DAILY_LIMITS.free > AI_DAILY_LIMITS.anon);
  assert.ok(Object.isFrozen(AI_DAILY_LIMITS));
});
