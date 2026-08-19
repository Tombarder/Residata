import { useState } from "react";
import { supabase } from "../lib/supabase";
import Picker from "./Picker";
import { useAuth } from "../lib/useAuth";
import { getLiveT } from "../lib/liveLang";
import { track } from "../lib/track";
import { cleanText, cleanUrl, cleanPhone } from "../lib/sanitize";
import { hasTrialIntent, clearTrialIntent, activateTrial } from "../lib/trial";

/**
 * Did the row actually get written? Used whenever the save LOOKS like it failed —
 * the write and the answer to "did it work" travel separately, so a lost response
 * is not proof of a lost write. Deliberately quiet: any problem reading it means
 * we fall through to the normal error path with the form still filled in.
 */
async function profileAlreadyComplete(userId) {
  try {
    const { data } = await supabase
      .from("user_profiles").select("profile_completed").eq("id", userId).maybeSingle();
    return !!data?.profile_completed;
  } catch {
    return false;
  }
}

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
  const t = getLiveT(lang);
  const { user, setProfile, signOut } = useAuth();
  const [form, setForm] = useState({
    full_name: "", company: "", position: "", linkedin_url: "", phone: "",
  });
  // "form" (initial) | "saving" (button disabled) | "error" (rollback)
  const [state, setState] = useState("form");
  const [err, setErr] = useState(null);
  // A slow save says so instead of silently reloading the page out from under them.
  const [slow, setSlow] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name || !form.company || !form.position) {
      setErr(lang === "sk" ? "Meno, spoločnosť a pozícia sú povinné" : "Name, company and position are required");
      return;
    }
    setErr(null);
    setState("saving");
    setSlow(false);
    const slowHint = setTimeout(() => setSlow(true), 6000);
    const t0 = performance.now();
    if (import.meta.env.DEV) console.log(`[CompleteProfile] submit start`, { user: user?.id });

    // NO reload race here. There used to be a 10-second "safety net" that
    // hard-reloaded to /app if the save hadn't finished — and it was the reason
    // a real sign-up (2026-08-19 07:47) bounced back to a BLANK form: the write
    // on this client is allowed 35s (DATA_FETCH_TIMEOUT_MS), so any save taking
    // 10–35s was cancelled mid-flight by the navigation, the form remounted
    // empty, and everything the user had typed was gone. The activity trail
    // shows it exactly: a page_view of /app at 07:47:11 with NO profile_completed
    // event, then the real save 12s later on the second attempt.
    //
    // A safety net that destroys the user's input is worse than the hang it
    // guards against. The request is already bounded — if it fails we land in
    // catch(), show the error, and the form KEEPS what they typed so retry is
    // one click. `slow` only changes the button label, never the page.

    try {
      // Sanitize at the intake boundary — see src/lib/sanitize.js for why.
      // cleanText strips HTML tag chars, control chars, and leading CSV-
      // formula triggers (=, +, @). cleanUrl rejects non-http(s) schemes
      // (no javascript:, data:, etc). cleanPhone trims to digit-like chars.
      const cleanedName    = cleanText(form.full_name, { max: 120 });
      const cleanedCompany = cleanText(form.company,   { max: 120 });
      const cleanedPosition = cleanText(form.position, { max: 60 });
      const cleanedLinkedIn = cleanUrl(form.linkedin_url, { max: 500 });
      const cleanedPhone    = cleanPhone(form.phone, { max: 32 });

      // Re-validate after sanitization — if someone tries to submit only
      // dangerous characters, cleanedName ends up empty and we reject.
      if (!cleanedName || !cleanedCompany || !cleanedPosition) {
        setState("form");
        setErr(lang === "sk"
          ? "Meno, spoločnosť a pozícia nesmú byť prázdne ani obsahovať iba špeciálne znaky."
          : "Name, company and position cannot be empty or only special characters.");
        return;
      }

      const { data, error } = await supabase.from("user_profiles").update({
        full_name: cleanedName,
        company: cleanedCompany,
        position: cleanedPosition,
        linkedin_url: cleanedLinkedIn || null,
        phone: cleanedPhone || null,
        profile_completed: true,
      }).eq("id", user.id).select();

      if (import.meta.env.DEV) console.log(`[CompleteProfile] update returned after ${Math.round(performance.now() - t0)}ms`, { hasData: !!data?.length, error });

      if (error || !data || data.length === 0) {
        clearTimeout(slowHint);
        if (import.meta.env.DEV) console.error("[CompleteProfile] save did not confirm", error);
        // The write may STILL have landed — a dropped response, an aborted fetch
        // or a returning-rows quirk all look like failure here while the row is
        // already committed. Ask the database what it actually holds before
        // telling the user their details were lost, otherwise we send someone
        // whose profile IS complete back to fill the same form again.
        if (await profileAlreadyComplete(user.id)) {
          window.location.replace("/app");
          return;
        }
        setState("error");
        setErr(error
          ? `${error.message}${error.details ? " — " + error.details : ""}`
          : (lang === "sk"
              ? "Údaje sa neuložili. Skús to prosím znova — nič si nemusíš prepisovať."
              : "Your details weren't saved. Please try again — nothing you typed was lost."));
        return;
      }

      track("profile_completed", {
        company: cleanedCompany,
        position: cleanedPosition,
        has_linkedin: !!cleanedLinkedIn,
        has_phone: !!cleanedPhone,
      });
      if (import.meta.env.DEV) console.log(`[CompleteProfile] success · ${Math.round(performance.now() - t0)}ms · hard-redirect to /app`, data[0]);

      // Update shared context first so in-memory state matches DB.
      setProfile(data[0]);

      // Honour the "30s sign-up → 7-day trial" promise: if the user arrived
      // via a trial CTA (intent flag set while anon), auto-start their trial
      // now that the auto-approve trigger has flipped them to 'free'. Best-
      // effort — never block the redirect on it; the endpoint refuses double-
      // trials so this is safe even if somehow retried.
      if (hasTrialIntent()) {
        try { await activateTrial(); } catch (_) { /* non-fatal — they can start it from Billing */ }
        clearTrialIntent();
      }

      // Hard redirect to /app (platform dashboard) — reliable unmount + clean
      // state. The previous approach (setProfile + pushRoute, relying on React
      // re-render to unmount CompleteProfile) sometimes stalled in practice.
      // A full page reload here is overkill for a happy path but cheap and
      // 100 % reliable. New users land directly in the platform, as they should.
      clearTimeout(slowHint);
      window.location.replace("/app");
    } catch (e) {
      clearTimeout(slowHint);
      if (import.meta.env.DEV) console.error("[CompleteProfile] exception", e);
      // Same reasoning as above: a thrown fetch (abort / timeout / dropped
      // socket) says nothing about whether the row was written.
      if (await profileAlreadyComplete(user.id)) {
        window.location.replace("/app");
        return;
      }
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
      // flex-start + margin:auto on the child centers when it fits, scrolls from
      // the top when taller than the viewport (center would clip the top).
      display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: "var(--z-modal)",
      padding: "max(1rem, var(--safe-top)) max(1rem, var(--safe-right)) max(1rem, var(--safe-bottom)) max(1rem, var(--safe-left))",
      overflowY: "auto",
    }}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
        padding: "2.25rem 2rem", maxWidth: 480, width: "100%", margin: "auto 0",
      }}>
        {state === "error" ? (
          // ROLLBACK — something went wrong, let user retry
          <div style={{ padding: "0.5rem 0" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem", textAlign: "center" }}>⚠</div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, textAlign: "center", marginBottom: "0.75rem", color: "var(--text)" }}>
              {lang === "sk" ? "Uloženie zlyhalo" : "Save failed"}
            </h2>
            <p style={{ color: "#ff6b6b", fontSize: "0.85rem", textAlign: "center", marginBottom: "1.5rem", lineHeight: 1.5 }}>
              {err}
            </p>
            <button onClick={retry} style={{
              width: "100%", padding: "0.85rem", background: "var(--accent)", color: "var(--bg)",
              fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: "0.95rem",
            }}>
              {lang === "sk" ? "Skúsiť znova" : "Try again"}
            </button>
            <button type="button" onClick={() => signOut()} style={{
              width: "100%", padding: "0.5rem", background: "transparent", color: "var(--text-faint)",
              border: "none", fontSize: "0.75rem", cursor: "pointer", marginTop: "0.75rem",
            }}>{t.cp_signout} ({user?.email})</button>
          </div>
        ) : (
          // DEFAULT — the form
          <>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "var(--accent)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
              {lang === "sk" ? "Krok 2 z 2" : "Step 2 of 2"}
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.5rem", color: "var(--text)" }}>{t.cp_title}</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", lineHeight: 1.6, marginBottom: "1.5rem" }}>
              {t.cp_desc}
            </p>

            <form onSubmit={submit}>
              <Field label={t.cp_name} required>
                <input value={form.full_name} maxLength={120} autoComplete="name" onChange={e => setForm({...form, full_name: e.target.value})} placeholder={t.cp_name_ph} style={fieldStyle} />
              </Field>
              <Field label={t.cp_company} required>
                <input value={form.company} maxLength={120} autoComplete="organization" onChange={e => setForm({...form, company: e.target.value})} placeholder={t.cp_company_ph} style={fieldStyle} />
              </Field>
              <Field label={t.cp_position} required>
                <Picker
                  value={form.position}
                  onChange={(v) => setForm({...form, position: v})}
                  options={positions.filter(p => !p.disabled).map(p => ({ value: p.v, label: p.label }))}
                  placeholder={t.cp_position_any}
                  sk={lang === "sk"}
                />
              </Field>
              <Field label={t.cp_linkedin}>
                <input type="url" value={form.linkedin_url} maxLength={500} autoComplete="url" onChange={e => setForm({...form, linkedin_url: e.target.value})} placeholder={t.cp_linkedin_ph} style={fieldStyle} />
              </Field>
              <Field label={t.cp_phone}>
                <input type="tel" value={form.phone} maxLength={32} autoComplete="tel" onChange={e => setForm({...form, phone: e.target.value})} placeholder={t.cp_phone_ph} style={fieldStyle} />
              </Field>

              {err && <div style={{ color: "#ff6b6b", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{err}</div>}

              <button
                type="submit"
                disabled={state === "saving"}
                style={{
                  width: "100%", padding: "0.85rem", background: "var(--accent)", color: "var(--bg)",
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
                    border: "2px solid var(--bg)",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                    animation: "cp-spin 0.7s linear infinite",
                  }} />
                )}
                {state === "saving"
                  ? (slow ? (lang === "sk" ? "Stále ukladám…" : "Still saving…")
                          : (lang === "sk" ? "Ukladám…" : "Saving…"))
                  : t.cp_submit}
              </button>

              <button type="button" onClick={() => signOut()} disabled={state === "saving"} style={{
                width: "100%", padding: "0.5rem", background: "transparent", color: "var(--text-faint)",
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
      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: "0.35rem", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label} {required && <span style={{ color: "var(--accent)" }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const fieldStyle = {
  width: "100%", padding: "0.65rem 0.85rem", background: "var(--surface-2)",
  border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)",
  fontSize: "0.9rem", fontFamily: "inherit", boxSizing: "border-box", outline: "none",
};
