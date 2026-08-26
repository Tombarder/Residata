/**
 * Tests for controls — run with:  node --test src/lib/controls.test.mjs
 *
 * These boxes are SPREAD INTO REACT INLINE STYLES, and pages tint them by
 * overriding `borderColor` (an invalid value, an active filter, a selected chip).
 * A React style object must therefore never carry the `border` shorthand as well:
 * when the override falls away on a later render React clears `borderColor` while
 * `border` still stands, which blanks the box's entire border and logs
 * "Removing a style property during rerender (borderColor) when a conflicting
 * property is set (border)". This guards the shared definition so the whole
 * platform cannot regress at once.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { field, fieldBlock, fieldSm, fieldSmBlock, textarea } from "./controls.js";

const BOXES = { field, fieldBlock, fieldSm, fieldSmBlock, textarea };

/* Every long-hand React writes when it sees `border`. Mixing ANY of these with
   the shorthand in one style object is the same bug; borderColor is just the one
   the app actually hits. */
const CONFLICTS = [
  "borderColor", "borderWidth", "borderStyle",
  "borderTop", "borderRight", "borderBottom", "borderLeft",
  "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
];

for (const [name, box] of Object.entries(BOXES)) {
  test(`${name} states its border in long-hand, never the shorthand`, () => {
    assert.ok(!("border" in box), `${name} must not set the \`border\` shorthand`);
    assert.equal(box.borderWidth, "1px");
    assert.equal(box.borderStyle, "solid");
    assert.ok(box.borderColor, `${name} must name a border colour`);
  });

  test(`${name} never mixes the border shorthand with a long-hand`, () => {
    if (!("border" in box)) return;
    const mixed = CONFLICTS.filter((k) => k in box);
    assert.deepEqual(mixed, [], `${name} sets \`border\` alongside ${mixed.join(", ")}`);
  });
}

test("the boxes stay one definition — variants inherit the same border", () => {
  for (const [name, box] of Object.entries(BOXES)) {
    assert.equal(box.borderColor, field.borderColor, `${name} drifted from field`);
    assert.equal(box.borderWidth, field.borderWidth, `${name} drifted from field`);
    assert.equal(box.borderStyle, field.borderStyle, `${name} drifted from field`);
  }
});
