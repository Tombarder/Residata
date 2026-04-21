import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";
import { liveT } from "../lib/liveLang";
import { track } from "../lib/track";

/**
 * Povinný post-login krok. Renderuje sa ako full-screen overlay ak
 * user je authenticated + profile.profile_completed === false.
 * Nemá close button — musí sa vyplniť alebo odhlásiť.
 *
 * OPTIMISTIC UI: po kliku Save hneď prepneme na "Application received ✓"
 * obrazovku. Ukladanie beží na pozadí. Ak reálne zlyhá, vrátime formulár
 * a ukážeme chybu. Tým odstraňujeme pocit "Saving... 10-15s" delay.
 * Reálne merania ukazujú server-side ~200 ms, takže v 99 % prípadov user
 * uvidí success screen a hneď po nej PendingGate (app re-render).
 */
export default function CompleteProfile({ lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { user, reloadProfile, signOut } = useAuth();
  const [form, setForm] = useState({
    full_name: "", company: "", position: "", linkedin_url: "", phone: "",
  });
  // "form" (initial) | "submitted" (optimistic success) | "error" (rollback)
  const [state, setState] = useState("form");
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name || !form.company || !form.position) {
      setErr(lang === "sk" ? "Meno, spoločnosť a pozícia sú povinné" : "Name, company and position are required");
      return;
    }
    setErr(null);
    // OPTIMISTIC — switch to success screen immediately, do save in background.
    setState("submitted");
    console.log("[CompleteProfile] optimistic submit for", user?.id, form);

    try {
      const { data, error } = await supabase.from("user_profiles").update({
        full_name: form.full_name.trim(),
        company: form.company.trim(),
        position: form.position,
        linkedin_url: form.linkedin_url.trim() || null,
        phone: form.phone.trim() || null,
        profile_completed: true,
      }).eq("id", user.id).select();

      if (error) {
        console.error("[CompleteProfile] ERROR", error);
        setState("error");
        setErr(`${error.message}${error.details ? " — " + error.details : ""}`);
        return;
      }
      if (!data || data.length === 0) {
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
      console.log("[CompleteProfile] success, reloading profile");
      // Once reloadProfile finishes, App.jsx re-renders — profile.profile_completed=true
      // means this component unmounts and PendingGate takes over. The success screen
      // below is only visible for the duration of the actual save (~500ms typically).
      await reloadProfile();
    } catch (e) {
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
        {state === "submitted" ? (
          // OPTIMISTIC SUCCESS SCREEN — shown immediately after click.
          // Freemium: DB auto-trigger flips tier → 'free' synchronously with
          // the profile-completed UPDATE. By the time reloadProfile() returns,
          // the App.jsx render sees the real profile and swaps us out for the
          // free-tier dashboard. Usually visible <500ms.
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🎉</div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
              color: "#00e5a0", letterSpacing: "0.15em", textTransform: "uppercase",
              marginBottom: "0.75rem",
            }}>
              {lang === "sk" ? "Vitaj" : "Welcome"}
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.75rem", color: "#e8e8ed" }}>
              {lang === "sk" ? "Si v hre!" : "You're in!"}
            </h2>
            <p style={{ fontSize: "0.9rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
              {lang === "sk"
                ? "Free účet aktivovaný. Presmerovávam na dashboard…"
                : "Free account activated. Redirecting you to the dashboard…"}
            </p>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              fontSize: "0.75rem", color: "#8a8a96",
              fontFamily: "'JetBrains Mono', monospace", marginTop: "0.5rem",
            }}>
              <span style={{
                width: 10, height: 10, border: "2px solid #00e5a0",
                borderTopColor: "transparent", borderRadius: "50%",
                animation: "cp-spin 0.8s linear infinite",
              }} />
              {lang === "sk" ? "načítavam profil…" : "loading profile…"}
            </div>
            <style>{`@keyframes cp-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : state === "error" ? (
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

              <button type="submit" style={{
                width: "100%", padding: "0.85rem", background: "#00e5a0", color: "#0a0a0b",
                fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: "0.95rem", marginTop: "0.5rem",
              }}>{t.cp_submit}</button>

              <button type="button" onClick={signOut} style={{
                width: "100%", padding: "0.5rem", background: "transparent", color: "#55555f",
                border: "none", fontSize: "0.75rem", cursor: "pointer", marginTop: "0.75rem",
              }}>{t.cp_signout} ({user?.email})</button>
            </form>
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
