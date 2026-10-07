/**
 * Payments in admin — shared by admin → Revenue (AdminRevenue.jsx) and the Payments
 * tab of one person's page (UserActivity.jsx).
 *
 * Boss 2026-10-07: "make sure we can see all the info about the customers in the admin,
 * their invoices, payments, data about them". Everything comes from ONE server action,
 * /api/stripe?action=admin-billing (admins only), which reads Stripe — the source of
 * truth for money — and joins the people by Stripe customer. Nothing here is computed
 * from our own copy of the money, so the panel cannot disagree with Stripe.
 */
import { useEffect, useState } from "react";
import Kpi from "../components/Kpi";
import { L, money, day, period, KIND, loadAdminBilling, payments } from "../lib/adminPayments";

export function StatusBadge({ inv, lang }) {
  const t = L(lang);
  if (inv.status === "paid") return <span className="rd-badge rd-badge--ok">{t("zaplatená", "paid")}</span>;
  if (inv.status === "open") return <span className="rd-badge rd-badge--warn">{inv.attempts ? t("neúspešná — opakuje sa", "failed — retrying") : t("čaká na platbu", "awaiting payment")}</span>;
  if (inv.status === "void") return <span className="rd-badge">{t("zrušená", "void")}</span>;
  if (inv.status === "uncollectible") return <span className="rd-badge rd-badge--warn">{t("nevymožiteľná", "uncollectible")}</span>;
  return <span className="rd-badge">{inv.status}</span>;
}

export function SubBadge({ s, lang }) {
  const t = L(lang);
  if (s.status === "active" && (s.cancelAtPeriodEnd || s.cancelAt)) {
    return <span className="rd-badge rd-badge--warn">{t("zrušené — beží do", "cancelled — runs until")} {day(s.cancelAt || s.periodEnd, lang)}</span>;
  }
  if (s.status === "active" || s.status === "trialing") return <span className="rd-badge rd-badge--ok">{t("aktívne", "active")}</span>;
  if (s.status === "past_due") return <span className="rd-badge rd-badge--warn">{t("platba zlyhala", "payment failed")}</span>;
  if (s.status === "canceled") return <span className="rd-badge">{t("skončené", "ended")} {s.endedAt ? day(s.endedAt, lang) : ""}</span>;
  return <span className="rd-badge">{s.status}</span>;
}

export function InvoiceLinks({ inv, mode, lang }) {
  const t = L(lang);
  const stripeUrl = `https://dashboard.stripe.com/${mode === "test" ? "test/" : ""}invoices/${inv.id}`;
  return (
    <span style={{ display: "inline-flex", gap: "0.7rem", whiteSpace: "nowrap", fontSize: "0.8rem" }}>
      {inv.hostedUrl && <a href={inv.hostedUrl} target="_blank" rel="noreferrer">{inv.number || t("faktúra", "invoice")}</a>}
      {!inv.hostedUrl && <span>{inv.number || "—"}</span>}
      {inv.pdfUrl && <a href={inv.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}
      <a href={stripeUrl} target="_blank" rel="noreferrer" title={t("Platba, poplatok a vrátenie v Stripe", "Payment, fee and refund in Stripe")}>Stripe ↗</a>
    </span>
  );
}

/**
 * One person's subscription and payments — the Payments tab of their page.
 */
export function UserPayments({ userId, lang = "sk" }) {
  const t = L(lang);
  const [state, setState] = useState({ key: null, data: null, err: null });
  const [nonce, setNonce] = useState(0);
  const key = `${userId}:${nonce}`;
  useEffect(() => {
    let live = true;
    loadAdminBilling({ user_id: userId }, lang).then((r) => { if (live) setState({ key, data: r.data || null, err: r.err || null }); });
    return () => { live = false; };
  }, [userId, nonce, lang, key]);
  const { data, err } = state;
  const loading = state.key !== key;

  if (err) {
    return (
      <div className="rd-alert rd-alert--err">
        {err} <button type="button" className="rd-btn rd-btn--sm" onClick={() => setNonce((n) => n + 1)} style={{ marginLeft: "auto" }}>{t("Skúsiť znova", "Retry")}</button>
      </div>
    );
  }
  if (loading && !data) return <p className="rd-note">{t("Načítavam platby zo Stripe…", "Loading payments from Stripe…")}</p>;
  if (!data) return null;

  const subs = data.subscriptions || [];
  const invoices = data.invoices || [];
  const live = subs.find((s) => ["active", "trialing", "past_due"].includes(s.status));
  const lastPaid = invoices.find((i) => i.status === "paid");
  const b = data.billing;
  const next = live && !(live.cancelAtPeriodEnd || live.cancelAt) ? live.periodEnd : null;

  if (!data.customer) {
    return <p className="rd-note">{t("Tento človek nikdy neplatil kartou — Premium (ak ho má) mu dal admin alebo beží trial.", "This person has never paid by card — any Premium they have was given by an admin or is a trial.")}</p>;
  }
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.7rem" }}>
        <Kpi label={t("Zaplatil spolu", "Paid in total")} value={money(data.totals?.paid || 0, lastPaid?.currency, lang)}
          sub={payments(data.totals?.payments || 0, lang)} />
        <Kpi label={t("Predplatné", "Subscription")} value={live ? (live.status === "past_due" ? t("Platba zlyhala", "Payment failed") : (live.cancelAtPeriodEnd || live.cancelAt) ? t("Zrušené", "Cancelled") : t("Aktívne", "Active")) : t("Žiadne", "None")}
          sub={live ? money(live.monthly, lastPaid?.currency, lang) + t(" mesačne", " a month") : null} subWarn={live?.status === "past_due"} />
        <Kpi label={t("Ďalšia platba", "Next payment")} value={next ? day(next, lang) : "—"}
          sub={live && (live.cancelAtPeriodEnd || live.cancelAt) ? `${t("končí", "ends")} ${day(live.cancelAt || live.periodEnd, lang)}` : null} />
        <Kpi label={t("Platí od", "Paying since")} value={data.totals?.first ? day(data.totals.first, lang) : "—"} />
      </div>

      <section className="rd-card rd-card--pad">
        <div className="rd-sect" style={{ marginBottom: "0.7rem" }}>
          <span className="rd-sect__tick" /><span className="rd-sect__name">{t("Faktúry a platby", "Invoices and payments")}</span>
          <span className="rd-sect__count">{invoices.length}</span>
          <a href={data.customer.url} target="_blank" rel="noreferrer" className="rd-btn rd-btn--sm rd-btn--ghost" style={{ marginLeft: "auto" }}>{t("Zákazník v Stripe ↗", "Customer in Stripe ↗")}</a>
        </div>
        {invoices.length ? (
          <div className="rd-scroll">
            <table className="rd-table rd-table--compact">
              <thead><tr><th>{t("Dátum", "Date")}</th><th>{t("Čo", "What")}</th><th>{t("Obdobie", "Period")}</th><th>{t("Suma", "Amount")}</th><th>{t("Stav", "Status")}</th><th>{t("Faktúra", "Invoice")}</th></tr></thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{day(i.paidAt || i.created, lang)}</td>
                    <td>{L(lang)(...(KIND[i.kind] || KIND.other))}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{period(i.periodStart, i.periodEnd, lang)}</td>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{money(i.amount, i.currency, lang)}{i.discount ? <div className="rd-note" style={{ margin: 0 }}>{t("zľava", "discount")} {money(i.discount, i.currency, lang)}</div> : null}</td>
                    <td><StatusBadge inv={i} lang={lang} /></td>
                    <td><InvoiceLinks inv={i} mode={data.mode} lang={lang} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rd-note">{t("Žiadna faktúra.", "No invoices.")}</p>}
      </section>

      <div className="rd-ua__grid">
        <section className="rd-card rd-card--pad">
          <div className="rd-sect" style={{ marginBottom: "0.7rem" }}><span className="rd-sect__tick" /><span className="rd-sect__name">{t("Predplatné", "Subscriptions")}</span></div>
          {subs.length ? (
            <div className="rd-ua__list">
              {subs.map((s) => (
                <div key={s.id} className="rd-ua__li">
                  <span className="rd-ua__li-main"><SubBadge s={s} lang={lang} /> {s.monthly ? money(s.monthly, lastPaid?.currency, lang) + t(" / mes.", " / mo") : ""}</span>
                  <span className="rd-ua__li-meta">{t("od", "since")} {day(s.created, lang)} · {t("obdobie", "period")} {period(s.periodStart, s.periodEnd, lang)}</span>
                </div>
              ))}
            </div>
          ) : <p className="rd-note">{t("Žiadne predplatné v Stripe.", "No subscription in Stripe.")}</p>}
        </section>
        <section className="rd-card rd-card--pad">
          <div className="rd-sect" style={{ marginBottom: "0.7rem" }}><span className="rd-sect__tick" /><span className="rd-sect__name">{t("Fakturačné údaje", "Billing details")}</span></div>
          {b ? (
            <dl className="rd-ua__facts">
              {b.name && <div><dt>{t("Firma", "Company")}</dt><dd>{b.name}</dd></div>}
              {b.companyId && <div><dt>IČO</dt><dd>{b.companyId}</dd></div>}
              {b.vat && <div><dt>{t("IČ DPH", "VAT ID")}</dt><dd>{b.vat}</dd></div>}
              {b.address && <div><dt>{t("Adresa", "Address")}</dt><dd>{b.address}</dd></div>}
            </dl>
          ) : <p className="rd-note">{t("Fakturačné údaje nezadal (platil ako súkromná osoba).", "No billing details given (paid as a private person).")}</p>}
        </section>
      </div>
    </div>
  );
}
