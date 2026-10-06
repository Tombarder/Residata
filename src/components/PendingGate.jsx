import { useEffect } from "react";
import { getLiveT } from "../lib/liveLang";
import { useAuth } from "../lib/useAuth";

/**
 * Shown instead of Live / ProjectDetail / the platform to a signed-in account
 * whose tier is 'pending' — since sign-ups are approved automatically the moment
 * the profile form is saved, that now means one thing: an admin set the account
 * to "Bez prístupu" (no access). It used to say "Application received … we
 * approve manually, you'll get an e-mail" — a promise nobody would keep.
 *
 * AUTO-REFRESH: every 30 s we quietly re-read the profile, so the moment an admin
 * gives access the page unlocks by itself (App re-renders, this unmounts).
 */
export default function PendingGate({ setCurrent, lang = "en" }) {
  const t = getLiveT(lang);
  const { reloadProfile } = useAuth();

  useEffect(() => {
    const iv = setInterval(() => { reloadProfile(); }, 30000);
    return () => clearInterval(iv);
  }, [reloadProfile]);

  return (
    <main style={{ padding: "6rem 2rem 4rem", maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.75rem", letterSpacing: "-0.02em" }}>
        {t.pending_title}
      </h1>
      <p style={{ color: "var(--text-dim)", fontSize: "0.95rem", lineHeight: 1.7, marginBottom: "1rem" }}>
        {t.pending_body}
      </p>
      <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
        {t.pending_meanwhile}
      </p>

      {/* Live status indicator — reassures user that the page IS checking */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: "0.5rem",
        padding: "0.35rem 0.85rem",
        background: "color-mix(in srgb, var(--accent) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
        borderRadius: 999,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.7rem", color: "var(--accent)", fontWeight: 600,
        letterSpacing: "0.05em", textTransform: "uppercase",
        marginBottom: "1.5rem",
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: "var(--accent)",
          animation: "pg-pulse 1.4s ease-in-out infinite",
        }} />
        {/* No approval is pending — "pending" is an account set to No access.
            What is live is the check: if access is given, this page opens by itself. */}
        {lang === "sk" ? "Bez prístupu · obnoví sa samo" : "No access · updates by itself"}
      </div>

      <div>
        <button className="btn-p" onClick={() => setCurrent && setCurrent("Home")}>
          {t.pending_explore}
        </button>
      </div>

      <style>{`
        @keyframes pg-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
      `}</style>
    </main>
  );
}
