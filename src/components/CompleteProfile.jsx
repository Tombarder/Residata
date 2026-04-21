import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";
import { liveT } from "../lib/liveLang";
import { track } from "../lib/track";

/**
 * Povinný post-login krok. Renderuje sa ako full-screen overlay ak
 * user je authenticated + profile.profile_completed === false.
 * Nemá close button — musí sa vyplniť alebo odhlásiť.
 */
export default function CompleteProfile({ lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { user, profile, reloadProfile, signOut } = useAuth();
  const [form, setForm] = useState({
    full_name: "", company: "", position: "", linkedin_url: "", phone: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name || !form.company || !form.position) {
      setErr(lang === "sk" ? "Meno, spoločnosť a pozícia sú povinné" : "Name, company and position are required");
      return;
    }
    setBusy(true); setErr(null);
    console.log("[CompleteProfile] submitting for", user?.id, form);

    try {
      // Timeout safety — ak Supabase nemá odozvu do 10s, bail out
      const updatePromise = supabase.from("user_profiles").update({
        full_name: form.full_name.trim(),
        company: form.company.trim(),
        position: form.position,
        linkedin_url: form.linkedin_url.trim() || null,
        phone: form.phone.trim() || null,
        profile_completed: true,
      }).eq("id", user.id).select();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout — server took too long")), 10000)
      );

      const result = await Promise.race([updatePromise, timeoutPromise]);
      console.log("[CompleteProfile] update result:", result);
      setBusy(false);

      if (result.error) {
        console.error("[CompleteProfile] ERROR", result.error);
        setErr(`${result.error.message}${result.error.details ? " — " + result.error.details : ""}`);
        return;
      }
      if (!result.data || result.data.length === 0) {
        setErr(lang === "sk"
          ? "Update sa nezapísal (RLS / prihlasovací token). Skús sa odhlásiť a znova prihlásiť."
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
      await reloadProfile();
    } catch (e) {
      console.error("[CompleteProfile] exception", e);
      setBusy(false);
      setErr(e.message || String(e));
    }
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
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          Step 2 of 2
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

          <button type="submit" disabled={busy} style={{
            width: "100%", padding: "0.85rem", background: "#00e5a0", color: "#0a0a0b",
            fontWeight: 600, borderRadius: 8, border: "none", cursor: busy ? "wait" : "pointer",
            fontSize: "0.95rem", opacity: busy ? 0.6 : 1, marginTop: "0.5rem",
          }}>{busy ? t.cp_submitting : t.cp_submit}</button>

          <button type="button" onClick={signOut} style={{
            width: "100%", padding: "0.5rem", background: "transparent", color: "#55555f",
            border: "none", fontSize: "0.75rem", cursor: "pointer", marginTop: "0.75rem",
          }}>{t.cp_signout} ({user?.email})</button>
        </form>
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
