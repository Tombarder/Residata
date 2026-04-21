import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";
import { liveT } from "../lib/liveLang";
import { track } from "../lib/track";

/**
 * Povinný post-login krok. Full-screen overlay ak user je authenticated +
 * profile.profile_completed === false. Žiadny close button.
 *
 * FLOW (freemium + direct context update):
 *   1. Klik Save → state='saving' (form disabled, tiny spinner on button)
 *   2. supabase UPDATE profile_completed=true  → DB trigger auto-sets
 *      tier='free' and approved_at=NOW() synchronously.
 *   3. UPDATE returns the fresh row. We push it DIRECTLY into AuthContext
 *      via setProfile(). No round-trip reloadProfile() needed, no wait.
 *   4. App.jsx sees profile_completed=true → unmounts us → dashboard shows.
 *   5. We also pushRoute("Live") so the URL + page match explicitly, even
 *      if something delays the re-render.
 *
 * Before this: we had an "optimistic success" screen that sat at "Loading
 * profile…" for N seconds because reloadProfile() was causing a stale-
 * closure race. The direct setProfile approach makes the transition
 * instant — the form submit resolves, the new profile hits context, and
 * the parent unmounts the overlay in the same render tick.
 */
export default function CompleteProfile({ lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { user, setProfile, signOut } = useAuth();
  const [form, setForm] = useState({
    full_name: "", company: "", position: "", linkedin_url: "", phone: "",
  });
  // "form" (initial) | "saving" (button disabled) | "error" (rollback)
  const [state, setState] = useState("form");
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name || !form.company || !form.position) {
      setErr(lang === "sk" ? "Meno, spoločnosť a pozícia sú povinné" : "Name, company and position are required");
      return;
    }
    setErr(null);
    setState("saving");
    const t0 = performance.now();
    console.log(`[CompleteProfile] submit start`, { user: user?.id });

    // Hard-reload fallback — if for any reason the in-app re-render path fails
    // (stale closure, race, network hiccup), force a full page reload to /live
    // after a timeout. Guarantees the user doesn't sit stuck forever.
    const hardReloadFallback = setTimeout(() => {
      console.warn("[CompleteProfile] slow submit — forcing hard reload to /live");
      window.location.replace("/live");
    }, 10000);

    try {
      const { data, error } = await supabase.from("user_profiles").update({
        full_name: form.full_name.trim(),
        company: form.company.trim(),
        position: form.position,
        linkedin_url: form.linkedin_url.trim() || null,
        phone: form.phone.trim() || null,
        profile_completed: true,
      }).eq("id", user.id).select();

      console.log(`[CompleteProfile] update returned after ${Math.round(performance.now() - t0)}ms`, { hasData: !!data?.length, error });

      if (error) {
        clearTimeout(hardReloadFallback);
        console.error("[CompleteProfile] ERROR", error);
        setState("error");
        setErr(`${error.message}${error.details ? " — " + error.details : ""}`);
        return;
      }
      if (!data || data.length === 0) {
        clearTimeout(hardReloadFallback);
        setState("error");
        setErr(lang === "sk"
          ? "Update sa nezapísal (RLS / prihlasovací token). Skús sa odhlásiť a prihlásiť znova."
          : "Update didn't persist (RLS / session issue). Try signing out and back in.");
        return;
      }

      track("profile_completed", {
        company: form.company.trim(),
        position: form.position,
        has_linkedin: !!form.linkedin_url.trim(),
        has_phone: !!form.phone.trim(),
      });
      console.log(`[CompleteProfile] success · ${Math.round(performance.now() - t0)}ms · hard-redirect to /live`, data[0]);

      // Update shared context first so in-memory state matches DB.
      setProfile(data[0]);

      // Hard redirect to /live — reliable unmount + clean state. The previous
      // approach (setProfile + pushRoute, relying on React re-render to unmount
      // CompleteProfile) sometimes stalled in practice (stale closure race).
      // A full page reload here is overkill for a happy path but cheap and
      // 100 % reliable, and the user sees "Saving…" → dashboard without any
      // "Loading profile…" limbo state.
      clearTimeout(hardReloadFallback);
      window.location.replace("/live");
    } catch (e) {
      clearTimeout(hardReloadFallback);
      console.error("[CompleteProfile] exception", e);
      setState("error");
      setErr(e.message || String(e));
    }
  };

  const retry = () => {
    setState("form");
    setErr(null);
  };

  const positions = [
    { v: "", label: t.cp_position_any, disabled: true },
    { v: "developer", label: t.cp_position_dev },
    { v: "investor", label: t.cp_position_inv },
    { v: "bank", label: t.cp_position_bnk },
    { v: "consultant", label: t.cp_position_con },
    { v: "other", label: t.cp_position_oth },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(10,10,11,0.95)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: "1rem",
      overflowY: "auto",
    }}>
      <div style={{
        background: "#16161a", border: "1px solid #222228", borderRadius: 14,
        padding: "2.25rem 2rem", maxWidth: 480, width: "100%",
      }}>
        {state === "error" ? (
          // ROLLBACK — something went wrong, let user retry
          <div style={{ padding: "0.5rem 0" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem", textAlign: "center" }}>⚠</div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, textAlign: "center", marginBottom: "0.75rem", color: "#e8e8ed" }}>
              {lang === "sk" ? "Uloženie zlyhalo" : "Save failed"}
            </h2>
            <p style={{ color: "#ff6b6b", fontSize: "0.85rem", textAlign: "center", marginBottom: "1.5rem", lineHeight: 1.5 }}>
              {err}
            </p>
            <button onClick={retry} style={{
              width: "100%", padding: "0.85rem", background: "#00e5a0", color: "#0a0a0b",
              fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: "0.95rem",
            }}>
              {lang === "sk" ? "Skúsiť znova" : "Try again"}
            </button>
            <button type="button" onClick={signOut} style={{
              width: "100%", padding: "0.5rem", background: "transparent", color: "#55555f",
              border: "none", fontSize: "0.75rem", cursor: "pointer", marginTop: "0.75rem",
            }}>{t.cp_signout} ({user?.email})</button>
          </div>
        ) : (
          // DEFAULT — the form
          <>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
              {lang === "sk" ? "Krok 2 z 2" : "Step 2 of 2"}
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.5rem", color: "#e8e8ed" }}>{t.cp_title}</h2>
            <p style={{ fontSize: "0.85rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1.5rem" }}>
              {t.cp_desc}
            </p>

            <form onSubmit={submit}>
              <Field label={t.cp_name} required>
                <input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} placeholder={t.cp_name_ph} style={fieldStyle} />
              </Field>
              <Field label={t.cp_company} required>
                <input value={form.company} onChange={e => setForm({...form, company: e.target.value})} placeholder={t.cp_company_ph} style={fieldStyle} />
              </Field>
              <Field label={t.cp_position} required>
                <select value={form.position} onChange={e => setForm({...form, position: e.target.value})} style={fieldStyle}>
                  {positions.map(p => <option key={p.v} value={p.v} disabled={p.disabled}>{p.label}</option>)}
                </select>
              </Field>
              <Field label={t.cp_linkedin}>
                <input type="url" value={form.linkedin_url} onChange={e => setForm({...form, linkedin_url: e.target.value})} placeholder={t.cp_linkedin_ph} style={fieldStyle} />
              </Field>
              <Field label={t.cp_phone}>
                <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder={t.cp_phone_ph} style={fieldStyle} />
              </Field>

              {err && <div style={{ color: "#ff6b6b", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{err}</div>}

              <button
                type="submit"
                disabled={state === "saving"}
                style={{
                  width: "100%", padding: "0.85rem", background: "#00e5a0", color: "#0a0a0b",
                  fontWeight: 600, borderRadius: 8, border: "none",
                  cursor: state === "saving" ? "wait" : "pointer",
                  fontSize: "0.95rem", marginTop: "0.5rem",
                  opacity: state === "saving" ? 0.7 : 1,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                }}
              >
                {state === "saving" && (
                  <span style={{
                    width: 14, height: 14,
                    border: "2px solid #0a0a0b",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "cp-spin 0.7s linear infinite",
                  }} />
                )}
                {state === "saving" ? (lang === "sk" ? "Ukladám…" : "Saving…") : t.cp_submit}
              </button>

              <button type="button" onClick={signOut} disabled={state === "saving"} style={{
                width: "100%", padding: "0.5rem", background: "transparent", color: "#55555f",
                border: "none", fontSize: "0.75rem", cursor: state === "saving" ? "wait" : "pointer", marginTop: "0.75rem",
                opacity: state === "saving" ? 0.5 : 1,
              }}>{t.cp_signout} ({user?.email})</button>
            </form>
            <style>{`@keyframes cp-spin { to { transform: rotate(360deg); } }`}</style>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: "0.85rem" }}>
      <label style={{ display: "block", fontSize: "0.75rem", color: "#8a8a96", marginBottom: "0.35rem", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label} {required && <span style={{ color: "#00e5a0" }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const fieldStyle = {
  width: "100%", padding: "0.65rem 0.85rem", background: "#0e0e10",
  border: "1px solid #222228", borderRadius: 8, color: "#e8e8ed",
  fontSize: "0.9rem", fontFamily: "inherit", boxSizing: "border-box", outline: "none",
};
