/**
 * "You have unsaved changes" for in-app navigation.
 *
 * The browser asks by itself before a tab closes or reloads (beforeunload), but a
 * click in the platform's sidebar or the browser's Back button only swaps the
 * React page — and an editor with unsaved work vanished without a word. A page
 * with unsaved work registers a guard here (an async () => boolean, typically the
 * page's own confirm dialog); the platform's navigate() and App's popstate handler
 * ask it before leaving. One guard at a time: the page on screen.
 */

let guard = null;
let passNext = false;

/** Register; returns the function that unregisters (for a useEffect cleanup). */
export function setLeaveGuard(fn) {
  guard = fn;
  return () => { if (guard === fn) guard = null; };
}

/** Should a navigation stop and ask? Consumes a pass set by allowNextLeave(). */
export function shouldAskBeforeLeaving() {
  if (passNext) { passNext = false; return false; }
  return !!guard;
}

/** Ask the guard (true when there is none). */
export async function mayLeave() {
  if (!guard) return true;
  try { return !!(await guard()); } catch { return false; }
}

/** The next navigation was already confirmed — let it through once. */
export function allowNextLeave() { passNext = true; }
