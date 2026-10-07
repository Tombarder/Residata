// Unsaved work in an editor must not vanish on a sidebar click or Back
// (lib/leaveGuard): the platform asks the page first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLeaveGuard, shouldAskBeforeLeaving, mayLeave, allowNextLeave } from "./leaveGuard.js";

test("no guard: leave freely", async () => {
  assert.equal(shouldAskBeforeLeaving(), false);
  assert.equal(await mayLeave(), true);
});

test("a guard is asked, and its answer decides", async () => {
  let answer = false;
  const off = setLeaveGuard(async () => answer);
  assert.equal(shouldAskBeforeLeaving(), true);
  assert.equal(await mayLeave(), false);
  answer = true;
  assert.equal(await mayLeave(), true);
  off();
  assert.equal(shouldAskBeforeLeaving(), false);
});

test("a confirmed leave passes exactly once", () => {
  const off = setLeaveGuard(async () => false);
  allowNextLeave();
  assert.equal(shouldAskBeforeLeaving(), false, "the pass is used");
  assert.equal(shouldAskBeforeLeaving(), true, "and only once");
  off();
});

test("an old cleanup does not remove a newer guard; a throwing guard keeps you", async () => {
  const offA = setLeaveGuard(async () => true);
  const offB = setLeaveGuard(async () => { throw new Error("x"); });
  offA();
  assert.equal(shouldAskBeforeLeaving(), true, "B is still registered");
  assert.equal(await mayLeave(), false);
  offB();
});
