// theme.js — single source of truth for the platform's JS-driven palette.
// Mirrors the CSS design tokens in index.css, kept as JS hex so it also works
// where CSS variables can't reach (maplibre paint, canvas fills).
export const accent       = "#00e5a0"; // brand green   (= --accent)
export const onAccent     = "#06140f"; // text on green
export const dim          = "#8a8a96"; // (= --text-dim)
export const faint        = "#55555f"; // (= --text-faint)
export const border       = "#222228"; // (= --border)
export const text         = "#e8e8ed"; // (= --text)
export const bg           = "#0a0a0b"; // page bg       (= --bg)
export const surface      = "#16161a"; // card surface  (= --surface)
export const surfaceDark  = "#0e0e10"; // dark inset/raised surface
export const surfacePanel = "#14141a"; // slightly-raised panel
export const orange       = "#f5a623"; // secondary accent (= --accent-2)
export const blue         = "#4a9eff"; // status "reserved" blue
export const mono         = "'JetBrains Mono', monospace";
