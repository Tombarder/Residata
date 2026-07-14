/**
 * TrialBanner + TrialPopup — marketing-side promotion of the
 * 7-day free trial. Two surfaces, both dismissible:
 *
 *   1. Slim top banner (non-intrusive, always-visible until dismissed)
 *      Shown above the Nav for anon visitors and free-tier signed-in
 *      users who haven't yet used their trial. Dismissal is sticky
 *      for 7 days via localStorage.
 *
 *   2. Modal popup — fires on EVERY marketing page load (incl. refresh)
 *      Shown 1.5s after each load to anyone who can still start the trial:
 *      anon visitors AND logged-in free users who haven't activated it yet
 *      (Boss rule — keep offering until they actually start it). No per-day/
 *      session suppression — a refresh re-shows it. The instant the trial is
 *      active / used / the user is paid|admin it never shows again. Does not
 *      re-pop on internal SPA navigation (the component stays mounted), only
 *      on a real load/refresh.
 *
 * Both surfaces gate on the SAME predicate — useCapabilities().showTrialOffer
 * — so they can never disagree. It is true for anon visitors and for logged-in
 * free users who can still start the trial; false for trial-active, trial-used,
 * paid, admin and pending. Both hide on /app/*.
 */
import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { useCapabilities } from "../lib/useCapabilities";
import { track } from "../lib/track";

const KEY_BANNER_DISMISSED = "residata_trial_banner_until";   // unix ms — banner hidden until this time

// Both promo surfaces gate on the SAME predicate — useCapabilities().showTrialOffer
// (anon visitor OR logged-in free user who can still start the trial). That single
// source of truth is defined in useCapabilities; nothing here re-derives it, so the
// banner and popup can never disagree about who's eligible.

// ────────────────────────────────────────────────────────────
// Top banner
// ────────────────────────────────────────────────────────────
export function TrialBanner({ lang = "sk", onCta }) {
  const [hidden, setHidden] = useState(true);
  const { showTrialOffer: eligible } = useCapabilities();
  const L = (sk, en) => lang === "sk" ? sk : en;
  const bannerRef = useRef(null);

  useEffect(() => {
    if (!eligible) { setHidden(true); return; }
    try {
      const dismissedUntil = Number(localStorage.getItem(KEY_BANNER_DISMISSED) || 0);
      setHidden(Date.now() < dismissedUntil);
    } catch { setHidden(false); }
  }, [eligible]);

  // Side-effect: when the banner is visible, add a body class that
  // pushes the existing fixed Nav down by 36px so the two don't
  // overlap. CSS rule lives in the inline style block at App.jsx.
  // Clean-up on unmount / dismiss removes the class so layout snaps
  // back to default.
  useLayoutEffect(() => {
    const show = eligible && !hidden;
    const cls = "residata-has-trial-banner";
    if (typeof document === "undefined") return;
    if (show) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [eligible, hidden]);

  // Publish the banner's REAL height as --trial-banner-h so the fixed Nav +
  // Ticker offset by exactly that, at any width. The text wraps to 2–3 lines on
  // a narrow phone, so a hardcoded 44px offset would let the banner overlap the
  // nav — measuring removes that magic number. Re-measures on resize + lang
  // change (different copy ⇒ different height).
  useLayoutEffect(() => {
    const show = eligible && !hidden;
    const root = typeof document !== "undefined" ? document.documentElement : null;
    if (!root) return;
    if (!show) { root.style.removeProperty("--trial-banner-h"); return; }
    const el = bannerRef.current;
    if (!el) return;
    const apply = () => root.style.setProperty("--trial-banner-h", el.offsetHeight + "px");
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--trial-banner-h");
    };
  }, [eligible, hidden, lang]);

  if (!eligible || hidden) return null;

  const dismiss = () => {
    try { localStorage.setItem(KEY_BANNER_DISMISSED, String(Date.now() + 7 * 86400 * 1000)); } catch (_) {}
    track("trial_banner_dismissed");
    setHidden(true);
  };
  const click = () => {
    track("trial_banner_clicked");
    if (onCta) onCta();
  };

  return (
    <div ref={bannerRef} role="region" aria-label={L("Akcia", "Promotion")} style={{
      position: "fixed",
      top: 0, left: 0, right: 0,
      zIndex: "var(--z-banner)",
      background: "linear-gradient(90deg, rgba(0,229,160,0.18), rgba(0,229,160,0.08) 60%, rgba(0,229,160,0.04))",
      borderBottom: "1px solid rgba(0,229,160,0.35)",
      color: "var(--text)",
      fontSize: "0.78rem",
      // top inset clears the notch/status bar; side insets clear landscape cutouts
      padding: "calc(0.5rem + var(--safe-top)) max(1rem, var(--safe-right)) 0.5rem max(1rem, var(--safe-left))",
      // wrap so the Activate/✕ buttons drop below the text on a ~320px phone
      // instead of clipping past the edge.
      display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem 0.75rem", flexWrap: "wrap",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
    }}>
      <span style={{ fontSize: "0.95rem" }}>🎁</span>
      <span style={{ flex: "0 1 auto", textAlign: "center", lineHeight: 1.4 }}>
        <strong style={{ color: "#00e5a0", fontWeight: 700 }}>
          {L("7 dní zadarmo", "7 days free")}
        </strong>{" "}
        {/* full copy on wider screens, punchy short copy on phones (see responsive.css) */}
        <span className="trial-banner-long">— {L(
          "celý Residata: analytika, reporty, AI asistent. Žiadna karta.",
          "the full Residata: analytics, reports, AI assistant. No card required.",
        )}</span>
        <span className="trial-banner-short">— {L("plný prístup, bez karty.", "full access, no card.")}</span>
      </span>
      <button onClick={click}
        style={{
          background: "#00e5a0", color: "var(--bg)",
          border: "none", borderRadius: 6,
          padding: "0.3rem 0.85rem",
          fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem",
          cursor: "pointer",
          letterSpacing: "0.02em",
        }}>
        {L("Aktivovať", "Activate")}
      </button>
      <button onClick={dismiss}
        aria-label={L("Zavrieť banner", "Dismiss banner")}
        title={L("Skryť na týždeň", "Hide for a week")}
        style={{
          background: "transparent", border: "none",
          color: "rgba(232,232,237,0.55)", cursor: "pointer",
          fontSize: "0.95rem", lineHeight: 1, padding: "0 0.25rem",
          fontFamily: "inherit",
        }}
        onMouseEnter={e => e.currentTarget.style.color = "var(--text)"}
        onMouseLeave={e => e.currentTarget.style.color = "rgba(232,232,237,0.55)"}
      >✕</button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Popup (one-shot per day)
// ────────────────────────────────────────────────────────────
export function TrialPopup({ lang = "sk", onCta }) {
  const [open, setOpen] = useState(false);
  // Conversion nudge for anyone who can still start the trial: anon visitors we
  // want to sign up, AND logged-in free users who haven't activated it yet
  // (Boss rule: the offer keeps popping until they actually start the trial).
  // Fires on EVERY marketing page load (incl. refresh) so it's impossible to
  // miss. The moment the trial is active / used / the user is paid|admin,
  // showTrialOffer flips false and it never shows again.
  const { showTrialOffer: eligible } = useCapabilities();
  const L = (sk, en) => lang === "sk" ? sk : en;

  useEffect(() => {
    if (!eligible) { setOpen(false); return; }
    // No suppression flag — fire on every fresh page load (a refresh re-mounts
    // this component and re-runs this effect). Internal SPA navigation keeps it
    // mounted, so it does NOT re-pop on every click; dismissing closes it for
    // the current page view and the next load/refresh brings it back. Delay so
    // the page paints first (less pushy).
    const t = setTimeout(() => {
      setOpen(true);
      track("trial_popup_shown");
    }, 1500);
    return () => clearTimeout(t);
  }, [eligible]);

  if (!open) return null;

  const close = (reason) => {
    track("trial_popup_dismissed", { reason });
    setOpen(false);
  };
  const cta = () => {
    track("trial_popup_clicked");
    setOpen(false);
    if (onCta) onCta();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-popup-title"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        // z-popup per the index.css ladder — above the floating pills (2000) so
        // they don't bleed over this promo, but BELOW the auth modal (--z-modal):
        // a sign-up/login modal must always win over a marketing nudge, so if the
        // login modal is open this promo can never paint over it.
        zIndex: "var(--z-popup)",
        display: "flex", alignItems: "center", justifyContent: "center",
        // safe-area padding keeps the card + close button clear of the notch
        padding: "max(1rem, var(--safe-top)) max(1rem, var(--safe-right)) max(1rem, var(--safe-bottom)) max(1rem, var(--safe-left))",
        animation: "trialPopupBg 0.25s ease-out",
      }}
      onClick={e => { if (e.target === e.currentTarget) close("backdrop"); }}
    >
      <style>{`
        @keyframes trialPopupBg { from { opacity: 0; } to { opacity: 1; } }
        @keyframes trialPopupCard { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
      <div style={{
        background: "linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)",
        border: "1px solid rgba(0,229,160,0.4)",
        borderRadius: 16,
        padding: "2rem 2.25rem",
        maxWidth: 460, width: "100%",
        boxShadow: "0 30px 80px rgba(0,0,0,0.7), 0 0 60px rgba(0,229,160,0.1)",
        animation: "trialPopupCard 0.3s ease-out",
        position: "relative",
      }}>
        <button
          onClick={() => close("close_x")}
          aria-label={L("Zavrieť", "Close")}
          style={{
            position: "absolute", top: 14, right: 14,
            background: "transparent", border: "none", color: "var(--text-dim)",
            fontSize: "1.1rem", cursor: "pointer", padding: "0.25rem 0.5rem",
            fontFamily: "inherit", lineHeight: 1,
          }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--text)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--text-dim)"}
        >✕</button>

        <div style={{
          fontSize: "2.5rem", marginBottom: "0.6rem", lineHeight: 1,
        }}>🎁</div>

        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
          color: "#00e5a0", letterSpacing: "0.14em", textTransform: "uppercase",
          fontWeight: 700, marginBottom: "0.35rem",
        }}>
          {L("Darček pre teba", "A gift for you")}
        </div>

        <h2 id="trial-popup-title" style={{
          fontSize: "1.4rem", fontWeight: 700, color: "var(--text)",
          letterSpacing: "-0.02em", margin: "0 0 0.6rem", lineHeight: 1.25,
        }}>
          {L("7 dní plného Residata — zadarmo", "7 days of the full Residata — on us")}
        </h2>

        <p style={{
          color: "var(--text-2)", fontSize: "0.9rem", lineHeight: 1.55,
          margin: "0 0 1rem",
        }}>
          {L(
            "Vyskúšaj všetky projekty, analytiku, reporty, exporty + AI asistenta na týždeň naplno.",
            "Try every project, analytics, reports, exports + the AI assistant for a full week.",
          )}
        </p>

        <ul style={{
          color: "var(--text-2)", fontSize: "0.82rem", lineHeight: 1.65,
          margin: "0 0 1.25rem", paddingLeft: "1.1rem",
        }}>
          <li><strong style={{ color: "var(--text)" }}>{L("Bez karty", "No card required")}</strong> — {L("kartu pýtame až keby si chcel pokračovať.", "we only ask for a card if you continue afterwards.")}</li>
          <li><strong style={{ color: "var(--text)" }}>{L("Bez strhávania", "No auto-charge")}</strong> — {L("po 7 dňoch jednoducho padneš späť na free.", "after 7 days you simply drop back to the free tier.")}</li>
          <li><strong style={{ color: "var(--text)" }}>30-{L("sekundový signup", "second signup")}</strong> — {L("email + heslo, viac netreba.", "email + password, that's all.")}</li>
        </ul>

        <button onClick={cta}
          style={{
            display: "block", width: "100%",
            background: "#00e5a0", color: "var(--bg)",
            border: "none", borderRadius: 8,
            padding: "0.85rem 1rem",
            fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.88rem",
            cursor: "pointer", letterSpacing: "0.02em",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,229,160,0.4)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "none"; }}
        >
          {L("Aktivovať 7-dňový trial", "Activate 7-day trial")}
        </button>

        <button onClick={() => close("maybe_later")}
          style={{
            display: "block", width: "100%",
            background: "transparent", color: "var(--text-dim)",
            border: "none", borderRadius: 8,
            padding: "0.7rem 1rem", marginTop: "0.4rem",
            fontFamily: "inherit", fontSize: "0.78rem",
            cursor: "pointer",
          }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--text)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--text-dim)"}
        >
          {L("Možno neskôr", "Maybe later")}
        </button>

        <p style={{
          color: "var(--text-faint)", fontSize: "0.68rem",
          margin: "0.85rem 0 0", textAlign: "center",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {L("Otvorí sa znova keď nabudúce otvoríš Residata.", "Re-appears next time you open Residata.")}
        </p>
      </div>
    </div>
  );
}
