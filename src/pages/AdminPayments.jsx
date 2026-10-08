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
import { L, money, day, period, KIND, loadAdminBilling, openInvoicePdf, payments } from "../lib/adminPayments";

export function StatusBadge({ inv, lang }) {
  const t = L(lang);
  if (inv.dispute && ["needs_response", "under_review", "warning_needs_response", "warning_under_review"].includes(inv.dispute)) {
    return <span className="rd-badge rd-badge--err" title={t("Držiteľ karty platbu reklamoval v banke", "The card holder disputed the payment with their bank")}>{t("reklamácia v banke", "chargeback")}</span>;
  }
  if (inv.dispute === "lost") return <span className="rd-badge rd-badge--err">{t("reklamácia prehraná", "chargeback lost")}</span>;
  if (inv.status === "paid" && inv.refunded) {
    return <span className="rd-badge rd-badge--warn">{inv.refunded >= inv.amount ? t("vrátená", "refunded") : t("čiastočne vrátená", "partly refunded")}</span>;
  }
  if (inv.status === "paid") return <span className="rd-badge rd-badge--ok">{inv.amount ? t("zaplatená", "paid") : t("zadarmo (kupón)", "free (coupon)")}</span>;
  if (inv.status === "open") {
    if (!inv.attempts) return <span className="rd-badge rd-badge--warn">{t("čaká na platbu", "awaiting payment")}</span>;
    return <span className="rd-badge rd-badge--warn" title={inv.nextAttempt ? `${t("ďalší pokus", "next attempt")} ${day(inv.nextAttempt, lang)}` : undefined}>
      {inv.nextAttempt ? t("neúspešná — opakuje sa", "failed — retrying") : t("neúspešná — neopakuje sa", "failed — not retried")}</span>;
  }
  if (inv.status === "void") return <span className="rd-badge">{t("zrušená", "void")}</span>;
  if (inv.status === "uncollectible") return <span className="rd-badge rd-badge--warn">{t("nevymožiteľná", "uncollectible")}</span>;
  return <span className="rd-badge">{inv.status}</span>;
}

export function SubBadge({ s, lang }) {
  const t = L(lang);
  const ending = s.cancelAtPeriodEnd || s.cancelAt;
  if ((s.status === "active" || s.status === "trialing") && ending) {
    return <span className="rd-badge rd-badge--warn">{t("zrušené — beží do", "cancelled — runs until")} {day(s.cancelAt || s.periodEnd, lang)}</span>;
  }
  if (s.status === "active") return <span className="rd-badge rd-badge--ok">{t("aktívne", "active")}</span>;
  if (s.status === "trialing") return <span className="rd-badge rd-badge--ok">{t("skúšobné obdobie", "trial")}</span>;
  if (s.status === "past_due") return <span className="rd-badge rd-badge--warn" title={t("Premium je pozastavené, kým platba neprejde", "Premium is paused until the payment goes through")}>{t("platba zlyhala — pozastavené", "payment failed — paused")}</span>;
  if (s.status === "unpaid") return <span className="rd-badge rd-badge--warn">{t("nezaplatené", "unpaid")}</span>;
  if (s.status === "incomplete") return <span className="rd-badge rd-badge--warn">{t("prvá platba nedokončená", "first payment not finished")}</span>;
  if (s.status === "canceled") return <span className="rd-badge">{t("skončené", "ended")} {s.endedAt ? day(s.endedAt, lang) : ""}</span>;
  if (s.status === "paused") return <span className="rd-badge">{t("pozastavené", "paused")}</span>;
  return <span className="rd-badge">{s.status}</span>;
}

/** The amount cell: what was charged, what came off, what went back. */
export function AmountCell({ inv, lang }) {
  const t = L(lang);
  return (
    <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
      {money(inv.amount, inv.currency, lang)}
      {inv.discount ? <div className="rd-note" style={{ margin: 0, fontWeight: 400 }}>{t("zľava", "discount")} {money(inv.discount, inv.currency, lang)}{inv.coupon ? ` · ${inv.coupon}` : ""}</div> : null}
      {inv.refunded ? <div className="rd-note" style={{ margin: 0, fontWeight: 400, color: "var(--accent-2)" }}>{t("vrátené", "refunded")} −{money(inv.refunded, inv.currency, lang)}</div> : null}
    </td>
  );
}

export function InvoiceLinks({ inv, mode, lang }) {
  const t = L(lang);
  const stripeUrl = `https://dashboard.stripe.com/${mode === "test" ? "test/" : ""}invoices/${inv.id}`;
  return (
    <span style={{ display: "inline-flex", gap: "0.7rem", whiteSpace: "nowrap", fontSize: "0.8rem" }}>
      {inv.hostedUrl && <a href={inv.hostedUrl} target="_blank" rel="noreferrer">{inv.number || t("faktúra", "invoice")}</a>}
      {!inv.hostedUrl && <span>{inv.number || "—"}</span>}
      {inv.number && (
        <a href="#pdf" title={t("Faktúra, akú dostal zákazník", "The invoice the customer received")}
          onClick={async (e) => { e.preventDefault(); const err = await openInvoicePdf(inv.id, lang); if (err) window.alert(err); }}>PDF</a>
      )}
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
  const cur = lastPaid?.currency || invoices[0]?.currency || "eur";
  const b = data.billing;
  const ending = live && (live.cancelAtPeriodEnd || live.cancelAt);
  const unpaid = invoices.find((i) => i.status === "open" && i.attempts > 0);

  if (!data.customer) {
    return <p className="rd-note">{t("Tento človek nikdy neplatil kartou — Premium (ak ho má) mu dal admin alebo beží trial.", "This person has never paid by card — any Premium they have was given by an admin or is a trial.")}</p>;
  }
  return (
    // minmax(0, 1fr): a grid column otherwise grows to the invoice table's full width and
    // pushes the whole tab off a phone screen (the table scrolls inside its own box instead)
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.7rem" }}>
        <Kpi label={t("Zaplatil spolu", "Paid in total")} value={money(data.totals?.paid || 0, cur, lang)}
          sub={payments(data.totals?.payments || 0, lang) + (data.totals?.refunded ? ` · ${t("vrátené", "refunded")} ${money(data.totals.refunded, cur, lang)}` : "")}
          subWarn={Boolean(data.totals?.refunded)} />
        <Kpi label={t("Predplatné", "Subscription")} value={live ? (live.status === "past_due" ? t("Platba zlyhala", "Payment failed") : ending ? t("Zrušené", "Cancelled") : live.status === "trialing" ? t("Skúšobné", "Trial") : t("Aktívne", "Active")) : t("Žiadne", "None")}
          sub={live ? (live.status === "past_due" ? t("Premium pozastavené", "Premium paused") : money(live.monthly, cur, lang) + t(" mesačne", " a month") + (live.coupon ? ` · ${live.coupon}` : "")) : null}
          subWarn={live?.status === "past_due"} />
        <Kpi label={t("Ďalšia platba", "Next payment")}
          value={ending ? "—" : live?.status === "past_due" ? t("dlhuje", "owed") : data.next?.at ? day(data.next.at, lang) : "—"}
          sub={ending ? `${t("končí", "ends")} ${day(live.cancelAt || live.periodEnd, lang)}`
            : live?.status === "past_due" && unpaid ? money(unpaid.amount, cur, lang)
            : data.next?.amount != null ? money(data.next.amount, cur, lang) : null}
          subWarn={Boolean(ending) || live?.status === "past_due"} />
        <Kpi label={t("Platí od", "Paying since")} value={data.totals?.first ? day(data.totals.first, lang) : "—"} />
      </div>

      <section className="rd-card rd-card--pad">
        <div className="rd-sect" style={{ marginBottom: "0.7rem" }}>
          <span className="rd-sect__tick" /><span className="rd-sect__name">{t("Faktúry a platby", "Invoices and payments")}</span>
          <span className="rd-sect__count">{invoices.length}{data.truncated ? "+" : ""}</span>
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
                    <AmountCell inv={i} lang={lang} />
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
                  <span className="rd-ua__li-main">
                    <span><SubBadge s={s} lang={lang} /></span>
                    <span className="rd-ua__li-sub">{t("od", "since")} {day(s.created, lang)} · {t("obdobie", "period")} {period(s.periodStart, s.periodEnd, lang)}{s.coupon ? ` · ${s.coupon}` : ""}</span>
                  </span>
                  <span className="rd-ua__li-meta">{s.monthly ? money(s.monthly, cur, lang) + t(" / mes.", " / mo") : ""}</span>
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
