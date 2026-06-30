/**
 * NavControls — accessible primitives for the marketing top nav.
 *
 * Why this exists: the nav used to render every interactive item as a bare
 * `<a onClick>` with NO `href`. An anchor without `href` is not in the tab
 * order and ignores Enter/Space, so keyboard-only and screen-reader users
 * could not reach or activate the logo, the nav links, the CTAs, "Open
 * platform", or any mobile-menu action. These two primitives replace that
 * pattern at every site so it is keyboard-operable + announced correctly,
 * and the right element type can't silently regress.
 *
 * Rule of thumb:
 *   • It NAVIGATES to a page/URL → <NavLink>   (renders a real <a href>)
 *   • It performs an ACTION (login modal, sign-out, … ) → <NavButton>
 *     (renders a real <button>)
 *
 * Both keep the existing look: they forward `className` + `style` untouched,
 * so the current CSS (.nav-link, .btn-p, inline CTA styles, …) renders
 * pixel-identically. The keyboard focus ring is the app-wide :focus-visible
 * outline in index.css — no per-element focus styling needed.
 */
import { pageToPath } from "../lib/routing";

/**
 * NavLink — an in-app navigation rendered as a REAL <a href>.
 *
 * Being a real link means it is in the tab order, activates on Enter,
 * announces as "link" to assistive tech, shows its target on hover, and
 * supports the native cmd/ctrl/middle-click "open in new tab" + "copy link"
 * affordances. A plain left-click is intercepted and handed to the SPA
 * router via `onNavigate`; modified / non-primary clicks fall through to the
 * browser so new-tab/new-window still work.
 *
 * @param to         resolved page key (e.g. "Home", "App:Dashboard").
 *                   The href is derived from it via pageToPath().
 * @param onNavigate SPA navigate fn (App's handleNav, or the menu's `go`);
 *                   called with `to` on a plain left-click.
 */
export function NavLink({ to, onNavigate, className, style, children, onClick, ...rest }) {
  const handleClick = (e) => {
    // Let the browser handle modified / non-left-button clicks natively
    // (open in new tab / window / download) — only hijack the plain click.
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
    ) return;
    e.preventDefault();
    onClick?.(e);
    onNavigate?.(to);
  };
  return (
    <a href={pageToPath(to)} onClick={handleClick} className={className} style={style} {...rest}>
      {children}
    </a>
  );
}

// A <button> inherits a few UA defaults that an <a>/inline element doesn't
// (its own font family, native control chrome, a stray margin). Neutralise
// ONLY those, merged *under* the caller's style so every explicit style/class
// the call-sites already set (background, padding, font-size/weight, border …)
// still wins and the look is unchanged. We deliberately don't touch font-size
// or font-weight here — the call-sites own those.
const BUTTON_RESET = {
  appearance: "none",
  WebkitAppearance: "none",
  fontFamily: "inherit",
  margin: 0,
};

/**
 * NavButton — an in-nav ACTION rendered as a REAL <button> styled to match
 * the surrounding links/CTAs. Natively focusable, activates on Enter AND
 * Space, announced as "button". Use for things with no URL: opening the
 * login modal, signing out, etc.
 */
export function NavButton({ className, style, children, type = "button", ...rest }) {
  return (
    <button type={type} className={className} style={{ ...BUTTON_RESET, ...style }} {...rest}>
      {children}
    </button>
  );
}
