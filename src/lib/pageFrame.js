/**
 * The marketing site's outer frame — the root the whole app renders inside and
 * the room it keeps under the fixed header — shared by App.jsx and the pre-built
 * pages (scripts/prerender.mjs), so a pre-built page puts its text exactly where
 * the app will once it starts. Change it here, and both move together.
 */

/** App.jsx's root element style. */
export const APP_ROOT_STYLE = {
  background: "var(--bg)",
  color: "var(--text)",
  fontFamily: "'Outfit', -apple-system, sans-serif",
  minHeight: "100vh",
  WebkitFontSmoothing: "antialiased",
  position: "relative",
};

/** The fixed ticker's height, kept free in the page flow below the fixed nav. */
export const TICKER_SPACER_PX = 36;
