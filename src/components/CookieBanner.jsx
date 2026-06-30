/**
 * GDPR cookie consent banner.
 *
 * Behavior:
 *   - Shows on first visit (no localStorage entry).
 *   - "Accept all" → grants both essential + analytics consent.
 *   - "Reject all" → essential only (analytics blocked).
 *   - "Customize" → expanded view with per-category toggles.
 *   - Choice is persisted in localStorage under `residata-cookie-consent`
 *     with shape: { v: 1, ts: <iso>, essential: true, analytics: bool }.
 *   - Essential is ALWAYS true — Supabase auth wouldn't work otherwise.
 *
 * Re-open path: pages/LegalPages shows a "Cookie settings" footer link
 * that calls `window.residataReopenCookieBanner()` (exposed below).
 *
 * Today no analytics tools are actually loaded, so the banner is purely
 * future-proofing — but it makes the GDPR posture correct: when we ever
 * add Plausible / PostHog / GA4, the gate is already there.
 *
 * Built for F-051. Boss 2026-05-31: free path, no third-party libraries.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const STORAGE_KEY = "residata-cookie-consent";
const CURRENT_VERSION = 1;

function readConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // If the schema changes (v++), force re-prompt.
    if (parsed?.v !== CURRENT_VERSION) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeConsent(consent) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: CURRENT_VERSION,
      ts: new Date().toISOString(),
      ...consent,
    }));
    // Fire a custom event so any future analytics-bootstrap code can listen
    // and load (or unload) trackers based on the new state.
    window.dispatchEvent(new CustomEvent("residata-consent-changed", { detail: consent }));
  } catch (_) {}
}

export default function CookieBanner({ lang = "en" }) {
  const isSK = lang === "sk";
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  // Show on first visit; expose a global to re-open from Footer link.
  useEffect(() => {
    if (!readConsent()) setVisible(true);
    window.residataReopenCookieBanner = () => {
      const existing = readConsent();
      if (existing) setAnalytics(!!existing.analytics);
      setExpanded(true);
      setVisible(true);
    };
    return () => { delete window.residataReopenCookieBanner; };
  }, []);

  // While the consent banner occupies the bottom edge, publish its measured
  // height (--cookie-banner-h) + a body class so the bottom-right floating pills
  // lift above it on phones, where they share the same corner. Mirrors the
  // --trial-banner-h pattern; both are cleared the instant consent is resolved.
  const dialogRef = useRef(null);
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const clear = () => {
      root.style.removeProperty("--cookie-banner-h");
      document.body.classList.remove("residata-has-cookie");
    };
    if (!visible) { clear(); return; }
    const el = dialogRef.current;
    if (!el) return;
    const apply = () => root.style.setProperty("--cookie-banner-h", el.offsetHeight + "px");
    apply();
    document.body.classList.add("residata-has-cookie");
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    window.addEventListener("resize", apply);
    return () => { ro?.disconnect(); window.removeEventListener("resize", apply); clear(); };
  }, [visible, expanded]);

  if (!visible) return null;

  const acceptAll = () => {
    writeConsent({ essential: true, analytics: true });
    setVisible(false);
    setExpanded(false);
  };
  const rejectAll = () => {
    writeConsent({ essential: true, analytics: false });
    setVisible(false);
    setExpanded(false);
  };
  const savePrefs = () => {
    writeConsent({ essential: true, analytics });
    setVisible(false);
    setExpanded(false);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={isSK ? "Súhlas s cookies" : "Cookie consent"}
      style={{
        position: "fixed",
        bottom: "calc(20px + var(--safe-bottom))",
        left: "calc(20px + var(--safe-left))",
        right: "calc(20px + var(--safe-right))",
        maxWidth: 640,
        margin: "0 auto",
        background: "#16161a",
        border: "1px solid #2a2a32",
        borderRadius: 12,
        padding: "1.25rem 1.5rem",
        zIndex: "var(--z-cookie)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        fontSize: "0.86rem",
        lineHeight: 1.55,
        color: "#c5c5cc",
      }}
    >
      <div style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "0.62rem",
        color: "#00e5a0",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        marginBottom: "0.5rem",
      }}>
        {isSK ? "Cookies" : "Cookies"}
      </div>

      <div style={{ marginBottom: "0.85rem" }}>
        {isSK
          ? "Používame nevyhnutné cookies, ktoré stránku udržia funkčnú. Voliteľne môžete povoliť aj analytické cookies, aby sme pochopili, ako sa Residata používa. Žiadne sledovacie nástroje tretích strán momentálne nepoužívame."
          : "We use essential cookies that keep the site running. Optionally, you can also allow analytics cookies so we can understand how Residata is used. We currently use no third-party tracking tools."}
        {" "}
        <a
          href="/privacy"
          style={{ color: "#00e5a0", textDecoration: "underline" }}
        >
          {isSK ? "Viac v zásadách ochrany údajov" : "More in the privacy policy"}
        </a>.
      </div>

      {expanded && (
        <div style={{
          background: "#0e0e10",
          border: "1px solid #222228",
          borderRadius: 8,
          padding: "0.85rem 1rem",
          margin: "0.85rem 0",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingBottom: "0.6rem",
            borderBottom: "1px solid #222228",
            marginBottom: "0.6rem",
          }}>
            <div>
              <div style={{ fontWeight: 600, color: "#e8e8ed" }}>
                {isSK ? "Nevyhnutné" : "Essential"}
              </div>
              <div style={{ fontSize: "0.78rem", color: "#8a8a96" }}>
                {isSK ? "Prihlásenie a relácia (Supabase). Bez týchto cookies stránka nefunguje." : "Login and session (Supabase). The site does not work without these."}
              </div>
            </div>
            <span style={{ fontSize: "0.78rem", color: "#55555f" }}>
              {isSK ? "vždy zapnuté" : "always on"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, color: "#e8e8ed" }}>
                {isSK ? "Analytické" : "Analytics"}
              </div>
              <div style={{ fontSize: "0.78rem", color: "#8a8a96" }}>
                {isSK ? "Žiadne nie sú aktívne. Pri pridaní v budúcnosti budeme rešpektovať túto voľbu." : "None currently active. If added in the future, this choice will be respected."}
              </div>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={analytics}
                onChange={e => setAnalytics(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "#00e5a0" }}
              />
              <span style={{ fontSize: "0.78rem", color: analytics ? "#00e5a0" : "#8a8a96" }}>
                {analytics ? (isSK ? "povolené" : "allowed") : (isSK ? "blokované" : "blocked")}
              </span>
            </label>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: expanded ? 0 : "0.4rem" }}>
        <button
          onClick={acceptAll}
          style={{
            background: "#00e5a0",
            color: "#0a0a0c",
            border: "none",
            padding: "0.55rem 1.1rem",
            borderRadius: 8,
            fontSize: "0.82rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isSK ? "Prijať všetko" : "Accept all"}
        </button>
        <button
          onClick={rejectAll}
          style={{
            background: "transparent",
            color: "#e8e8ed",
            border: "1px solid #2a2a32",
            padding: "0.55rem 1.1rem",
            borderRadius: 8,
            fontSize: "0.82rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {isSK ? "Odmietnuť všetko" : "Reject all"}
        </button>
        {!expanded ? (
          <button
            onClick={() => setExpanded(true)}
            style={{
              background: "transparent",
              color: "#8a8a96",
              border: "none",
              padding: "0.55rem 0.5rem",
              fontSize: "0.82rem",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {isSK ? "Upraviť" : "Customize"}
          </button>
        ) : (
          <button
            onClick={savePrefs}
            style={{
              background: "transparent",
              color: "#00e5a0",
              border: "1px solid #00e5a0",
              padding: "0.55rem 1.1rem",
              borderRadius: 8,
              fontSize: "0.82rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {isSK ? "Uložiť voľbu" : "Save choice"}
          </button>
        )}
      </div>
    </div>
  );
}
