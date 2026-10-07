/**
 * Admin → Revenue — the money at a glance and every payment with its invoice.
 *
 * Boss 2026-10-07: "make sure we can see all the info about the customers in the admin,
 * their invoices, payments … research all that companies saas etc normally have,
 * measure record". What a subscription business tracks first, straight from Stripe
 * (api/stripe.js, action admin-billing; numbers in lib/billingStats.js, tested):
 *   MRR (+ARR), paying customers, ARPU, revenue this month / 30 days / all time,
 *   new subscriptions in 30 days, failed payments, cancellations in progress;
 *   every payment (who, what, period, amount, discount, status, invoice + PDF + Stripe);
 *   every subscription (status, since, period, monthly value).
 * A row opens the person's page (UserActivity), where their Payments tab lives.
 */
import { useEffect, useMemo, useState } from "react";
import Kpi from "../components/Kpi";
import UserActivity from "./UserActivity";
import { StatusBadge, SubBadge, InvoiceLinks } from "./AdminPayments";
import { L, money, day, period, KIND, loadAdminBilling } from "../lib/adminPayments";

const FILTERS = [
  ["all", "Všetky", "All", () => true],
  ["paid", "Zaplatené", "Paid", (i) => i.status === "paid"],
  ["failed", "Neúspešné", "Failed", (i) => i.status === "open" && i.attempts > 0],
];

export default function RevenuePanel({ users = [], lang = "sk" }) {
  const t = L(lang);
  const [nonce, setNonce] = useState(0);
  const [res, setRes] = useState({ nonce: -1, data: null, err: null });
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);       // a person's page

  useEffect(() => {
    let live = true;
    loadAdminBilling({}, lang).then((r) => { if (live) setRes({ nonce, data: r.data || null, err: r.err || null }); });
    return () => { live = false; };
  }, [nonce, lang]);

  const { data, err } = res;
  const loading = res.nonce !== nonce;
  const s = data?.summary || {};
  const payments = useMemo(() => data?.payments || [], [data]);
  const subs = (data?.subscriptions || []).filter((x) => x.status !== "incomplete_expired");
  const shown = payments.filter((FILTERS.find((f) => f[0] === filter) || FILTERS[0])[3]);
  const cur = payments.find((p) => p.currency)?.currency || "eur";
  const person = (r) => r.person || (r.email ? { email: r.email, name: r.name } : null);
  const openPerson = (p) => { if (p?.id) setOpen(p.id); };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
        {data && (
          <span className={`rd-badge${data.mode === "live" ? " rd-badge--ok" : " rd-badge--warn"}`}>
            {data.mode === "live" ? t("Stripe naostro — skutočné platby", "Stripe live — real payments") : t("Stripe: testovací kľúč — platby nie sú skutočné", "Stripe: test key — payments are not real")}
          </span>
        )}
        <span className="rd-note" style={{ margin: 0 }}>
          {t("Čísla priamo zo Stripe. Výplaty na účet a poplatky: ", "Numbers straight from Stripe. Payouts and fees: ")}
          <a href="https://dashboard.stripe.com/payouts" target="_blank" rel="noreferrer">Stripe → {t("Výplaty", "Payouts")} ↗</a>
        </span>
        <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost" style={{ marginLeft: "auto" }} onClick={() => setNonce((n) => n + 1)}>
          {loading ? t("Načítavam…", "Loading…") : t("↻ Obnoviť", "↻ Refresh")}
        </button>
      </div>

      {err && (
        <div className="rd-alert rd-alert--err" style={{ marginBottom: "1rem" }}>
          {err} <button type="button" className="rd-btn rd-btn--sm" onClick={() => setNonce((n) => n + 1)} style={{ marginLeft: "auto" }}>{t("Skúsiť znova", "Retry")}</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.7rem", marginBottom: "1.4rem" }}>
        <Kpi loading={!data} label="MRR" value={money(s.mrr, cur, lang)} sub={data ? `ARR ${money(s.arr, cur, lang)}` : null}
          info={t("Mesačný opakovaný príjem: súčet mesačných súm bežiacich predplatných po zľave, ktorá stále platí.", "Monthly recurring revenue: the monthly value of running subscriptions after any discount that still applies.")} />
        <Kpi loading={!data} label={t("Platiaci", "Paying")} value={s.paying ?? "—"}
          sub={data ? (s.cancelling ? `${s.cancelling} ${t("ruší", "cancelling")}` : t("nikto neruší", "nobody cancelling")) : null} subWarn={Boolean(s.cancelling)} />
        <Kpi loading={!data} label="ARPU" value={money(s.arpu, cur, lang)} sub={t("mesačne na platiaceho", "a month per payer")} />
        <Kpi loading={!data} label={t("Tento mesiac", "This month")} value={money(s.revenueMonth, cur, lang)} sub={data ? `${t("30 dní", "30 days")}: ${money(s.revenue30d, cur, lang)}` : null} />
        <Kpi loading={!data} label={t("Spolu", "All time")} value={money(s.revenueTotal, cur, lang)} sub={data ? `${s.payments} ${t("platieb", "payments")}` : null} />
        <Kpi loading={!data} label={t("Nové za 30 dní", "New in 30 days")} value={s.new30d ?? "—"} sub={t("nové predplatné", "new subscriptions")} />
        <Kpi loading={!data} label={t("Neúspešné platby", "Failed payments")} value={s.failedOpen ?? "—"}
          sub={data ? (s.failedOpen ? t("Stripe ich skúša znova", "Stripe is retrying") : t("všetko prešlo", "all went through")) : null} subWarn={Boolean(s.failedOpen)} />
      </div>

      <section className="rd-card rd-card--pad" style={{ marginBottom: "1.2rem" }}>
        <div className="rd-sect" style={{ marginBottom: "0.7rem" }}>
          <span className="rd-sect__tick" /><span className="rd-sect__name">{t("Platby a faktúry", "Payments and invoices")}</span>
          <span className="rd-sect__count">{payments.length}</span>
          <div className="rd-seg" role="group" style={{ marginLeft: "auto" }}>
            {FILTERS.map(([k, sk, en, fn]) => (
              <button key={k} type="button" className="rd-seg__btn" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {lang === "sk" ? sk : en} <span style={{ opacity: 0.6 }}>{payments.filter(fn).length}</span>
              </button>
            ))}
          </div>
        </div>
        {shown.length ? (
          <div className="rd-scroll">
            <table className="rd-table rd-table--compact">
              <thead><tr>
                <th>{t("Dátum", "Date")}</th><th>{t("Zákazník", "Customer")}</th><th>{t("Čo", "What")}</th>
                <th>{t("Obdobie", "Period")}</th><th>{t("Suma", "Amount")}</th><th>{t("Stav", "Status")}</th><th>{t("Faktúra", "Invoice")}</th>
              </tr></thead>
              <tbody>
                {shown.map((i) => {
                  const p = person(i);
                  return (
                    <tr key={i.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{day(i.paidAt || i.created, lang)}</td>
                      <td>
                        {p?.id
                          ? <button type="button" className="rd-title-btn" onClick={() => openPerson(p)} style={{ fontWeight: 600 }}>{p.name || p.email}</button>
                          : <span style={{ fontWeight: 600 }}>{p?.name || p?.email || "—"}</span>}
                        <div className="rd-note" style={{ margin: 0 }}>{[p?.company, p?.email].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td>{L(lang)(...(KIND[i.kind] || KIND.other))}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{period(i.periodStart, i.periodEnd, lang)}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{money(i.amount, i.currency, lang)}
                        {i.discount ? <div className="rd-note" style={{ margin: 0, fontWeight: 400 }}>{t("zľava", "discount")} {money(i.discount, i.currency, lang)}</div> : null}</td>
                      <td><StatusBadge inv={i} lang={lang} /></td>
                      <td><InvoiceLinks inv={i} mode={data.mode} lang={lang} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="rd-note">{data ? (payments.length ? t("Žiadna platba pre tento filter.", "No payment for this filter.") : t("Zatiaľ žiadna platba. Prvá sa tu ukáže hneď, ako ju Stripe potvrdí.", "No payments yet. The first appears here as soon as Stripe confirms it.")) : t("Načítavam…", "Loading…")}</p>}
      </section>

      <section className="rd-card rd-card--pad">
        <div className="rd-sect" style={{ marginBottom: "0.7rem" }}>
          <span className="rd-sect__tick" /><span className="rd-sect__name">{t("Predplatné", "Subscriptions")}</span>
          <span className="rd-sect__count">{subs.length}</span>
        </div>
        {subs.length ? (
          <div className="rd-scroll">
            <table className="rd-table rd-table--compact">
              <thead><tr><th>{t("Zákazník", "Customer")}</th><th>{t("Stav", "Status")}</th><th>{t("Od", "Since")}</th><th>{t("Aktuálne obdobie", "Current period")}</th><th>{t("Mesačne", "Monthly")}</th></tr></thead>
              <tbody>
                {subs.map((x) => {
                  const p = person(x);
                  return (
                    <tr key={x.id}>
                      <td>{p?.id ? <button type="button" className="rd-title-btn" onClick={() => openPerson(p)} style={{ fontWeight: 600 }}>{p.name || p.email}</button> : (p?.email || x.customerId)}
                        <div className="rd-note" style={{ margin: 0 }}>{[p?.company, p?.email].filter(Boolean).join(" · ")}</div></td>
                      <td><SubBadge s={x} lang={lang} /></td>
                      <td style={{ whiteSpace: "nowrap" }}>{day(x.created, lang)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{period(x.periodStart, x.periodEnd, lang)}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{x.monthly ? money(x.monthly, cur, lang) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="rd-note">{data ? t("Žiadne predplatné.", "No subscriptions.") : t("Načítavam…", "Loading…")}</p>}
      </section>

      {open && (
        <UserActivity userId={open} profile={users.find((u) => u.id === open)} lang={lang} initialTab="payments" onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
