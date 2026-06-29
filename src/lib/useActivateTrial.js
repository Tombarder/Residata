// src/lib/useActivateTrial.js
//
// One-click trial activation for a logged-in free user, with button state.
// Used by every in-app "Activate trial" / "Start trial" surface so they all
// behave identically: refresh token → POST /api/trial/start → on success
// reload (so the capability layer unlocks paid features), on "already used /
// already paid" hand off to the caller (route to Billing), on session-expired
// show a clean message.

import { useState } from "react";
import { activateTrial, clearTrialIntent } from "./trial";
import { authErrorMessage } from "./sessionGuard";

export function useActivateTrial({ lang = "en", onConsumed, reloadOnSuccess = true } = {}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { kind: "ok" | "err", text }

  const start = async () => {
    if (busy) return null;
    setBusy(true); setMsg(null);
    try {
      const res = await activateTrial();
      clearTrialIntent(); // whatever the outcome, don't auto-retry later
      if (res.ok) {
        setMsg({ kind: "ok", text: lang === "sk" ? "Trial aktivovaný 🎉 Obnovujem…" : "Trial started 🎉 Refreshing…" });
        if (reloadOnSuccess) setTimeout(() => window.location.reload(), 1000);
      } else {
        // 409 — already used / already on a paid tier. Not an error to alarm
        // the user; let the caller route them to Billing for the full picture.
        if (onConsumed) onConsumed(res);
        else setMsg({ kind: "err", text: res.data?.error || (lang === "sk" ? "Trial už bol využitý." : "Trial already used.") });
      }
      return res;
    } catch (e) {
      // SESSION_EXPIRED or any HTTP/network error → clean human message.
      setMsg({ kind: "err", text: authErrorMessage(e, lang) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { start, busy, msg };
}
