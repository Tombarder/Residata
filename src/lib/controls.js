/**
 * controls.js — the shared control BOX, for the many places that style an input
 * with an inline object instead of a class.
 *
 * `.rd-field` in styles/ui.css is the same box as a CSS class, and it is the one to
 * reach for in new code. This exists because a page typically writes
 * `style={{ ...field, width: 74 }}` at a dozen call sites, and converting all of
 * them to `className` + a width would be a large mechanical diff for no gain. What
 * matters is that there is ONE definition of the geometry: both this object and
 * `.rd-field` read the --rd-field-* custom properties, so an inline-styled input and
 * a class-styled input in the same toolbar row are the same height, radius and type
 * size by construction — they cannot drift apart in a later edit.
 *
 * Why it was needed (2026-08-19 audit): the app had NINE separate definitions of
 * "an input box" — heights 34px / 36px / auto, radii 6 / 7 / 8 / 9, font sizes
 * 0.8 / 0.82 / 0.84 / 0.85 / 0.88rem / 14px, backgrounds --bg / --surface /
 * --surface-2 / --surface-3. Every toolbar that mixed a <Picker> with a local input
 * showed the mismatch, which is most of what "the controls look ugly" meant.
 *
 * Spread it, then override only what is genuinely page-specific (width, a mono font
 * for a code editor, a lighter background when the row sits on an inset panel):
 *
 *   <input style={{ ...field, width: 74 }} />
 *   <input style={{ ...fieldBlock, fontFamily: mono }} />
 */

/** Standard toolbar control: same box as `.rd-field`. */
export const field = {
  height: "var(--rd-ctrl-h)",
  padding: "0 var(--rd-field-px)",
  background: "var(--surface-2)",
  // LONG-HAND on purpose — never `border: "1px solid var(--border)"`. Call sites
  // tint this box by overriding `borderColor` (an invalid value, an active filter,
  // a selected chip), and a React style object must not carry the shorthand AND
  // the long-hand for the same value: when the override falls away on a later
  // render React clears `borderColor` while `border` is still set, which blanks
  // the box's whole border and logs "Removing a style property during rerender
  // (borderColor) when a conflicting property is set (border)". Long-hand over
  // long-hand simply changes the colour, so the border survives. `.rd-field` in
  // styles/ui.css can keep the shorthand — CSS has a cascade, React has a diff.
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--border)",
  borderRadius: "var(--rd-field-r)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: "var(--rd-field-fs)",
  outline: "none",
  boxSizing: "border-box",
};

/** Full-width variant — the common case inside a labelled form column. */
export const fieldBlock = { ...field, width: "100%" };

/** Dense variant for a table cell or a filter row: same box as `.rd-field--sm`. */
export const fieldSm = {
  ...field,
  height: "var(--rd-ctrl-h-sm)",
  padding: "0 var(--rd-field-px-sm)",
  borderRadius: "var(--rd-field-r-sm)",
  fontSize: "var(--rd-field-fs-sm)",
};

/** Dense + full width (admin editors that put an input in every cell). */
export const fieldSmBlock = { ...fieldSm, width: "100%" };

/** A multi-line control keeps the box but has to grow, so height gives way to
 *  padding — otherwise a textarea would be clamped to one row's height. */
export const textarea = {
  ...field,
  height: undefined,
  padding: "0.5rem var(--rd-field-px)",
  lineHeight: 1.5,
  resize: "vertical",
};
