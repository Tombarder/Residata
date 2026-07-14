/**
 * AiBetaBanner — beta-mode disclosure for the in-app AI features.
 *
 * Surface scoping (revised after QA — was on every /app/* page,
 * which felt like noise on Dashboard / Reports / Pivot where the
 * AI doesn't show up at all):
 *
 *   · /app/Assistant (full chat page)  → mounted at the top
 *   · FloatingChat panel (marketing)   → mounted INSIDE the panel,
 *                                        compact mode, between
 *                                        header and transcript
 *   · everywhere else                  → not mounted
 *
 * The banner is contextual to AI surfaces, so it only appears where
 * the user is actually about to interact with AI. On other platform
 * pages there's no AI activity — showing it there was confusing
 * ("why is it warning me about something I'm not doing?").
 *
 * Dismissible. Dismissal is sticky for 7 days via localStorage —
 * shared across both surfaces (one disclosure, one dismissal). After
 * the cooldown it reappears once, then resets the timer if dismissed
 * again, so we keep gentle pressure on "this is beta, feedback
 * matters" without hammering returning users.
 *
 * `compact` prop renders a tighter version for the narrow floating
 * chat panel (~360 px wide). Wraps fewer lines, smaller text, no CTA
 * button (the chat panel itself is the feedback surface — pinging
 * the email link from inside a 360-px popover is awkward).
 */
import { useEffect, useState } from "react";

const KEY = "residata_ai_beta_banner_dismissed_until";
const HIDE_DAYS = 7;

const green   = "#00e5a0";
const orange  = "#f5a623";
const dim     = "var(--text-dim)";
const text    = "var(--text)";
const border  = "var(--border)";
const mono    = "'JetBrains Mono', ui-monospace, Menlo, monospace";

function isDismissedNow() {
  try {
    const until = Number(localStorage.getItem(KEY) || 0);
    return Date.now() < until;
  } catch {
    return false;
  }
}

export default function AiBetaBanner({ lang = "sk", compact = false }) {
  // Default `true` so the banner doesn't briefly flash on mount
  // before the localStorage check resolves. The effect immediately
  // flips it to false if there's no active dismissal.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { setDismissed(isDismissedNow()); }, []);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      const until = Date.now() + HIDE_DAYS * 24 * 60 * 60 * 1000;
      localStorage.setItem(KEY, String(until));
    } catch (_) {}
    setDismissed(true);
  };

  const T = lang === "sk" ? {
    icon: "🧪",
    label: "BETA",
    msg: "AI funkcie (chat, narratívy v reportoch) sú v testovacom režime. Konverzácie ukladáme pre interný QA — bez tretích strán.",
    msgCompact: "AI je v testovacom režime. Konverzácie ukladáme pre interný QA.",
    cta: "Spätná väzba",
    dismiss: "Skryť",
  } : {
    icon: "🧪",
    label: "BETA",
    msg: "AI features (chat, report narratives) are in testing mode. Conversations are stored for internal QA — no third parties.",
    msgCompact: "AI is in testing mode. Conversations stored for internal QA.",
    cta: "Send feedback",
    dismiss: "Hide",
  };

  // ── Compact variant (used inside the FloatingChat panel) ─────
  // The floating chat panel is ~360 px wide; the full strip would
  // wrap into 4-5 lines and look chaotic. This trim keeps the
  // disclosure visible on a single line at typical widths and drops
  // the email CTA (the chat itself is the feedback surface).
  if (compact) {
    return (
      <div
        role="status"
        style={{
          background: "rgba(245,166,35,0.08)",
          borderBottom: `1px solid ${orange}33`,
          padding: "0.4rem 0.75rem",
          display: "flex", alignItems: "center", flexWrap: "wrap",
          gap: "0.45rem", fontFamily: mono, fontSize: "0.7rem", color: text,
        }}
      >
        <span style={{
          background: orange, color: "var(--bg)",
          padding: "0.05rem 0.35rem", borderRadius: 3,
          fontSize: "0.56rem", fontWeight: 700, letterSpacing: "0.08em",
        }}>{T.label}</span>
        <span style={{ flex: 1, minWidth: 0, color: text, lineHeight: 1.4 }}>
          {T.msgCompact}
        </span>
        <button
          onClick={dismiss}
          title={T.dismiss}
          aria-label={T.dismiss}
          style={{
            background: "transparent", border: "none",
            color: dim, cursor: "pointer", padding: "0.1rem 0.3rem",
            fontSize: "0.85rem", lineHeight: 1, fontFamily: "inherit",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = text; }}
          onMouseLeave={e => { e.currentTarget.style.color = dim;  }}
        >
          ✕
        </button>
      </div>
    );
  }

  // ── Full strip (used at top of /app/Assistant page) ──────────
  return (
    <div
      role="status"
      style={{
        background: "linear-gradient(90deg, rgba(245,166,35,0.10) 0%, rgba(245,166,35,0.04) 100%)",
        border: `1px solid ${orange}33`,
        borderRadius: 8,
        padding: "0.55rem 1rem",
        marginBottom: "1rem",
        display: "flex", alignItems: "center", flexWrap: "wrap",
        gap: "0.65rem", fontFamily: mono, fontSize: "0.78rem", color: text,
      }}
    >
      <span aria-hidden style={{ fontSize: "1rem", lineHeight: 1 }}>{T.icon}</span>
      <span style={{
        background: orange, color: "var(--bg)",
        padding: "0.1rem 0.45rem", borderRadius: 3,
        fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em",
      }}>{T.label}</span>
      <span style={{ flex: 1, minWidth: 0, color: text, lineHeight: 1.45 }}>
        {T.msg}
      </span>
      <a
        href="mailto:tomas@residata.sk?subject=Residata%20AI%20feedback"
        style={{
          color: green, textDecoration: "none",
          padding: "0.25rem 0.55rem", border: `1px solid ${green}55`,
          borderRadius: 4, fontSize: "0.72rem", whiteSpace: "nowrap",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(0,229,160,0.10)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        {T.cta} →
      </a>
      <button
        onClick={dismiss}
        title={T.dismiss}
        aria-label={T.dismiss}
        style={{
          background: "transparent", border: `1px solid ${border}`,
          color: dim, cursor: "pointer", padding: "0.2rem 0.5rem",
          borderRadius: 4, fontSize: "0.72rem", fontFamily: "inherit",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = text; e.currentTarget.style.borderColor = dim; }}
        onMouseLeave={e => { e.currentTarget.style.color = dim;  e.currentTarget.style.borderColor = border; }}
      >
        ✕
      </button>
    </div>
  );
}
