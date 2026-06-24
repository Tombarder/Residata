/**
 * TrialBanner + TrialPopup — marketing-side promotion of the
 * 7-day free trial. Two surfaces, both dismissible:
 *
 *   1. Slim top banner (non-intrusive, always-visible until dismissed)
 *      Shown above the Nav for anon visitors and free-tier signed-in
 *      users who haven't yet used their trial. Dismissal is sticky
 *      for 7 days via localStorage.
 *
 *   2. Modal popup (one-shot per browser session)
 *      Shown to the same audience after a 1.5s delay so it doesn't
 *      pop the moment they land. A sessionStorage flag suppresses it
 *      for the rest of the session — it re-opens the next time the
 *      visitor opens the site after closing it (sessionStorage clears
 *      on tab/browser close). Does not re-pop on reload/navigation.
 *
 * Both hide automatically once the user starts a trial (capability
 * promotion fires `trialActive`) or on paid/admin tier. Both hide
 * on /app/* (the platform has its own Billing CTAs).
 */
import { useEffect, useState } from "react";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { track } from "../lib/track";

const KEY_BANNER_DISMISSED = "residata_trial_banner_until";   // unix ms — banner hidden until this time
const KEY_POPUP_SESSION    = "residata_trial_popup_seen";     // sessionStorage flag — shown once this browser session

/**
 * Decide whether the trial promo surfaces should be shown to the
 * current user. Returns false for paid/admin, trial-active users,
 * and pending users.
 */
function useShouldShowTrialPromo() {
  const { user, profile } = useAuth();
  // F-026: gate on the EFFECTIVE tier (`tier`), not the raw profile column
  // (`baseTier`). Admin-granted paid users still have profile.tier='free'
  // but caps.tier='paid' — the previous baseTier check let them through
  // and the banner pitched a "7-day trial" they already have permanently.
  const { tier, trialActive } = useCapabilities();
  // Anon: always eligible (cold visitor we want to convert)
  if (!user) return true;
  // Pending: don't promote — they need approval first
  if (tier === "pending") return false;
  // Already paid / admin: no point
  if (tier === "paid" || tier === "admin") return false;
  // Free user mid-trial: countdown is on Dashboard, no marketing nudge
  if (trialActive) return false;
  // Free user who already consumed the trial: don't prompt again
  if (profile?.trial_started_at) return false;
  return true;
}

// ────────────────────────────────────────────────────────────
// Top banner
// ────────────────────────────────────────────────────────────
export function TrialBanner({ lang = "sk", onCta }) {
  const [hidden, setHidden] = useState(true);
  const eligible = useShouldShowTrialPromo();
  const L = (sk, en) => lang === "sk" ? sk : en;

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
  useEffect(() => {
    const show = eligible && !hidden;
    const cls = "residata-has-trial-banner";
    if (typeof document === "undefined") return;
    if (show) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [eligible, hidden]);

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
    <div style={{
      position: "fixed",
      top: 0, left: 0, right: 0,
      zIndex: 110,
      background: "linear-gradient(90deg, rgba(0,229,160,0.18), rgba(0,229,160,0.08) 60%, rgba(0,229,160,0.04))",
      borderBottom: "1px solid rgba(0,229,160,0.35)",
      color: "#e8e8ed",
      fontSize: "0.78rem",
      padding: "0.5rem 1rem",
      display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
    }}>
      <span style={{ fontSize: "0.95rem" }}>🎁</span>
      <span style={{ flex: "0 1 auto", textAlign: "center", lineHeight: 1.4 }}>
        <strong style={{ color: "#00e5a0", fontWeight: 700 }}>
          {L("7 dní zadarmo", "7 days free")}
        </strong>{" "}
        — {L(
          "celý Residata: analytika, reporty, AI asistent. Žiadna karta.",
          "the full Residata: analytics, reports, AI assistant. No card required.",
        )}
      </span>
      <button onClick={click}
        style={{
          background: "#00e5a0", color: "#0a0a0b",
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
        onMouseEnter={e => e.currentTarget.style.color = "#e8e8ed"}
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
  const eligible = useShouldShowTrialPromo();
  const L = (sk, en) => lang === "sk" ? sk : en;

  useEffect(() => {
    if (!eligible) { setOpen(false); return; }
    try {
      // Per-SESSION (sessionStorage), not per-day: greet the visitor once each
      // time they open the site fresh. sessionStorage clears when the tab/
      // browser is closed, so the popup re-appears "every time they open the
      // website after closing it" — but does NOT re-pop on in-session reloads
      // or page navigation.
      if (sessionStorage.getItem(KEY_POPUP_SESSION)) { setOpen(false); return; }
      // Delay so it doesn't pop the instant they land — feels less
      // pushy and gives them a chance to look at the page first.
      const t = setTimeout(() => {
        setOpen(true);
        try { sessionStorage.setItem(KEY_POPUP_SESSION, "1"); } catch (_) {}
        track("trial_popup_shown");
      }, 1500);
      return () => clearTimeout(t);
    } catch (_) {}
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
        zIndex: 1500,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
        animation: "trialPopupBg 0.25s ease-out",
      }}
      onClick={e => { if (e.target === e.currentTarget) close("backdrop"); }}
    >
      <style>{`
        @keyframes trialPopupBg { from { opacity: 0; } to { opacity: 1; } }
        @keyframes trialPopupCard { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
      <div style={{
        background: "linear-gradient(180deg, #14141a 0%, #0e0e10 100%)",
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
            background: "transparent", border: "none", color: "#8a8a96",
            fontSize: "1.1rem", cursor: "pointer", padding: "0.25rem 0.5rem",
            fontFamily: "inherit", lineHeight: 1,
          }}
          onMouseEnter={e => e.currentTarget.style.color = "#e8e8ed"}
          onMouseLeave={e => e.currentTarget.style.color = "#8a8a96"}
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
          fontSize: "1.4rem", fontWeight: 700, color: "#e8e8ed",
          letterSpacing: "-0.02em", margin: "0 0 0.6rem", lineHeight: 1.25,
        }}>
          {L("7 dní plného Residata — zadarmo", "7 days of the full Residata — on us")}
        </h2>

        <p style={{
          color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.55,
          margin: "0 0 1rem",
        }}>
          {L(
            "Vyskúšaj všetky projekty, analytiku, reporty, exporty + AI asistenta na týždeň naplno.",
            "Try every project, analytics, reports, exports + the AI assistant for a full week.",
          )}
        </p>

        <ul style={{
          color: "#c4c4cc", fontSize: "0.82rem", lineHeight: 1.65,
          margin: "0 0 1.25rem", paddingLeft: "1.1rem",
        }}>
          <li><strong style={{ color: "#e8e8ed" }}>{L("Bez karty", "No card required")}</strong> — {L("kartu pýtame až keby si chcel pokračovať.", "we only ask for a card if you continue afterwards.")}</li>
          <li><strong style={{ color: "#e8e8ed" }}>{L("Bez strhávania", "No auto-charge")}</strong> — {L("po 7 dňoch jednoducho padneš späť na free.", "after 7 days you simply drop back to the free tier.")}</li>
          <li><strong style={{ color: "#e8e8ed" }}>30-{L("sekundový signup", "second signup")}</strong> — {L("email + heslo, viac netreba.", "email + password, that's all.")}</li>
        </ul>

        <button onClick={cta}
          style={{
            display: "block", width: "100%",
            background: "#00e5a0", color: "#0a0a0b",
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
            background: "transparent", color: "#8a8a96",
            border: "none", borderRadius: 8,
            padding: "0.7rem 1rem", marginTop: "0.4rem",
            fontFamily: "inherit", fontSize: "0.78rem",
            cursor: "pointer",
          }}
          onMouseEnter={e => e.currentTarget.style.color = "#e8e8ed"}
          onMouseLeave={e => e.currentTarget.style.color = "#8a8a96"}
        >
          {L("Možno neskôr", "Maybe later")}
        </button>

        <p style={{
          color: "#55555f", fontSize: "0.68rem",
          margin: "0.85rem 0 0", textAlign: "center",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {L("Otvorí sa znova keď nabudúce otvoríš Residata.", "Re-appears next time you open Residata.")}
        </p>
      </div>
    </div>
  );
}
