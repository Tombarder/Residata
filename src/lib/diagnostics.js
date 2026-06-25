/**
 * diagnostics.js — automatic context capture for feedback.
 *
 * Two jobs:
 *   1) A tiny always-on collector that records recent JS errors, unhandled
 *      promise rejections, console.error calls, and failed network requests
 *      into a small ring buffer. This is the stuff a screenshot CANNOT show —
 *      the technical errors that actually explain a bug.
 *   2) capturePageScreenshot() — a best-effort screenshot of the visible page
 *      (excluding the feedback widget) so the admin sees what the user saw.
 *      html2canvas is lazy-loaded only when a feedback is sent, so it costs
 *      nothing during normal browsing. Note: WebGL maps render blank — that's
 *      a known html2canvas limitation; the diagnostics still capture map errors.
 *
 * Privacy: getDiagnostics() returns only technical context (no form values,
 * no localStorage). The page screenshot is opt-outable in the widget.
 */

const MAX_EVENTS = 25;
const _events = [];
let _installed = false;

function record(type, message, detail) {
  try {
    _events.push({ t: type, m: String(message == null ? "" : message).slice(0, 300), d: detail || null, ts: new Date().toISOString() });
    while (_events.length > MAX_EVENTS) _events.shift();
  } catch { /* never let logging throw */ }
}

export function installDiagnostics() {
  if (_installed || typeof window === "undefined") return;
  _installed = true;

  window.addEventListener("error", (e) => {
    // Resource errors (img/script 404) have no message; skip the noisiest ones.
    if (e?.message) record("js-error", e.message, { src: e.filename, line: e.lineno, col: e.colno });
  });
  window.addEventListener("unhandledrejection", (e) => {
    record("promise-rejection", e?.reason?.message || String(e?.reason));
  });

  const origErr = console.error;
  console.error = function (...args) {
    try { record("console.error", args.map((a) => (a && a.message) || String(a)).join(" ")); } catch { /* ignore */ }
    return origErr.apply(this, args);
  };

  if (typeof window.fetch === "function") {
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
      const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      try {
        const res = await origFetch(...args);
        if (!res.ok) record("fetch", `${res.status} ${url}`.slice(0, 220), { status: res.status });
        return res;
      } catch (err) {
        record("fetch-fail", `${url} — ${(err && err.message) || err}`.slice(0, 220));
        throw err;
      }
    };
  }
}

export function getDiagnostics(extra = {}) {
  if (typeof window === "undefined") return null;
  try {
    return {
      page: location.pathname,
      url: location.href,
      referrer: document.referrer || null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      screen: { w: window.screen && window.screen.width, h: window.screen && window.screen.height },
      dpr: window.devicePixelRatio || 1,
      lang: navigator.language,
      online: navigator.onLine,
      ua: navigator.userAgent,
      events: _events.slice(-18),
      captured_at: new Date().toISOString(),
      ...extra,
    };
  } catch {
    return { page: location.pathname, events: _events.slice(-18) };
  }
}

/**
 * Best-effort screenshot of the CURRENT VIEWPORT (what the user sees), excluding
 * any element marked data-rbf-ignore (the feedback widget). Returns a JPEG data
 * URL or null. Never throws.
 */
export async function capturePageScreenshot({ timeoutMs = 5000, maxDim = 1100 } = {}) {
  if (typeof document === "undefined") return null;
  try {
    const mod = await import("html2canvas");
    const html2canvas = mod.default || mod;
    const canvasP = html2canvas(document.body, {
      logging: false,
      useCORS: true,
      backgroundColor: "#0a0a0b",
      scale: Math.min(1.5, window.devicePixelRatio || 1),
      x: window.scrollX, y: window.scrollY,
      width: window.innerWidth, height: window.innerHeight,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
      ignoreElements: (el) => !!(el && el.hasAttribute && el.hasAttribute("data-rbf-ignore")),
    });
    const canvas = await Promise.race([
      canvasP,
      new Promise((_, rej) => setTimeout(() => rej(new Error("screenshot timeout")), timeoutMs)),
    ]);
    let w = canvas.width, h = canvas.height;
    if (w > maxDim) { const s = maxDim / w; w = Math.round(w * s); h = Math.round(h * s); }
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    out.getContext("2d").drawImage(canvas, 0, 0, w, h);
    return out.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;  // best-effort — the diagnostics still go through
  }
}

// Install as early as this module is first imported (App.jsx imports it at top).
installDiagnostics();
