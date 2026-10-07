/**
 * Admin → Users — the account list, and every change an admin makes to one.
 *
 * Boss, 2026-10-06: add a user myself (e-mail, type, name, everything) and they have
 * a working account at once; two columns that say from when to when someone has
 * Premium, editable — change the date and it just works; every field in its own
 * column instead of the old pile of buttons; the +7-day / +30-day shortcuts gone.
 *
 *   · One row per account, one column per fact: e-mail · name · company · position ·
 *     account type · Premium from · Premium to · registered · note · actions.
 *   · The TYPE is a Picker in the row; under it, a line only when what the person
 *     actually gets differs from it (trial running, Premium ended, paused, sign-up
 *     not finished) — the same rule the site enforces (lib/access.js).
 *   · The two DATES are edited in place on a Premium account: click, pick, Enter.
 *   · "Add user" and "Edit" open the same form (Modal).
 *
 * What a change does (→ Premium starts a period, → Free ends it, a day is a
 * Bratislava day, "from" never in the future …) is decided on the server by
 * lib/adminUsers.js — the same module this file reads its labels and checks from,
 * so the panel can never promise something the server will not do.
 */
import { useMemo, useState, useEffect, useRef } from "react";
import Picker from "../components/Picker";
import DateField from "../components/DateField";
import Modal from "../components/Modal";
import Kpi from "../components/Kpi";
import UserActivity from "./UserActivity";
import { supabaseData } from "../lib/supabase";
import { relDays } from "../lib/userActivity";
import { useTableSort, SortableTh } from "../components/SortableTable";
import { getFreshAccessToken, authErrorMessage } from "../lib/sessionGuard";
import { isPersonalEmail } from "../lib/emailValidation";
import { localeTag } from "../lib/locale";
import { resolveAccess } from "../lib/access";
import {
  TZ, dayKey, accountStatus, statusCounts, filterKey, errorText,
  STATUS_LABELS, TYPE_LABELS, label,
} from "../lib/adminUsers";

const L = (lang) => (sk, en) => (lang === "sk" ? sk : en);


const fmtDay = (ts, lang) => (ts
  ? new Date(ts).toLocaleDateString(localeTag(lang), { day: "numeric", month: "numeric", year: "numeric", timeZone: TZ })
  : null);

/** POST to an /api/admin endpoint with a fresh session; never throws. */
async function callAdmin(path, payload, lang) {
  let token;
  try { token = await getFreshAccessToken(); }
  catch (e) { return { ok: false, text: authErrorMessage(e, lang) }; }
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, status: r.status, j, text: r.status === 401 ? authErrorMessage({ status: 401 }, lang) : errorText(j, lang, r.status) };
    }
    return { ok: true, j };
  } catch (e) {
    return { ok: false, text: errorText({ message: String(e?.message || e) }, lang) };
  }
}

function typeOptions(lang, { includePending = true } = {}) {
  const t = L(lang);
  return [
    { value: "free",    label: label(TYPE_LABELS, "free", lang),    hint: t("prehľad + 1 projekt", "overview + 1 project") },
    { value: "paid",    label: label(TYPE_LABELS, "paid", lang),    hint: t("všetky dáta", "all data") },
    { value: "admin",   label: label(TYPE_LABELS, "admin", lang),   hint: t("všetko + správa", "everything + admin") },
    ...(includePending ? [{ value: "pending", label: label(TYPE_LABELS, "pending", lang), hint: t("zablokovaný", "blocked") }] : []),
  ];
}

// ───────────────────────────────────────────────────────────────────────────

export default function AdminUsers({ users, setUsers, selfId, lang = "sk", premiumSet, loading, err, reload, now, bumpClock }) {
  const t = L(lang);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState(null);          // null | { mode: 'create' } | { mode: 'edit', user }
  const [confirm, setConfirm] = useState(null);    // null | { title, body, okLabel, danger, run }
  const [toast, setToast] = useState(null);        // null | { kind: 'ok'|'err', text }
  const [busyId, setBusyId] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const toastTimer = useRef(null);

  // One person's activity (UserActivity.jsx). ?user=<id> opens it — the "new sign-up"
  // e-mail links straight to the person; the address follows the open panel so it
  // can be copied and the browser's Back closes nothing unexpected.
  const [activityId, setActivityId] = useState(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("user");
      return /^[0-9a-f-]{36}$/i.test(id || "") ? id : null;
    } catch { return null; }
  });
  const openActivity = (id) => {
    setActivityId(id);
    try {
      const p = new URLSearchParams(window.location.search);
      if (id) { p.set("tab", "users"); p.set("user", id); } else p.delete("user");
      const qs = p.toString();
      window.history.replaceState(window.history.state, "", window.location.pathname + (qs ? `?${qs}` : ""));
    } catch { /* the panel works without the address */ }
  };

  // The "Activity" column: last seen + active days of the last 30, for everyone at once.
  // null = not known (still loading, or the read failed) — never shown as "nothing yet"
  const [glance, setGlance] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await getFreshAccessToken();
        const { data, error } = await supabaseData.rpc("admin_users_activity_glance");
        if (!error && live) setGlance(Object.fromEntries((data || []).map((r) => [r.user_id, r])));
      } catch { /* the column shows a dash; the table stays */ }
    })();
    return () => { live = false; };
  }, [users?.length]);

  const say = (kind, text) => {
    clearTimeout(toastTimer.current);
    setToast({ kind, text });
    // Success fades on its own; an error stays until it is read and closed.
    if (kind === "ok") toastTimer.current = setTimeout(() => setToast(null), 4500);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const counts = useMemo(() => statusCounts(users, now), [users, now]);

  // ── Writes ───────────────────────────────────────────────────────────────
  const replaceRow = (row) => setUsers((us) => us.map((x) => (x.id === row.id ? row : x)));

  /** Change one account. Resolves to { ok, text? } — the caller decides how to say it. */
  const update = async (u, payload) => {
    setBusyId(u.id);
    const r = await callAdmin("/api/admin/set-subscription", { user_id: u.id, ...payload }, lang);
    setBusyId(null);
    if (r.ok && r.j?.user) { bumpClock(r.j.now); replaceRow(r.j.user); return { ok: true }; }
    if (!r.ok && r.j?.error === "nothing_to_change") return { ok: true, unchanged: true };
    return { ok: false, text: r.text };
  };

  /**
   * A change that touches access on a card payer is said out loud first — what
   * the server will do with it (lib/adminUsers.js#cardSubscriptionVerdict):
   * ending Premium cancels the card subscription, other date changes are refused.
   * Resolves to the change's own result, or false when the admin backs out.
   */
  const guardStripe = (u, run) => {
    if (!u.stripe_subscription_id) return run();
    return new Promise((resolve) => setConfirm({
      onCancel: () => resolve(false),
      title: t("Užívateľ platí kartou", "This user pays by card"),
      body: t(
        `${u.email} má predplatné kartou v Stripe. Ak mu Premium ukončíš (Free, Bez prístupu), predplatné sa hneď zruší a kartu mu už nestrhneme. Dátumy Premium mu meniť nejde — riadi ich Stripe.`,
        `${u.email} has a card subscription in Stripe. Ending their Premium (Free, No access) cancels the subscription at once and the card is not charged again. Their Premium dates cannot be changed — Stripe owns them.`,
      ),
      okLabel: t("Pokračovať", "Continue"),
      run: async () => resolve(await run()),
    }));
  };

  const changeType = (u, tier) => {
    if (tier === u.tier) return;
    const go = async () => {
      const r = await update(u, { tier });
      if (r.ok) { say("ok", t(`${u.email}: typ účtu ${label(TYPE_LABELS, tier, lang)}`, `${u.email}: account type ${label(TYPE_LABELS, tier, lang)}`)); flash(u.id); }
      else say("err", r.text);
    };
    const ask = (title, body, okLabel, danger = false) => setConfirm({ title, body, okLabel, danger, run: () => guardStripe(u, go) });
    if (tier === "admin") {
      return ask(t("Dať administrátorský prístup?", "Give administrator access?"),
        t(`${u.email} uvidí všetky dáta a bude môcť meniť užívateľov, články aj nastavenia.`, `${u.email} will see all data and be able to change users, articles and settings.`),
        t("Áno, urobiť admina", "Yes, make admin"), true);
    }
    if (tier === "pending") {
      return ask(t("Zablokovať prístup?", "Block access?"),
        t(`${u.email} sa síce prihlási, ale neuvidí žiadne dáta. Bežiace Premium sa ukončí dnes.`, `${u.email} can still sign in but will see no data. Running Premium ends today.`),
        t("Zablokovať", "Block"), true);
    }
    // Free ↔ Premium moves a person's access today, so it is confirmed too —
    // one mis-click in the row's picker used to end someone's Premium at once,
    // overwriting the end date with no way back but the audit log.
    const a = resolveAccess(u.tier || "pending", u);
    const until = a.paidWindowActive ? fmtDay(u.paid_until, lang) : null;
    if (tier === "free" && (a.paidActive || a.trialActive)) {
      return ask(t("Ukončiť Premium dnes?", "End Premium today?"),
        t(`${u.email} má ${a.paidActive ? `Premium ${until ? `do ${until}` : "bez konca"}` : "bežiaci trial"}. Prepnutím na Free sa skončí dnes; pôvodný dátum sa nevráti.`,
          `${u.email} has ${a.paidActive ? `Premium ${until ? `until ${until}` : "with no end"}` : "a running trial"}. Switching to Free ends it today; the old date does not come back.`),
        t("Ukončiť Premium", "End Premium"), true);
    }
    if (tier === "paid") {
      return ask(t("Dať Premium?", "Give Premium?"),
        a.paidWindowActive
          ? t(`${u.email} má Premium do ${until} — zostane.`, `${u.email} keeps Premium until ${until}.`)
          : t(`${u.email} dostane Premium od dnes bez konca. Dátum konca nastavíš v Upraviť.`, `${u.email} gets Premium from today with no end. Set an end date in Edit.`),
        t("Dať Premium", "Give Premium"));
    }
    return guardStripe(u, go);
  };

  const saveDate = (u, field, day) => guardStripe(u, async () => {
    const r = await update(u, { [field]: day });
    if (r.ok) {
      if (!r.unchanged) {
        const what = field === "paid_started_at" ? t("Premium od", "Premium from") : t("Premium do", "Premium to");
        say("ok", `${u.email}: ${what} ${day ? fmtDay(`${day}T12:00:00Z`, lang) : t("bez konca", "no end")}`);
        flash(u.id);
      }
      return true;
    }
    say("err", r.text);
    return false;
  });

  const askDelete = (u) => setConfirm({
    title: t("Vymazať užívateľa natrvalo?", "Delete this user permanently?"),
    body: t(
      `${u.email}${u.full_name ? ` (${u.full_name})` : ""} — účet, nastavenia, uložené oblasti, otázky AI, história používania aj jeho správy zmiznú a nedá sa to vrátiť. Ostanú len faktúry a záznam o zmazaní.`,
      `${u.email}${u.full_name ? ` (${u.full_name})` : ""} — the account, settings, saved areas, AI questions, usage history and their messages go, and this cannot be undone. Only invoices and a record of the deletion stay.`,
    ) + (u.stripe_subscription_id ? t(
      " Platí kartou — predplatné v Stripe sa zruší hneď spolu s účtom.",
      " Pays by card — the Stripe subscription is cancelled together with the account.",
    ) : ""),
    okLabel: t("Vymazať natrvalo", "Delete permanently"),
    danger: true,
    run: async () => {
      setBusyId(u.id);
      const r = await callAdmin("/api/admin/delete-user", { user_id: u.id }, lang);
      setBusyId(null);
      if (r.ok) { setUsers((us) => us.filter((x) => x.id !== u.id)); say("ok", t(`Vymazaný: ${u.email}`, `Deleted: ${u.email}`)); }
      else say("err", r.text);
    },
  });

  const flash = (id) => { setFlashId(id); setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1600); };

  // ── Rows ─────────────────────────────────────────────────────────────────
  const sortCols = useMemo(() => ({
    email:    { kind: "text", get: (u) => u.email },
    name:     { kind: "text", get: (u) => u.full_name },
    company:  { kind: "text", get: (u) => u.company },
    position: { kind: "text", get: (u) => u.position },
    type:     { kind: "num",  get: (u) => ({ admin: 4, paid: 3, free: 2, pending: 1 }[u.tier] || 0) },
    from:     { kind: "date", get: (u) => u.paid_started_at },
    to:       { kind: "date", get: (u) => (u.tier === "paid" && !u.paid_until ? "2999-12-31" : u.paid_until) },
    created:  { kind: "date", get: (u) => u.created_at },
    active:   { kind: "date", get: (u) => glance?.[u.id]?.last_active_at },
  }), [glance]);
  const { sort, onHeaderClick, sortArrow, sortRows } = useTableSort(sortCols, { key: "created", dir: "desc" }, lang);

  const q = search.trim().toLowerCase();
  const visible = sortRows((users || []).filter((u) => {
    if (filter !== "all" && filterKey(u, now) !== filter) return false;
    if (!q) return true;
    return [u.email, u.full_name, u.company, u.position, u.subscription_note]
      .some((v) => (v || "").toLowerCase().includes(q));
  }));

  const chips = [
    { k: "all",     n: counts.total,   l: t("Všetci", "All") },
    { k: "premium", n: counts.premium, l: "Premium" },
    { k: "trial",   n: counts.trial,   l: "Trial" },
    { k: "free",    n: counts.free,    l: "Free" },
    { k: "admin",   n: counts.admin,   l: "Admin" },
    { k: "none",    n: counts.none,    l: t("Bez prístupu", "No access") },
  ].filter((c) => c.k === "all" || c.n > 0 || filter === c.k);

  const th = { padding: "0 0.7rem" };

  return (
    <>
      {/* Toolbar: filter · search · count · Add user */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", marginBottom: "0.85rem" }}>
        <div className="rd-seg rd-seg--wrap" role="group" aria-label={t("Filter", "Filter")}>
          {chips.map((c) => (
            <button key={c.k} type="button" className="rd-seg__btn" aria-pressed={filter === c.k} onClick={() => setFilter(c.k)}>
              {c.l} <span style={{ opacity: 0.6, marginLeft: 3 }}>{c.n}</span>
            </button>
          ))}
        </div>
        <input
          className="rd-field"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Hľadať e-mail, meno, firmu, poznámku…", "Search e-mail, name, company, note…")}
          aria-label={t("Hľadať", "Search")}
          style={{ flex: "1 1 240px", minWidth: 200 }}
        />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-dim)", whiteSpace: "nowrap" }}>
          {visible.length} / {(users || []).length}
        </span>
        <button type="button" className="rd-btn rd-btn--primary" onClick={() => setForm({ mode: "create" })}>
          + {t("Pridať užívateľa", "Add user")}
        </button>
      </div>

      {loading ? (
        <div className="rd-card rd-card--pad" style={{ textAlign: "center", color: "var(--text-dim)" }}>
          {t("Načítavam užívateľov…", "Loading users…")}
        </div>
      ) : (err || (users || []).length === 0) ? (
        // err = the load failed. 0 rows with no error = the query ran without a
        // valid session — an admin always sees at least themselves.
        <div className="rd-alert rd-alert--err" style={{ flexDirection: "column", alignItems: "center", padding: "1.2rem" }}>
          <div>{err || t("Nepodarilo sa načítať užívateľov — prihlásenie zrejme vypršalo.", "Couldn't load users — your session has expired.")}</div>
          <button type="button" className="rd-btn rd-btn--primary rd-btn--sm" onClick={reload}>{t("Načítať znova", "Reload")}</button>
        </div>
      ) : (
        <div className="rd-card" style={{ padding: 0 }}>
          <EdgeScroll>
            <table className="rd-table rd-table--compact rd-table--stick1">
              <thead>
                <tr>
                  <SortableTh style={th} sortKey="email"    current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("E-mail", "E-mail")}</SortableTh>
                  <SortableTh style={th} sortKey="name"     current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("Meno", "Name")}</SortableTh>
                  <SortableTh style={th} sortKey="company"  current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("Firma", "Company")}</SortableTh>
                  <SortableTh style={th} sortKey="position" current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("Pozícia", "Position")}</SortableTh>
                  <th style={th}>{t("Kontakt", "Contact")}</th>
                  <SortableTh style={th} sortKey="type"     current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("Typ účtu", "Account type")}</SortableTh>
                  <SortableTh style={th} sortKey="from"     current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("Premium od", "Premium from")}</SortableTh>
                  <SortableTh style={th} sortKey="to"       current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("Premium do", "Premium to")}</SortableTh>
                  <SortableTh style={th} sortKey="active"   current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("Aktivita", "Activity")}</SortableTh>
                  <SortableTh style={th} sortKey="created"  current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t("Vytvorený", "Created")}</SortableTh>
                  <th style={th}>{t("Poznámka", "Note")}</th>
                  <th style={{ ...th, textAlign: "right" }}><span className="sr-only">{t("Akcie", "Actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td className="rd-td--empty" colSpan={12}>
                    {q ? t(`Nikto nevyhovuje „${search}“.`, `No users match "${search}".`) : t("V tomto filtri nikto nie je.", "Nobody in this filter.")}
                  </td></tr>
                ) : visible.map((u) => (
                  <UserRow
                    key={u.id}
                    u={u}
                    lang={lang}
                    now={now}
                    isSelf={u.id === selfId}
                    busy={busyId === u.id}
                    flashing={flashId === u.id}
                    premiumDomain={premiumSet?.has((u.email_domain || "").toLowerCase())}
                    onType={(tier) => changeType(u, tier)}
                    onDate={(field, day) => saveDate(u, field, day)}
                    onEdit={() => setForm({ mode: "edit", user: u })}
                    onDelete={() => askDelete(u)}
                    glance={glance ? (glance[u.id] || {}) : null}
                    onActivity={() => openActivity(u.id)}
                  />
                ))}
              </tbody>
            </table>
          </EdgeScroll>
        </div>
      )}

      <p className="rd-note" style={{ marginTop: "0.8rem" }}>
        {t(
          "Premium od–do platí po celé dni (do = vrátane toho dňa). Prepnutie na Free alebo Bez prístupu ukončí bežiace Premium dnes; prepnutie na Premium ho začne dnes bez konca. Dátumy upravíš kliknutím na ne.",
          "Premium from–to covers whole days (to = including that day). Switching to Free or No access ends running Premium today; switching to Premium starts it today with no end. Click a date to edit it.",
        )}
      </p>

      {form && (
        <UserForm
          mode={form.mode}
          user={form.user}
          isSelf={form.user?.id === selfId}
          lang={lang}
          now={now}
          onClose={() => setForm(null)}
          onSaved={(row, message, serverNow) => {
            bumpClock(serverNow);
            if (form.mode === "create") {
              setUsers((us) => [row, ...us.filter((x) => x.id !== row.id)]);
              // and the sign-up list under the table, which now has this account
              // ("ADDED BY ADMIN") — fetched in the background, no loading frame
              reload({ silent: true });
            }
            else replaceRow(row);
            setForm(null);
            flash(row.id);
            say(message.kind, message.text);
          }}
        />
      )}

      {activityId && (
        <UserActivity
          userId={activityId}
          profile={(users || []).find((x) => x.id === activityId)}
          lang={lang}
          onClose={() => openActivity(null)}
        />
      )}

      <ConfirmDialog
        state={confirm}
        lang={lang}
        onClose={() => setConfirm(null)}
      />

      {toast && (
        <div className={`rd-toast rd-alert ${toast.kind === "ok" ? "rd-alert--ok" : toast.kind === "warn" ? "rd-alert--warn" : "rd-alert--err"}`} role={toast.kind === "ok" ? "status" : "alert"}>
          <span>{toast.kind === "ok" ? "✓" : "!"}</span>
          <span>{toast.text}</span>
          <button type="button" className="rd-alert__x" onClick={() => setToast(null)} aria-label={t("Zavrieť", "Close")}>×</button>
        </div>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────

function UserRow({ u, lang, now, isSelf, busy, flashing, premiumDomain, onType, onDate, onEdit, onDelete, glance, onActivity }) {
  const t = L(lang);
  const personal = isPersonalEmail(u.email || "");
  const status = accountStatus(u, now);
  const isPremium = u.tier === "paid";
  const editable = isPremium && !isSelf;
  const rowStyle = {
    opacity: busy ? 0.55 : 1,
    transition: "background 0.6s var(--ease), opacity 0.15s",
    background: flashing ? "color-mix(in srgb, var(--accent) 10%, transparent)" : undefined,
  };
  return (
    <tr style={rowStyle} aria-busy={busy || undefined}>
      <td className="rd-td--key">
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", maxWidth: 260 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }} title={u.email}>{u.email}</span>
          {isSelf && <span className="rd-badge rd-badge--warn" title={t("To si ty", "That's you")}>{t("ty", "you")}</span>}
          {premiumDomain && !isSelf && <span className="rd-badge rd-badge--ok" title={t("Prémiová doména", "Premium domain")}>★</span>}
          {personal && !isSelf && <span className="rd-badge" style={{ color: "var(--text-dim)", borderColor: "var(--border)" }} title={t("Osobný e-mail (gmail, azet…) — sám sa zaregistrovať nemôže, účet mu vytvára admin.", "Personal e-mail (gmail, …) — cannot self-register; an admin creates the account.")}>{t("osobný", "personal")}</span>}
        </span>
      </td>
      <Clip value={u.full_name} max={150} style={{ color: "var(--text)" }} />
      <Clip value={u.company} max={140} />
      <Clip value={u.position} max={110} />
      <td>
        {u.phone || u.linkedin_url ? (
          <span style={{ display: "inline-flex", gap: "0.15rem" }}>
            {u.phone && <a className="rd-btn rd-btn--sm rd-btn--ghost rd-icon-btn" href={`tel:${u.phone.replace(/[^0-9+]/g, "")}`} title={u.phone} aria-label={`${t("Telefón", "Phone")} ${u.phone}`}><IconPhone /></a>}
            {u.linkedin_url && <a className="rd-btn rd-btn--sm rd-btn--ghost rd-icon-btn" href={u.linkedin_url} target="_blank" rel="noopener noreferrer" title={u.linkedin_url} aria-label="LinkedIn"><IconLinkedIn /></a>}
          </span>
        ) : <Dash />}
      </td>
      <td>
        <div
          title={isSelf ? t("Vlastný typ účtu meniť nemôžeš", "You can't change your own account type") : undefined}
          style={{ display: "inline-block", opacity: isSelf ? 0.5 : 1, pointerEvents: isSelf || busy ? "none" : "auto" }}>
          <Picker small value={u.tier} onChange={onType} width={118} ariaLabel={t("Typ účtu", "Account type")} sk={lang === "sk"} options={typeOptions(lang)} />
        </div>
        <StatusLine u={u} status={status} lang={lang} />
      </td>
      <td><DateCell u={u} field="paid_started_at" editable={editable} lang={lang} onSave={onDate} today={dayKey(now)} /></td>
      <td><DateCell u={u} field="paid_until" editable={editable} lang={lang} onSave={onDate} status={status} today={dayKey(now)} /></td>
      <td>
        <button type="button" className="rd-ua-open" onClick={onActivity}
          title={t("Otvoriť aktivitu: čo robí, kedy, ako a koľko", "Open activity: what they do, when, how and how much")}>
          {!glance ? <span className="rd-ua-open__when" style={{ color: "var(--text-faint)" }}>{t("otvoriť", "open")}</span> : glance.last_active_at ? (
            <>
              <span className="rd-ua-open__when">{relDays(new Date(glance.last_active_at), new Date(now), lang)}</span>
              <span className="rd-ua-open__days">{glance.active_days_30} {t("d / 30", "d / 30")}</span>
            </>
          ) : <span className="rd-ua-open__when" style={{ color: "var(--text-faint)" }}>{t("zatiaľ nič", "nothing yet")}</span>}
        </button>
      </td>
      <td style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "0.74rem" }}>{fmtDay(u.created_at, lang)}</td>
      <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }} title={u.subscription_note || undefined}>
        {u.subscription_note ? u.subscription_note.replace(/\s*\n\s*/g, " · ") : <Dash />}
      </td>
      <td style={{ textAlign: "right" }}>
        <span style={{ display: "inline-flex", gap: "0.25rem" }}>
          <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost rd-icon-btn" onClick={onActivity}
            title={t("Aktivita", "Activity")} aria-label={`${t("Aktivita", "Activity")} ${u.email}`}>
            <IconActivity />
          </button>
          <button type="button" className="rd-btn rd-btn--sm rd-icon-btn" onClick={onEdit} disabled={busy}
            title={t("Upraviť", "Edit")} aria-label={`${t("Upraviť", "Edit")} ${u.email}`}>
            <IconPencil />
          </button>
          <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost rd-icon-btn rd-icon-btn--danger" onClick={onDelete} disabled={isSelf || busy}
            title={isSelf ? t("Seba vymazať nemôžeš", "You can't delete yourself") : t("Vymazať natrvalo", "Delete permanently")}
            aria-label={`${t("Vymazať", "Delete")} ${u.email}`}>
            <IconTrash />
          </button>
        </span>
      </td>
    </tr>
  );
}

/** A sideways-scrolling box that SHOWS when there is more to the right:
 *  on a narrower screen the table scrolls, and a shaded edge says so instead of
 *  silently hiding the last columns (on a Mac the scrollbar is invisible until used). */
function EdgeScroll({ children }) {
  const ref = useRef(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) { ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild); }
    return () => { el.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); ro?.disconnect(); };
  }, []);
  return (
    <div className="rd-edge-scroll" data-more-right={more || undefined}>
      <div ref={ref} className="rd-scroll">{children}</div>
    </div>
  );
}

const Dash = () => <span style={{ color: "var(--text-faint)" }}>—</span>;

/** A text cell that never stretches the table: long values end in "…" and show whole on hover. */
const Clip = ({ value, max, style }) => (
  <td title={value && value.length > 18 ? value : undefined}
    style={{ maxWidth: max, overflow: "hidden", textOverflow: "ellipsis", ...style }}>
    {value || <Dash />}
  </td>
);

const svg = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const IconActivity = () => <svg {...svg}><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>;
const IconPencil = () => <svg {...svg}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
const IconPhone = () => <svg {...svg}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" /></svg>;
const IconLinkedIn = () => <svg {...svg}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6Z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>;
const IconTrash = () => <svg {...svg}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>;

/** A line under the type — only when what the person gets differs from the type. */
function StatusLine({ u, status, lang }) {
  const t = L(lang);
  let text = null, warn = false;
  if (status.key === "trial") text = t(`trial do ${fmtDay(status.until, lang)}`, `trial until ${fmtDay(status.until, lang)}`);
  else if (status.key === "expired") { text = t("Premium skončilo — má Free", "Premium ended — has Free"); warn = true; }
  else if (status.key === "paused") { text = t("pozastavené — má Free", "paused — has Free"); warn = true; }
  else if (status.key === "incomplete") text = t("registrácia nedokončená", "sign-up not finished");
  else if (status.key === "premium" && u.tier !== "paid") text = t("má Premium (podľa dátumov)", "has Premium (by its dates)");
  const stripe = Boolean(u.stripe_subscription_id);
  if (!text && !stripe) return null;
  return (
    <div style={{ fontSize: "0.66rem", marginTop: 3, color: warn ? "var(--accent-2)" : "var(--text-dim)", whiteSpace: "nowrap" }}>
      {text}{text && stripe ? " · " : ""}{stripe && <span title={t("Platí cez Stripe", "Pays through Stripe")}>Stripe</span>}
    </div>
  );
}

/**
 * One Premium date, edited where it stands: click → a date box with ✓ / ✕ (and
 * "no end" for the end date). Enter saves, Escape cancels. Nothing is sent while
 * the date is being typed — a date box reports "0002-10-06" on the way to 2026.
 */
function DateCell({ u, field, editable, lang, onSave, status, today }) {
  const t = L(lang);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const isEnd = field === "paid_until";
  const v = u[field];

  const open = () => { setVal(dayKey(v) || (isEnd ? "" : dayKey(Date.now()))); setEditing(true); };
  const save = async (next) => {
    const day = next === undefined ? val : next;
    if (day === (dayKey(v) || "")) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(field, day || null);
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <span
        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(false); }
        }}>
        <DateField small width={128} value={val} onChange={(e) => setVal(e.target.value)} ariaLabel={isEnd ? t("Premium do", "Premium to") : t("Premium od", "Premium from")}
          min={isEnd ? dayKey(u.paid_started_at) : undefined}
          max={isEnd ? undefined : [today, dayKey(u.paid_until)].filter(Boolean).sort()[0]} />
        <button type="button" className="rd-btn rd-btn--sm rd-btn--primary" disabled={saving || (!isEnd && !val)} onClick={() => save()} title={t("Uložiť (Enter)", "Save (Enter)")}>✓</button>
        {isEnd && <button type="button" className="rd-btn rd-btn--sm" disabled={saving} onClick={() => save("")} title={t("Premium bez konca", "Premium with no end")}>∞</button>}
        <button type="button" className="rd-btn rd-btn--sm rd-btn--ghost" disabled={saving} onClick={() => setEditing(false)} title={t("Zrušiť (Esc)", "Cancel (Esc)")}>✕</button>
      </span>
    );
  }

  const shown = fmtDay(v, lang);
  const ended = isEnd && status?.key === "expired";
  const content = shown
    ? <span style={{ color: ended ? "var(--accent-2)" : (u.tier === "paid" ? "var(--text)" : "var(--text-dim)") }}>{shown}{ended ? ` · ${t("skončilo", "ended")}` : ""}</span>
    : (isEnd && u.tier === "paid" ? <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>{t("bez konca", "no end")}</span>
      // a Premium account with no start on record (older accounts) — ask for it, don't hide it
      : !isEnd && u.tier === "paid" && editable ? <span style={{ color: "var(--accent-2)", fontStyle: "italic" }}>{t("doplniť", "add")}</span>
      : <Dash />);

  if (!editable) {
    return <span title={u.tier !== "paid" && shown ? t("Posledné obdobie Premium (už neplatí)", "Last Premium period (no longer running)") : undefined}
      style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem" }}>{content}</span>;
  }
  return (
    <button type="button" onClick={open} className="rd-btn rd-btn--sm rd-btn--ghost rd-date-btn"
      title={!shown && !isEnd ? t("Premium nemá zapísaný začiatok — klikni a doplň ho", "This Premium has no start date — click to add it") : t("Klikni a zmeň dátum", "Click to change the date")}
      aria-label={`${isEnd ? t("Premium do", "Premium to") : t("Premium od", "Premium from")}: ${shown || (isEnd ? t("bez konca", "no end") : t("nezadané", "not set"))} — ${t("zmeniť", "change")}`}>
      {content}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────

/** "Add user" and "Edit user" — one form. */
function UserForm({ mode, user, isSelf, lang, now, onClose, onSaved }) {
  const t = L(lang);
  const creating = mode === "create";
  const today = dayKey(now);
  const init = useMemo(() => {
    const u = user || {};
    const isPaid = u.tier === "paid";
    return {
      email: u.email || "",
      full_name: u.full_name || "",
      company: u.company || "",
      position: u.position || "",
      phone: u.phone || "",
      linkedin_url: u.linkedin_url || "",
      tier: creating ? "free" : (u.tier || "free"),
      // A non-Premium account shows the defaults a switch to Premium would use.
      from: isPaid ? (dayKey(u.paid_started_at) || "") : today,
      to: isPaid ? (dayKey(u.paid_until) || "") : "",
      note: u.subscription_note || "",
      // New account: announce it by default. Existing one: only when asked —
      // e.g. the dates changed after the first e-mail, or it never arrived.
      send_invite: creating,
      invite_lang: lang === "en" ? "en" : "sk",
    };
  }, [user, creating, today, lang]);
  const [f, setF] = useState(init);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e && e.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));
  const dirty = JSON.stringify(f) !== JSON.stringify(init);

  const premium = f.tier === "paid";
  const wasPremium = !creating && user?.tier === "paid";
  // Client-side checks mirror the server's (lib/adminUsers.js) so the form says
  // what is wrong before a round trip; the server checks again regardless.
  const problems = [];
  if (creating && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) problems.push(t("Zadaj platný e-mail.", "Enter a valid e-mail."));
  if (!f.full_name.trim() && (creating || user?.full_name)) problems.push(t("Meno je povinné.", "Name is required."));
  // A new Premium period needs its first day (an untouched legacy row without one may stay as it is).
  if (premium && !f.from && (creating || f.tier !== init.tier || init.from)) problems.push(t("Zadaj, odkedy má Premium.", "Enter when Premium starts."));
  if (premium && f.from && f.from > today) problems.push(t("„Premium od“ nemôže byť v budúcnosti.", "'Premium from' cannot be in the future."));
  if (premium && f.from && f.to && f.to < f.from) problems.push(t("„Premium do“ je skôr ako „Premium od“.", "'Premium to' is earlier than 'Premium from'."));
  const personal = creating && isPersonalEmail(f.email.trim());

  const submit = async (e) => {
    e?.preventDefault();
    setAttempted(true);
    if (problems.length || saving) return;
    setSaving(true); setError(null);
    let r;
    if (creating) {
      r = await callAdmin("/api/admin/create-user", {
        email: f.email.trim(), full_name: f.full_name, company: f.company, position: f.position,
        phone: f.phone, linkedin_url: f.linkedin_url, tier: f.tier,
        ...(premium ? { paid_started_at: f.from || null, paid_until: f.to || null } : {}),
        subscription_note: f.note, send_invite: f.send_invite, invite_lang: f.invite_lang,
      }, lang);
    } else {
      // Send only what changed: re-sending an untouched date would turn a stored
      // moment (e.g. Stripe's 14:03) into the end of that day.
      const p = {};
      for (const [k, fk] of [["full_name", "full_name"], ["company", "company"], ["position", "position"], ["phone", "phone"], ["linkedin_url", "linkedin_url"], ["subscription_note", "note"]]) {
        if (f[fk] !== init[fk]) p[k] = f[fk];
      }
      if (f.tier !== init.tier) p.tier = f.tier;
      if (premium) {
        if (f.from !== init.from) p.paid_started_at = f.from || null;
        if (f.to !== init.to) p.paid_until = f.to || null;
      }
      const announce = f.send_invite && f.tier !== "pending";
      if (Object.keys(p).length === 0 && !announce) { onClose(); return; }
      r = await callAdmin("/api/admin/set-subscription", {
        user_id: user.id, ...p, ...(announce ? { send_invite: true, invite_lang: f.invite_lang } : {}),
      }, lang);
    }
    setSaving(false);
    if (!r.ok) {
      if (!creating && r.j?.error === "nothing_to_change") { onClose(); return; }
      setError(r.text);
      return;
    }
    const row = r.j.user;
    let message = { kind: "ok", text: creating ? t(`Účet vytvorený: ${row.email}`, `Account created: ${row.email}`) : t(`Uložené: ${row.email}`, `Saved: ${row.email}`) };
    if (r.j.invite === "sent") message.text += t(" · e-mail s prístupom odoslaný", " · access e-mail sent");
    if (r.j.invite === "failed") {
      message = { kind: "warn", text: creating
        ? t(`Účet ${row.email} je vytvorený, ale e-mail sa nepodarilo odoslať (${r.j.invite_error || "?"}). Daj mu vedieť sám: prihlási sa na residata.eu svojím e-mailom a jednorazovým kódom.`, `Account ${row.email} is created, but the e-mail failed (${r.j.invite_error || "?"}). Tell them yourself: they sign in at residata.eu with their e-mail and a one-time code.`)
        : t(`Uložené: ${row.email}, ale e-mail sa nepodarilo odoslať (${r.j.invite_error || "?"}). Skús to znova alebo mu daj vedieť sám.`, `Saved: ${row.email}, but the e-mail failed (${r.j.invite_error || "?"}). Try again or tell them yourself.`) };
    }
    onSaved(row, message, r.j.now);
  };

  const field = (k, lbl, { required, type = "text", placeholder, full, auto } = {}) => (
    <label className={`rd-form__item${full ? " rd-form__full" : ""}`}>
      <span className="rd-label">{lbl}{required && <span className="rd-form__req">*</span>}</span>
      <input className="rd-field" type={type} value={f[k]} onChange={set(k)} placeholder={placeholder} autoComplete="off" {...(auto ? { "data-autofocus": true } : {})} />
    </label>
  );

  const typeChoices = typeOptions(lang, { includePending: !creating });

  return (
    <Modal
      open
      onClose={onClose}
      dismissable={!dirty}
      width={620}
      title={creating ? t("Pridať užívateľa", "Add user") : t("Upraviť užívateľa", "Edit user")}
      footer={(
        <>
          {/* An empty form is not an error — say what is missing once they have started. */}
          {problems.length > 0 && (dirty || attempted) && <span className="rd-form__hint" style={{ marginRight: "auto", color: "var(--accent-2)" }}>{problems[0]}</span>}
          <button type="button" className="rd-btn" onClick={onClose} disabled={saving}>{t("Zrušiť", "Cancel")}</button>
          <button type="submit" form="rd-user-form" className="rd-btn rd-btn--primary" disabled={saving || problems.length > 0 || (!creating && !dirty)}>
            {saving ? t("Ukladám…", "Saving…") : creating ? t("Vytvoriť účet", "Create account") : t("Uložiť zmeny", "Save changes")}
          </button>
        </>
      )}>
      <form id="rd-user-form" onSubmit={submit} className="rd-form" noValidate>
        {creating
          ? field("email", "E-mail", { required: true, type: "email", placeholder: "meno@firma.sk", full: true, auto: true })
          : (
            <div className="rd-form__item rd-form__full">
              <span className="rd-label">E-mail</span>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>{user.email}</div>
              <span className="rd-form__hint">{t("E-mail je prihlasovacie meno a nemení sa. Ak je v ňom preklep, vymaž účet a vytvor nový.", "The e-mail is the sign-in and does not change. If it has a typo, delete the account and create a new one.")}</span>
            </div>
          )}
        {!creating && user?.stripe_subscription_id && (
          <div className="rd-form__full rd-alert rd-alert--warn" style={{ fontSize: "0.74rem" }}>
            {t("Platí kartou (Stripe). Dátumy Premium riadi Stripe a meniť sa nedajú. Prepnutím na Free alebo Bez prístupu sa predplatné hneď zruší.",
               "Pays by card (Stripe). Stripe owns the Premium dates; they cannot be changed. Switching to Free or No access cancels the subscription at once.")}
          </div>
        )}
        {personal && (
          <div className="rd-form__full rd-alert" style={{ fontSize: "0.74rem" }}>
            {t("Osobný e-mail (gmail, azet…): cez web by sa sám nezaregistroval, cez admin je to v poriadku — adresu pustíme cez filter, aby sa vedel aj prihlasovať.",
               "Personal e-mail (gmail, …): they could not sign up on the web themselves; through admin it is fine — the address is let past the filter so they can also sign in.")}
          </div>
        )}
        {field("full_name", t("Meno a priezvisko", "Full name"), { required: creating || Boolean(user?.full_name), auto: !creating })}
        {field("company", t("Firma", "Company"))}
        {field("position", t("Pozícia", "Position"))}
        {field("phone", t("Telefón", "Phone"), { type: "tel" })}
        {field("linkedin_url", "LinkedIn", { type: "url", placeholder: "https://linkedin.com/in/…", full: true })}

        <div className="rd-form__sep" />

        <div className="rd-form__item rd-form__full">
          <span className="rd-label">{t("Typ účtu", "Account type")}</span>
          <div className="rd-seg rd-seg--wrap" role="radiogroup" aria-label={t("Typ účtu", "Account type")} style={{ alignSelf: "flex-start", opacity: isSelf ? 0.5 : 1 }}>
            {typeChoices.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={f.tier === o.value} aria-pressed={f.tier === o.value} className="rd-seg__btn"
                disabled={isSelf} onClick={() => setF((s) => ({ ...s, tier: o.value }))} title={o.hint}>
                {o.label}
              </button>
            ))}
          </div>
          <span className="rd-form__hint">
            {isSelf ? t("Vlastný typ účtu meniť nemôžeš.", "You can't change your own account type.")
              : f.tier === "free" ? t("Prehľad trhu + detail jedného projektu, ktorý si sám vyberie.", "Market overview + the full detail of one project they pick.")
              : f.tier === "paid" ? t("Všetky projekty, analytika, história, exporty — počas obdobia nižšie.", "Every project, analytics, history, exports — during the period below.")
              : f.tier === "admin" ? t("Všetko vrátane správy užívateľov, článkov a nastavení.", "Everything, including managing users, articles and settings.")
              : t("Prihlási sa, ale neuvidí žiadne dáta.", "Can sign in but sees no data.")}
            {wasPremium && f.tier !== "paid" && ` ${t("Bežiace Premium sa ukončí dnes.", "Running Premium ends today.")}`}
          </span>
          {f.tier === "admin" && !isSelf && (creating || user?.tier !== "admin") && (
            <span className="rd-form__hint" style={{ color: "var(--accent-2)" }}>
              {t("Pozor: admin vidí a mení všetko, aj ostatných užívateľov. Daj ho len ľuďom z tímu.", "Careful: an admin sees and changes everything, other users included. Team members only.")}
            </span>
          )}
        </div>

        {premium && (
          <>
            <label className="rd-form__item">
              <span className="rd-label">{t("Premium od", "Premium from")}</span>
              <DateField value={f.from} onChange={set("from")} width="100%" ariaLabel={t("Premium od", "Premium from")} max={today} />
              <span className="rd-form__hint">{t("Dnes alebo skôr.", "Today or earlier.")}</span>
            </label>
            <label className="rd-form__item">
              <span className="rd-label">{t("Premium do", "Premium to")}</span>
              <span style={{ display: "flex", gap: 6 }}>
                <DateField value={f.to} onChange={set("to")} width="100%" ariaLabel={t("Premium do", "Premium to")} min={f.from || undefined} />
                {f.to && <button type="button" className="rd-btn" onClick={() => setF((s) => ({ ...s, to: "" }))} title={t("Bez konca", "No end")}>∞</button>}
              </span>
              <span className="rd-form__hint">{f.to ? t("Vrátane tohto dňa.", "Including that day.") : t("Prázdne = Premium bez konca.", "Empty = Premium with no end.")}</span>
            </label>
          </>
        )}

        <label className="rd-form__item rd-form__full">
          <span className="rd-label">{t("Interná poznámka", "Internal note")}</span>
          <textarea className="rd-field" value={f.note} onChange={set("note")} maxLength={500} rows={2}
            placeholder={t("Napr. novinár — prístup výmenou za uvedenie zdroja. Vidí len admin.", "E.g. journalist — access in exchange for credit. Admins only.")} />
        </label>

        {(creating || f.tier !== "pending") && (
          <div className="rd-form__full" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem 1rem" }}>
            <label className="rd-check">
              <input type="checkbox" checked={f.send_invite} onChange={set("send_invite")} />
              {creating
                ? t("Poslať mu e-mail, že má účet pripravený", "E-mail them that the account is ready")
                : t("Poslať mu e-mail s jeho prístupom", "E-mail them their access")}
            </label>
            {f.send_invite && (
              <div className="rd-seg" role="group" aria-label={t("Jazyk e-mailu", "E-mail language")}>
                {["sk", "en"].map((lg) => (
                  <button key={lg} type="button" className="rd-seg__btn" aria-pressed={f.invite_lang === lg} onClick={() => setF((s) => ({ ...s, invite_lang: lg }))}>{lg.toUpperCase()}</button>
                ))}
              </div>
            )}
            <span className="rd-form__hint" style={{ flexBasis: "100%" }}>
              {!creating
                ? t("Príde mu „Váš účet na Residata je pripravený“ s tým, čo bude mať po uložení, a ako sa prihlási. Napr. keď si zmenil dátumy alebo prvý e-mail nedošiel.",
                    "They get “Your Residata account is ready” with what they will have after saving, and how to sign in. E.g. when you changed the dates or the first e-mail never arrived.")
                : f.send_invite
                ? t("Príde mu „Váš účet na Residata je pripravený“: čo má k dispozícii a že sa prihlási svojím e-mailom a jednorazovým kódom (bez hesla).",
                    "They get “Your Residata account is ready”: what they have, and that they sign in with their e-mail and a one-time code (no password).")
                : t("Účet sa vytvorí potichu — daj mu vedieť sám: prihlási sa na residata.eu svojím e-mailom a jednorazovým kódom.",
                    "The account is created silently — tell them yourself: they sign in at residata.eu with their e-mail and a one-time code.")}
            </span>
          </div>
        )}

        {error && <div className="rd-form__full rd-alert rd-alert--err" role="alert">{error}</div>}
        {/* Enter in any field submits; the visible button lives in the footer. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

// ───────────────────────────────────────────────────────────────────────────

function ConfirmDialog({ state, lang, onClose }) {
  const t = L(lang);
  if (!state) return null;
  // Close first, then run: the run may open the NEXT question (an admin grant on
  // a Stripe subscriber asks about Stripe too), and the row shows its own progress.
  const ok = () => { const run = state.run; onClose(); run(); };
  const cancel = () => { state.onCancel?.(); onClose(); };
  return (
    <Modal open onClose={cancel} title={state.title} width={460}
      footer={(
        <>
          <button type="button" className="rd-btn" onClick={cancel} data-autofocus>{t("Zrušiť", "Cancel")}</button>
          <button type="button" className={`rd-btn ${state.danger ? "rd-btn--warn" : "rd-btn--primary"}`} onClick={ok}
            style={state.danger ? { color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 55%, transparent)" } : undefined}>
            {state.okLabel}
          </button>
        </>
      )}>
      <p style={{ margin: 0, color: "var(--text-2)", lineHeight: 1.55, fontSize: "0.86rem" }}>{state.body}</p>
    </Modal>
  );
}

/** The strip above the tabs: how many people HAVE what, today (not the raw type column). */
export function UserStats({ users, lang = "sk", now }) {
  const t = L(lang);
  const c = statusCounts(users, now);
  const cards = [
    { k: "total",   l: t("Celkom", "Total"), n: c.total },
    { k: "premium", l: "Premium", n: c.premium },
    ...(c.trial ? [{ k: "trial", l: "Trial", n: c.trial }] : []),
    { k: "free",    l: "Free", n: c.free },
    { k: "admin",   l: "Admin", n: c.admin },
    { k: "none",    l: t("Bez prístupu", "No access"), n: c.none },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.7rem", marginTop: "1.5rem", marginBottom: "1rem" }}>
      {cards.map((x) => <Kpi key={x.k} label={x.l} value={x.n} />)}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────

/**
 * The newest accounts as they arrived — under the table on the Users tab. Each
 * row says HOW the account came: a sign-up, a sign-up on a personal e-mail, one of
 * several from one company (worth a look), or made here by an admin.
 */
const EVENT_KINDS = {
  new_signup:                ["ok",   "registrácia", "sign-up"],
  new_signup_personal_email: ["warn", "osobný e-mail", "personal e-mail"],
  new_signup_suspicious_org: ["bad",  "veľa z jednej firmy", "many from one org"],
  new_signup_admin_created:  ["info", "pridal admin", "added by admin"],
};

export function SignupEvents({ events, users, lang = "sk" }) {
  const t = L(lang);
  if (!events || events.length === 0) return null;
  const live = new Set((users || []).map((u) => (u.email || "").toLowerCase()));
  const when = (ts) => new Date(ts).toLocaleString(localeTag(lang), { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const th = { padding: "0 0.7rem" };
  return (
    <section style={{ marginTop: "2.2rem" }}>
      <div className="rd-sect" style={{ marginBottom: "0.7rem" }}>
        <span className="rd-sect__tick" />
        <span className="rd-sect__name">{t("Nové účty", "New accounts")}</span>
        <span className="rd-sect__count">{t(`posledných ${events.length}`, `latest ${events.length}`)}</span>
      </div>
      <div className="rd-card" style={{ padding: 0 }}>
        <div className="rd-scroll">
          <table className="rd-table rd-table--compact">
            <thead>
              <tr>
                <th style={th}>{t("Kedy", "When")}</th>
                <th style={th}>{t("Ako", "How")}</th>
                <th style={th}>E-mail</th>
                <th style={th}>{t("Doména", "Domain")}</th>
                <th style={{ ...th, textAlign: "right" }} title={t("Koľko účtov už mala táto doména", "How many accounts this domain had")}>{t("Účtov z domény", "From domain")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const [tone, sk, en] = EVENT_KINDS[e.event_type] || ["info", e.event_type, e.event_type];
                const email = e.new_value?.email || "";
                const gone = email && !live.has(email.toLowerCase());
                const cls = tone === "ok" ? "rd-badge rd-badge--ok" : tone === "warn" ? "rd-badge rd-badge--warn" : "rd-badge";
                const badgeStyle = tone === "bad" ? { color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" }
                  : tone === "info" ? { color: "var(--text-2)", borderColor: "var(--border)" } : undefined;
                const n = e.new_value?.org_count;
                return (
                  <tr key={e.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--text-dim)" }}>{e.detected_at ? when(e.detected_at) : "—"}</td>
                    <td><span className={cls} style={badgeStyle}>{lang === "sk" ? sk : en}</span></td>
                    <td style={{ color: gone ? "var(--text-faint)" : "var(--text)" }}>
                      {email || <Dash />}{gone && <span style={{ marginLeft: 6, fontSize: "0.68rem" }}>({t("vymazaný", "deleted")})</span>}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem" }}>{e.new_value?.domain || <Dash />}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: n > 3 ? "var(--accent-2)" : "var(--text-dim)" }}>{n ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
