// theme.js — JS-side design tokens for inline styles.
//
// NEUTRALS resolve to CSS variables (index.css) so they flip with the light/dark
// theme automatically wherever they're used in an inline style or a style-string.
// BRAND / STATUS colours stay literal hex: they are theme-invariant AND some feed
// straight into maplibre paint (MapView2 fill/circle colours), which cannot take a
// `var(...)`. Never convert accent/orange/blue/onAccent to var().
// Brand green as a THEME-AWARE token: neon mint in dark, deep readable emerald in
// light (so it never reads as washed pale-green on the light workspace). Resolves to
// a CSS var, so it must NOT be used in maplibre paint — use accentPaint there.
export const accent       = "var(--accent)";
export const accentStrong = "var(--accent-strong)";
// Literal mint for maplibre paint ONLY (circle/fill/line-color can't take a var()).
export const accentPaint       = "#00e5a0";
export const accentStrongPaint = "#00c98c";
// accent used as TEXT/value colour. Resolves to a CSS var: mint in dark, deep-green
// in light — so mint-on-white text stays legible. It is a var(), so it must NEVER be
// used in maplibre paint or string-concatenated with an opacity suffix (`${accentInk}33`
// is invalid). Use `accent` (literal) for those. For solid text colour, prefer this.
export const accentInk    = "var(--accent-ink)";
export const onAccent     = "#06140f"; // text on a green fill (dark, fine on both themes)
export const orange       = "#f5a623"; // secondary accent (theme-invariant; map paint)
export const blue         = "#4a9eff"; // status "reserved" blue (theme-invariant)
export const danger       = "#ff6b6b"; // error / negative (theme-invariant)
// The same three status colours as TEXT. They resolve to CSS vars, so they darken
// on the light theme — measured 2026-08-19 on the live light workspace, the literals
// above read at 1.36:1 contrast (WCAG asks 4.5:1), which made every warning number,
// "paid only" label and error line all but invisible. The ink variants land at
// 4.2–6.3:1. Same rule as accentInk: NEVER feed an ink into maplibre paint and never
// string-concatenate it with an alpha suffix (`${orangeInk}14` is not a colour) —
// use the literal above for those.
export const orangeInk    = "var(--accent-2)";
export const dangerInk    = "var(--danger)";
export const infoInk      = "var(--info)";

// neutrals — CSS variables, so they theme-switch
export const dim          = "var(--text-dim)";
export const faint        = "var(--text-faint)";
export const border       = "var(--border)";
export const text         = "var(--text)";
export const text2        = "var(--text-2)";
export const bg           = "var(--bg)";
export const surface      = "var(--surface)";
export const surfaceDark  = "var(--surface-2)"; // inset / darker panel
export const surfacePanel = "var(--surface)";   // card / panel
export const mono         = "'JetBrains Mono', monospace";
