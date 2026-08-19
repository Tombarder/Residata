/**
 * webgl.js — can this browser actually draw a map, and if not, why?
 *
 * The maps need WebGL. A machine can fail that for reasons that have nothing to do
 * with us: hardware acceleration switched off in the browser, a blocklisted or
 * broken GPU driver, a locked-down work laptop, remote-desktop sessions. Before
 * 2026-08-19 we never asked — maplibre just failed to start and the page kept an
 * empty container, so the user got a blank rectangle with no explanation. That is
 * exactly what it looks like when a BASEMAP is broken too, which cost a day of
 * hunting the wrong thing (Boss's Windows PC showed nothing while his Mac was fine).
 *
 * So the rule is: never leave a blank map. Ask first, and if the answer is no, say
 * what is wrong in words the reader can act on.
 */

/** Probe a real GL context. Returns { ok } or { ok:false, reason, detail }. */
export function checkWebGL() {
  if (typeof document === "undefined") return { ok: false, reason: "no-document" };
  let canvas;
  try {
    canvas = document.createElement("canvas");
  } catch (e) {
    return { ok: false, reason: "canvas-failed", detail: String(e?.message || e) };
  }
  // Ask for the same context maplibre does, with the same failure mode: if the
  // browser would only give a software fallback it still reports a context, so a
  // successful probe here genuinely means maplibre can start.
  let gl = null;
  try {
    gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  } catch (e) {
    return { ok: false, reason: "context-threw", detail: String(e?.message || e) };
  }
  if (!gl) {
    return {
      ok: false,
      reason: "no-webgl",
      detail: "The browser refused a WebGL context — usually hardware acceleration is off, or the GPU driver is blocked.",
    };
  }
  let renderer = "";
  try {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch {
    /* renderer is a nicety, never a reason to fail */
  }
  return { ok: true, renderer: String(renderer || "unknown") };
}

/** One line a person can paste to us when a map won't start. */
export function mapDiagnostics(extra = {}) {
  const gl = checkWebGL();
  const d = {
    webgl: gl.ok ? "ok" : `FAILED (${gl.reason})`,
    renderer: gl.renderer || gl.detail || "—",
    ua: typeof navigator !== "undefined" ? navigator.userAgent : "—",
    screen: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x` : "—",
    url: typeof location !== "undefined" ? location.pathname : "—",
    ...extra,
  };
  return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join("\n");
}
