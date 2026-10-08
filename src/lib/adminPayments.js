// Formatting and loading for admin payments (AdminPayments.jsx, AdminRevenue.jsx).
// Kept out of the component files so React fast refresh keeps working there.
import { getFreshAccessToken, authErrorMessage } from "./sessionGuard";
import { localeTag } from "./locale";
import { TZ } from "./adminUsers";

export const L = (lang) => (sk, en) => (lang === "sk" ? sk : en);

/** 2499 → "24,99 €" (sk) / "€24.99" (en). */
export function money(cents, currency = "eur", lang = "sk") {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(lang === "sk" ? "sk-SK" : "en-IE", { style: "currency", currency: String(currency || "eur").toUpperCase() })
      .format(Number(cents) / 100);
  } catch { return `${(Number(cents) / 100).toFixed(2)} ${String(currency).toUpperCase()}`; }
}

/** Unix seconds → "7. 10. 2026". */
export const day = (sec, lang) => (sec
  ? new Date(sec * 1000).toLocaleDateString(localeTag(lang), { day: "numeric", month: "numeric", year: "numeric", timeZone: TZ })
  : "—");

/** "7. 10. – 7. 11. 2026" — the year once when both ends share it. */
export function period(a, b, lang) {
  if (!a || !b || a === b) return "—";
  const ya = new Date(a * 1000).getUTCFullYear(), yb = new Date(b * 1000).getUTCFullYear();
  if (ya !== yb) return `${day(a, lang)} – ${day(b, lang)}`;
  const short = new Date(a * 1000).toLocaleDateString(localeTag(lang), { day: "numeric", month: "numeric", timeZone: TZ });
  return `${short} – ${day(b, lang)}`;
}

/** "1 platba · 2 platby · 5 platieb" / "1 payment · 2 payments". */
export function payments(n, lang) {
  const k = Number(n) || 0;
  if (lang !== "sk") return `${k} ${k === 1 ? "payment" : "payments"}`;
  return `${k} ${k === 1 ? "platba" : k >= 2 && k <= 4 ? "platby" : "platieb"}`;
}

export const KIND = {
  new: ["Nové predplatné", "New subscription"],
  renewal: ["Obnova", "Renewal"],
  change: ["Zmena", "Change"],
  other: ["Platba", "Payment"],
};

/**
 * Download OUR invoice PDF (api/_lib/invoicePdf.js — what the customer got, not Stripe's template)
 * with a fresh admin session, and open it. Returns an error message or null.
 */
export async function openInvoicePdf(invoiceId, lang) {
  let token;
  try { token = await getFreshAccessToken(); } catch (e) { return authErrorMessage(e, lang); }
  try {
    const r = await fetch("/api/stripe?action=admin-invoice-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ invoice_id: invoiceId, lang }),
    });
    if (!r.ok) return (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`;
    // a download, not window.open: after the await a pop-up blocker would swallow a new window
    const name = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || `${invoiceId}.pdf`;
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return null;
  } catch (e) {
    return String(e?.message || e);
  }
}

/** POST /api/stripe?action=admin-billing with a fresh admin session. */
export async function loadAdminBilling(body, lang) {
  let token;
  try { token = await getFreshAccessToken(); } catch (e) { return { err: authErrorMessage(e, lang) }; }
  try {
    const r = await fetch("/api/stripe?action=admin-billing", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const t = L(lang);
      return { err: r.status === 401 ? authErrorMessage({ status: 401 }, lang)
        : r.status === 502 ? t("Stripe teraz neodpovedá — skúste o chvíľu.", "Stripe is not answering right now — try again in a moment.")
        : (j.error || `HTTP ${r.status}`) };
    }
    return { data: j };
  } catch (e) {
    return { err: String(e?.message || e) };
  }
}

