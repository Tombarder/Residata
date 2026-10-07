/**
 * One person's activity — admin → Users → a person (also /app/admin?tab=users&user=<id>,
 * which the "new sign-up" e-mail links to, and admin → Usage).
 *
 * Boss 2026-10-07: "what he's doing, when, how, how much … per user … must work but
 * also look good, intuitive, nice". Everything comes from ONE call,
 * admin_user_activity (supabase_migration_2026_10_user_activity_profile.sql), so the
 * page never pulls raw rows into the browser; lib/userActivity.js turns the numbers
 * into words (and is tested).
 *
 * Two kinds of record, and the page says which is which:
 *   - recorded for everybody: sign-ins, AI questions, saved items, feedback, errors,
 *     admin changes;
 *   - recorded only with the analytics cookie: pages, time, clicks, downloads. A person
 *     who declined is shown as such, never as "does nothing".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import Kpi from "../components/Kpi";
import { supabaseData } from "../lib/supabase";
import { getFreshAccessToken, authErrorMessage } from "../lib/sessionGuard";
import { localeTag } from "../lib/locale";
import { pageTitle } from "../lib/pageTitles";
import { TZ, accountStatus, STATUS_LABELS, label } from "../lib/adminUsers";
import {
  describeUserAgent, fmtMinutes, deltaLine, engagementOf, summarize, eventName, exportName,
  relDays, weekdayName, usualTimes,
} from "../lib/userActivity";

const L = (lang) => (sk, en) => (lang === "sk" ? sk : en);
const PERIODS = [7, 30, 90, 365];

const fmtDate = (ts, lang) => (ts ? new Date(ts).toLocaleDateString(localeTag(lang), { day: "numeric", month: "numeric", year: "numeric", timeZone: TZ }) : "—");
const fmtDateTime = (ts, lang) => (ts ? new Date(ts).toLocaleString(localeTag(lang), { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "—");
const fmtTime = (ts, lang) => (ts ? new Date(ts).toLocaleTimeString(localeTag(lang), { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "");
const num = (n) => (Number(n) || 0).toLocaleString("en-US").replace(/,/g, " ");

export default function UserActivity({ userId, profile, lang = "sk", onClose }) {
  const t = L(lang);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState("overview");
  const [nonce, setNonce] = useState(0);            // "Retry" asks again
  const [openedAt] = useState(() => Date.now());    // the clock until the server's arrives
  // What came back, and for which question: loading = the answer on screen is not for
  // the question being asked (another person, another period, a retry).
  const key = `${userId}:${days}:${nonce}`;
  const [res, setRes] = useState({ key: null, data: null, err: null });
  useEffect(() => {
    let live = true;
    (async () => {
      let out;
      try {
        await getFreshAccessToken();
        const { data: d, error } = await supabaseData.rpc("admin_user_activity", { p_user_id: userId, p_days: days });
        out = error ? { err: authErrorMessage(error, lang) } : { data: d || null };
      } catch (e) {
        out = { err: authErrorMessage(e, lang) };
      }
      if (live) setRes((prev) => ({ key, data: out.data ?? (out.err ? prev.data : null), err: out.err || null }));
    })();
    return () => { live = false; };
  }, [key, userId, days, lang]);
  const loading = res.key !== key;
  const data = res.data;
  const err = loading ? null : res.err;
  const load = useCallback(() => setNonce((n) => n + 1), []);

  const person = data?.person || profile || {};
  const title = person.full_name || person.email || t("Užívateľ", "User");
  const now = useMemo(() => new Date(data?.generated_at || openedAt), [data?.generated_at, openedAt]);
  const status = accountStatus({ ...(profile || {}), ...(data?.person || {}) }, now.getTime());
  const eng = data ? engagementOf(data, now) : null;
  const k = data?.kpis?.cur || {};
  const kp = data?.kpis?.prev || {};
  const visits = data?.visits || [];
  const exportsN = (data?.exports || []).length;
  const questionsN = (data?.questions || []).length;
  const consent = person.analytics_consent;

  return (
    <Modal open onClose={onClose} width={1120} title={title}>
      <div className="rd-ua">
        {/* who */}
        <div className="rd-ua__who">
          <div className="rd-ua__id">
            {person.full_name && <span className="rd-ua__email">{person.email}</span>}
            {(person.company || person.position) && (
              <span className="rd-ua__org">{[person.company, person.position].filter(Boolean).join(" · ")}</span>
            )}
          </div>
          <div className="rd-ua__badges">
            <span className={`rd-badge${status.key === "premium" || status.key === "trial" ? " rd-badge--ok" : status.key === "blocked" || status.key === "incomplete" || status.key === "expired" ? " rd-badge--warn" : ""}`}>
              {label(STATUS_LABELS, status.key, lang)}{status.until ? ` ${t("do", "until")} ${fmtDate(status.until, lang)}` : ""}
            </span>
            {eng && <span className={`rd-badge${eng.tone === "ok" ? " rd-badge--ok" : eng.tone === "warn" ? " rd-badge--warn" : ""}`}>{lang === "sk" ? eng.sk : eng.en}</span>}
            {data && (
              <span className="rd-badge" title={consent === false
                ? t("Odmietnuté analytické cookies: stránky, čas a kliky sa nezaznamenávajú.", "Analytics cookies declined: pages, time and clicks are not recorded.")
                : consent === true ? t("Analytické cookies povolené.", "Analytics cookies accepted.")
                : t("Voľbu cookies sme pri prihlásení ešte nezaznamenali.", "No cookie choice recorded while signed in yet.")}>
                🍪 {consent === false ? t("cookies odmietnuté", "cookies declined") : consent === true ? t("cookies povolené", "cookies accepted") : t("cookies ?", "cookies ?")}
              </span>
            )}
            {person.last_active_at && (
              <span className="rd-badge" title={fmtDateTime(person.last_active_at, lang)}>
                {t("naposledy", "last seen")} {relDays(new Date(person.last_active_at), now, lang)}
              </span>
            )}
          </div>
          <div className="rd-seg" role="group" aria-label={t("Obdobie", "Period")}>
            {PERIODS.map((d) => (
              <button key={d} type="button" className="rd-seg__btn" aria-pressed={days === d} onClick={() => setDays(d)}>
                {d === 365 ? t("rok", "year") : `${d} ${t("dní", "days")}`}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="rd-alert rd-alert--err" style={{ marginTop: "0.8rem" }}>
            {err} <button type="button" className="rd-btn rd-btn--sm" onClick={load} style={{ marginLeft: "auto" }}>{t("Skúsiť znova", "Retry")}</button>
          </div>
        )}

        {/* the whole picture in words */}
        <p className="rd-ua__summary" aria-busy={loading || undefined}>
          {loading && !data ? t("Načítavam…", "Loading…") : summarize(data, { lang, now, pageName: (p) => pageTitle(p, lang) })}
        </p>

        {/* how much, against the period before */}
        <div className="rd-ua__kpis" style={{ opacity: loading && data ? 0.55 : 1 }}
          title={t(`Posledných ${days} dní; „predtým“ = ${days} dní pred nimi.`, `The last ${days} days; "before" = the ${days} days before them.`)}>
          <Kpi loading={!data} label={t("Aktívne dni", "Active days")} value={num(k.active_days)} sub={data && deltaLine(k.active_days, kp.active_days, lang).text}
            info={t("Deň s akoukoľvek aktivitou: prihlásenie, stránka, klik alebo otázka AI.", "A day with anything: a sign-in, a page, a click or an AI question.")} />
          <Kpi loading={!data} label={t("Čas v aplikácii", "Time in app")} value={fmtMinutes(k.active_min, lang)} sub={data && deltaLine(k.active_min, kp.active_min, lang, fmtMinutes).text}
            info={t("Aktívny čas: karta v popredí a človek pri nej (pohyb, písanie, scroll). Len s analytickými cookies.", "Active time: the tab in front and the person at it (moving, typing, scrolling). Only with analytics cookies.")} />
          <Kpi loading={!data} label={t("Návštevy", "Visits")} value={num(k.visits)} sub={data && deltaLine(k.visits, kp.visits, lang).text}
            info={t("Jedna otvorená karta prehliadača = jedna návšteva.", "One open browser tab = one visit.")} />
          <Kpi loading={!data} label={t("Prihlásenia", "Sign-ins")} value={num(k.sign_ins)} sub={data && deltaLine(k.sign_ins, kp.sign_ins, lang).text} />
          <Kpi loading={!data} label={t("Projekty", "Projects viewed")} value={num(k.project_views)} sub={data && deltaLine(k.project_views, kp.project_views, lang).text} />
          <Kpi loading={!data} label={t("Stiahnuté dáta", "Downloads")} value={num(k.exports)} sub={data && deltaLine(k.exports, kp.exports, lang).text} />
          <Kpi loading={!data} label={t("Otázky AI", "AI questions")} value={num(k.ai_questions)} sub={data && deltaLine(k.ai_questions, kp.ai_questions, lang).text} />
        </div>

        {data && (
          <>
            <div className="rd-tabs" role="tablist" style={{ marginTop: "1.1rem" }}>
              {[
                ["overview", t("Prehľad", "Overview")],
                ["visits", t("Návštevy", "Visits"), visits.length],
                ["data", t("Stiahnuté a AI", "Downloads & AI"), exportsN + questionsN],
                ["account", t("Účet", "Account")],
              ].map(([key, name, n]) => (
                <button key={key} type="button" role="tab" className="rd-tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                  {name}{n != null && <span className="rd-tab__n">{n}</span>}
                </button>
              ))}
            </div>
            <div className="rd-ua__pane">
              {tab === "overview" && <Overview data={data} lang={lang} />}
              {tab === "visits" && <Visits visits={visits} lang={lang} consent={consent} />}
              {tab === "data" && <DownloadsAndAi data={data} lang={lang} />}
              {tab === "account" && <Account data={data} lang={lang} now={now} />}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────

function Overview({ data, lang }) {
  const t = L(lang);
  const sections = (data.sections || []).filter((s) => s.page);
  const maxMin = Math.max(1, ...sections.map((s) => Number(s.active_min) || 0));
  const maxVisits = Math.max(1, ...sections.map((s) => Number(s.visits) || 0));
  const byTime = sections.some((s) => Number(s.active_min) > 0);
  const features = (data.features || []).filter((f) => !["page_view", "page_leave"].includes(f.event));
  return (
    <div className="rd-ua__grid">
      <section className="rd-card rd-card--pad rd-ua__wide">
        <Head name={t("Aktivita po dňoch", "Activity by day")} count={t(`posledných ${data.days} dní`, `last ${data.days} days`)} />
        <DailyChart daily={data.daily || []} lang={lang} />
      </section>

      <section className="rd-card rd-card--pad">
        <Head name={t("Kedy pracuje", "When")} count={(() => { const u = usualTimes(data.heatmap, lang); return u ? `${u.days} · ${u.hours}` : ""; })()} />
        <Heatmap cells={data.heatmap || []} lang={lang} />
      </section>

      <section className="rd-card rd-card--pad">
        <Head name={t("Kde trávi čas", "Where the time goes")} count={sections.length ? `${sections.length} ${t("sekcií", "sections")}` : ""} />
        {sections.length ? (
          <div className="rd-ua__rows">
            {sections.slice(0, 10).map((s) => (
              <div key={s.page} className="rd-ua__barrow" title={`${t("Posledná návšteva", "Last visit")}: ${fmtDateTime(s.last_at, lang)}`}>
                <span className="rd-ua__barname">{pageTitle(s.page, lang)}</span>
                <span className="rd-ua__barval">{Number(s.active_min) > 0 ? `${fmtMinutes(s.active_min, lang)} · ` : ""}{num(s.visits)}×</span>
                <span className="rd-bar"><span className="rd-bar__fill" style={{ width: `${Math.max(3, 100 * (byTime ? (Number(s.active_min) || 0) / maxMin : (Number(s.visits) || 0) / maxVisits))}%` }} /></span>
              </div>
            ))}
          </div>
        ) : <Empty lang={lang} consent={data.person?.analytics_consent} />}
      </section>

      <section className="rd-card rd-card--pad">
        <Head name={t("Projekty, ktoré pozerá", "Projects they look at")} count={(data.projects || []).length ? String((data.projects || []).length) : ""} />
        {(data.projects || []).length ? (
          <div className="rd-ua__list">
            {data.projects.map((p) => (
              <div key={p.project_id} className="rd-ua__li">
                <span className="rd-ua__li-main">{p.name || p.project_id}</span>
                <span className="rd-ua__li-meta">{num(p.views)}× · {fmtDate(p.last_at, lang)}</span>
              </div>
            ))}
          </div>
        ) : <Empty lang={lang} consent={data.person?.analytics_consent} />}
      </section>

      <section className="rd-card rd-card--pad">
        <Head name={t("Čo robí", "What they do")} count={features.length ? String(features.length) : ""} />
        {features.length ? (
          <div className="rd-ua__list">
            {features.slice(0, 12).map((f) => (
              <div key={f.event} className="rd-ua__li">
                <span className="rd-ua__li-main">{eventName(f.event, lang)}</span>
                <span className="rd-ua__li-meta">{num(f.n)}× · {fmtDate(f.last_at, lang)}</span>
              </div>
            ))}
          </div>
        ) : <Empty lang={lang} consent={data.person?.analytics_consent} />}
      </section>
    </div>
  );
}

/** Minutes of active use per day as bars; a dot under the day for a sign-in, a ring for an AI question. */
function DailyChart({ daily, lang }) {
  const t = L(lang);
  const n = daily.length;
  if (!n) return null;
  const W = 1000, H = 150, top = 14, base = 116;
  const maxMin = Math.max(...daily.map((d) => Number(d.min) || 0));
  const maxEv = Math.max(...daily.map((d) => Number(d.events) || 0));
  // minutes when we have them; otherwise the number of actions, so a person who
  // was here without time measurement still shows their days
  const byMin = maxMin > 0;
  const max = Math.max(1, byMin ? maxMin : maxEv);
  const step = W / n;
  const bw = Math.max(1.5, Math.min(26, step * 0.68));
  const labelEvery = n <= 10 ? 1 : n <= 35 ? 7 : n <= 100 ? 14 : 61;
  const fmtD = (s) => { const [, m, d] = s.split("-"); return lang === "sk" ? `${+d}. ${+m}.` : `${+m}/${+d}`; };
  return (
    <div className="rd-ua__chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={byMin ? t("Minúty aktívnej práce po dňoch", "Active minutes per day") : t("Akcie po dňoch", "Actions per day")}>
        <line x1="0" x2={W} y1={base} y2={base} style={{ stroke: "var(--border)" }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2={W} y1={top} y2={top} style={{ stroke: "var(--border-soft)" }} strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        {daily.map((d, i) => {
          const v = Number(byMin ? d.min : d.events) || 0;
          const h = v > 0 ? Math.max(2, (base - top) * (v / max)) : 0;
          const x = i * step + (step - bw) / 2;
          const tip = `${fmtD(d.d)} — ${byMin ? fmtMinutes(d.min, lang) : `${num(d.events)} ${t("akcií", "actions")}`}${d.sign_ins ? ` · ${d.sign_ins} ${t("prihl.", "sign-ins")}` : ""}${d.questions ? ` · ${d.questions} ${t("otázok AI", "AI questions")}` : ""}`;
          return (
            <g key={d.d}>
              <title>{tip}</title>
              <rect x={i * step} y={0} width={step} height={H} fill="transparent" />
              {h > 0 && <rect x={x} y={base - h} width={bw} height={h} rx={Math.min(3, bw / 3)} style={{ fill: "var(--accent)" }} opacity="0.85" />}
              {d.sign_ins > 0 && <circle cx={i * step + step / 2} cy={base + 9} r="3.2" style={{ fill: "var(--text-dim)" }} />}
              {d.questions > 0 && <circle cx={i * step + step / 2} cy={base + 19} r="3" style={{ fill: "none", stroke: "var(--info)" }} strokeWidth="1.6" />}
            </g>
          );
        })}
      </svg>
      <div className="rd-ua__axis">
        {daily.map((d, i) => ((i % labelEvery === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= labelEvery / 2)
          ? <span key={d.d} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{fmtD(d.d)}</span> : null))}
      </div>
      <div className="rd-ua__legend">
        <span><i className="rd-ua__sw rd-ua__sw--bar" />{byMin ? t(`minúty práce (max ${fmtMinutes(maxMin, lang)})`, `active minutes (max ${fmtMinutes(maxMin, lang)})`) : t(`akcie (max ${maxEv})`, `actions (max ${maxEv})`)}</span>
        <span><i className="rd-ua__sw rd-ua__sw--dot" />{t("prihlásenie", "sign-in")}</span>
        <span><i className="rd-ua__sw rd-ua__sw--ring" />{t("otázka AI", "AI question")}</span>
      </div>
    </div>
  );
}

/** Weekday x hour, Bratislava time: how often they are here at that hour. */
function Heatmap({ cells, lang }) {
  const t = L(lang);
  const grid = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.n]));
  const max = Math.max(1, ...cells.map((c) => c.n));
  if (!cells.length) return <p className="rd-note">{t("Zatiaľ nič.", "Nothing yet.")}</p>;
  return (
    <div className="rd-ua__heat" role="img" aria-label={t("Aktivita podľa dňa v týždni a hodiny", "Activity by weekday and hour")}>
      <span />
      {Array.from({ length: 24 }, (_, h) => <span key={`h${h}`} className="rd-ua__heat-h">{h % 6 === 0 ? h : ""}</span>)}
      {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
        <HeatRow key={dow} dow={dow} grid={grid} max={max} lang={lang} />
      ))}
    </div>
  );
}
function HeatRow({ dow, grid, max, lang }) {
  const t = L(lang);
  return (
    <>
      <span className="rd-ua__heat-d">{weekdayName(dow, lang)}</span>
      {Array.from({ length: 24 }, (_, h) => {
        const n = grid.get(`${dow}-${h}`) || 0;
        return (
          <span key={h} className="rd-ua__heat-c" title={`${weekdayName(dow, lang)} ${h}:00–${h + 1}:00 — ${n} ${t("akcií", "actions")}`}
            style={n ? { background: `color-mix(in srgb, var(--accent) ${Math.round(18 + 82 * (n / max))}%, transparent)` } : undefined} />
        );
      })}
    </>
  );
}

// ─── Visits ──────────────────────────────────────────────────────────────

function Visits({ visits, lang, consent }) {
  const t = L(lang);
  if (!visits.length) return <Empty lang={lang} consent={consent} />;
  return (
    <div className="rd-ua__visits">
      {visits.map((v) => {
        const ua = describeUserAgent(v.user_agent);
        const pages = v.pages || [];
        return (
          <div key={v.session_id} className="rd-ua__visit">
            <div className="rd-ua__visit-head">
              <strong>{fmtDateTime(v.start, lang)}</strong>
              {/* a tab left open overnight ends on another day: say which */}
              <span>–{fmtDate(v.end, lang) === fmtDate(v.start, lang) ? fmtTime(v.end, lang) : fmtDateTime(v.end, lang)}</span>
              {Number(v.active_min) > 0 && <span className="rd-badge">{fmtMinutes(v.active_min, lang)}</span>}
              {v.exports > 0 && <span className="rd-badge rd-badge--ok">⬇ {v.exports}</span>}
              {v.questions > 0 && <span className="rd-badge">AI {v.questions}</span>}
              <span className="rd-ua__visit-ua">{ua.label}</span>
            </div>
            {pages.length > 0 && (
              <div className="rd-ua__path">
                {pages.map((p, i) => (
                  <span key={`${p}-${i}`}>{i > 0 && <span className="rd-ua__arrow">→</span>}<span className="rd-ua__step">{pageTitle(p, lang)}</span></span>
                ))}
              </div>
            )}
            {(v.projects || []).length > 0 && (
              <div className="rd-note">{t("Projekty", "Projects")}: {v.projects.join(", ")}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Downloads & AI ──────────────────────────────────────────────────────

function DownloadsAndAi({ data, lang }) {
  const t = L(lang);
  const ex = data.exports || [];
  const qs = data.questions || [];
  return (
    <div className="rd-ua__grid">
      <section className="rd-card rd-card--pad">
        <Head name={t("Stiahnuté dáta", "Downloads")} count={ex.length ? String(ex.length) : ""} />
        {ex.length ? (
          <div className="rd-ua__list">
            {ex.map((e, i) => (
              <div key={i} className="rd-ua__li">
                <span className="rd-ua__li-main">
                  {exportName(e.what, lang)}
                  <span className="rd-ua__li-sub">
                    {e.event === "data_copied" ? t("kópia do Excelu", "copied for Excel") : e.event === "xlsx_exported" ? "Excel" : e.event === "data_export" ? t("vlastné údaje", "own data") : "CSV"}
                    {e.rows != null ? ` · ${num(e.rows)} ${t("riadkov", "rows")}` : ""}
                    {e.country ? ` · ${String(e.country).toUpperCase()}` : ""}
                    {e.day ? ` · ${e.day === "latest" ? t("najnovší stav", "latest data") : `${t("stav k", "as of")} ${e.day}`}` : ""}
                  </span>
                </span>
                <span className="rd-ua__li-meta">{fmtDateTime(e.at, lang)}</span>
              </div>
            ))}
          </div>
        ) : <Empty lang={lang} consent={data.person?.analytics_consent} text={t("Žiadne stiahnuté dáta v tomto období.", "No downloads in this period.")} />}
      </section>
      <section className="rd-card rd-card--pad">
        <Head name={t("Otázky AI asistentovi", "Questions to the AI assistant")} count={qs.length ? String(qs.length) : ""} />
        {qs.length ? (
          <div className="rd-ua__list">
            {qs.map((q, i) => (
              <div key={i} className="rd-ua__q">
                <div className="rd-ua__q-text">“{q.text}”</div>
                <div className="rd-ua__li-meta">{fmtDateTime(q.at, lang)}{q.failed ? ` · ${t("odpoveď zlyhala", "answer failed")}` : ""}</div>
              </div>
            ))}
          </div>
        ) : <p className="rd-note">{t("Žiadne otázky v tomto období.", "No questions in this period.")}</p>}
      </section>
    </div>
  );
}

// ─── Account ─────────────────────────────────────────────────────────────

function Account({ data, lang, now }) {
  const t = L(lang);
  const p = data.person || {};
  const s = data.saved || {};
  const si = data.sign_ins || {};
  const ft = data.first_touch;
  const refHost = (() => { try { return ft?.referrer ? new URL(ft.referrer).hostname : null; } catch { return ft?.referrer || null; } })();
  const facts = [
    [t("Účet vytvorený", "Account created"), `${fmtDateTime(p.created_at, lang)}${p.created_by_admin ? t(" · vytvorený adminom", " · created by an admin") : ""}`],
    [t("E-mail overený", "E-mail confirmed"), fmtDateTime(p.email_confirmed_at, lang)],
    [t("Profil dokončený", "Profile completed"), p.profile_completed ? t("áno", "yes") : t("nie — registrácia nedokončená", "no — sign-up not finished")],
    [t("Jazyk pri registrácii", "Sign-up language"), p.signup_lang ? p.signup_lang.toUpperCase() : "—"],
    [t("Trial vyžiadaný pri registrácii", "Asked for the trial at sign-up"), p.trial_intent_at ? fmtDateTime(p.trial_intent_at, lang) : t("nie", "no")],
    [t("Trial", "Trial"), p.trial_started_at ? `${fmtDate(p.trial_started_at, lang)} – ${fmtDate(p.trial_until, lang)}` : "—"],
    ["Premium", p.paid_started_at || p.paid_until ? `${fmtDate(p.paid_started_at, lang)} – ${p.paid_until ? fmtDate(p.paid_until, lang) : "∞"}` : "—"],
    [t("Platba kartou (Stripe)", "Card payment (Stripe)"), p.has_stripe_subscription ? t("predplatné aktívne v Stripe", "subscription in Stripe") : p.has_stripe_customer ? t("zákazník v Stripe, bez predplatného", "Stripe customer, no subscription") : "—"],
    [t("Fakturačná firma", "Billing company"), p.billing_company_name || "—"],
    [t("Prvá návšteva", "First visit"), ft ? `${fmtDateTime(ft.at, lang)} · ${refHost ? t(`zdroj: ${refHost}`, `came from ${refHost}`) : t("priamo", "direct")} · ${ft.page_path || "/"}` : "—"],
    [t("Analytické cookies", "Analytics cookies"), p.analytics_consent === true ? `${t("povolené", "accepted")} · ${fmtDate(p.analytics_consent_at, lang)}` : p.analytics_consent === false ? `${t("odmietnuté", "declined")} · ${fmtDate(p.analytics_consent_at, lang)}` : t("nezaznamenané", "not recorded")],
    [t("Otvorené prihlásenia", "Open sign-in sessions"), `${num(p.open_sessions)}${si.networks ? ` · ${t("rôznych sietí za obdobie", "different networks this period")}: ${si.networks}` : ""}`],
  ];
  const fb = data.feedback || [];
  const errs = data.errors?.recent || [];
  const adm = data.admin_changes || [];
  return (
    <div className="rd-ua__grid">
      <section className="rd-card rd-card--pad">
        <Head name={t("Účet", "Account")} />
        <dl className="rd-ua__facts">
          {facts.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
        {si.networks > 3 && (
          <div className="rd-alert rd-alert--warn" style={{ marginTop: "0.6rem", fontSize: "0.74rem" }}>
            {t(`Prihlásenia z ${si.networks} rôznych sietí za ${data.days} dní — môže ísť o zdieľaný prístup.`, `Sign-ins from ${si.networks} different networks in ${data.days} days — the login may be shared.`)}
          </div>
        )}
      </section>

      <section className="rd-card rd-card--pad">
        <Head name={t("Prihlásenia", "Sign-ins")} count={si.total ? `${t("spolu", "total")} ${num(si.total)}` : ""} />
        {(si.recent || []).length ? (
          <div className="rd-ua__list">
            {si.recent.map((x, i) => (
              <div key={i} className="rd-ua__li">
                <span className="rd-ua__li-main">{describeUserAgent(x.user_agent).label}</span>
                <span className="rd-ua__li-meta">{fmtDateTime(x.at, lang)} · {relDays(new Date(x.at), now, lang)}</span>
              </div>
            ))}
          </div>
        ) : <p className="rd-note">{t("Zatiaľ žiadne zaznamenané prihlásenie (záznam beží od 7. 10. 2026).", "No sign-in recorded yet (recorded since 7 Oct 2026).")}</p>}
        {(data.devices || []).length > 0 && (
          <div className="rd-ua__devices">
            {[...new Set(data.devices.map((d) => describeUserAgent(d.user_agent).label))].map((l) => <span key={l} className="rd-badge">{l}</span>)}
          </div>
        )}
      </section>

      <section className="rd-card rd-card--pad">
        <Head name={t("Uložené", "Saved")} />
        <dl className="rd-ua__facts">
          <div><dt>{t("Vlastný dashboard", "Own dashboard")}</dt><dd>{s.dashboard ? `${s.dashboard.widgets ?? "?"} ${t("widgetov", "widgets")} · ${fmtDate(s.dashboard.updated_at, lang)}` : t("nie", "no")}</dd></div>
          <div><dt>{t("Oblasti na mape", "Map areas")}</dt><dd>{(s.map_areas || []).length ? s.map_areas.map((a) => a.name).join(", ") : t("žiadne", "none")}</dd></div>
          <div><dt>{t("Odber reportov e-mailom", "Report e-mails")}</dt><dd>{(s.report_subscriptions || []).length ? s.report_subscriptions.map((r) => `${r.scope}${r.enabled ? "" : t(" (vypnutý)", " (off)")}`).join(", ") : t("žiadny", "none")}</dd></div>
        </dl>
      </section>

      <section className="rd-card rd-card--pad">
        <Head name={t("Spätná väzba a chyby", "Feedback and errors")}
          count={`${fb.length} ${t("správ", "messages")} · ${num(data.errors?.count)} ${t("chýb za obdobie", "errors this period")}`} />
        {fb.length === 0 && errs.length === 0 && <p className="rd-note">{t("Žiadna spätná väzba ani chyba.", "No feedback and no errors.")}</p>}
        <div className="rd-ua__list">
          {fb.map((f, i) => (
            <div key={`f${i}`} className="rd-ua__q">
              <div className="rd-ua__q-text">💬 {f.text}</div>
              <div className="rd-ua__li-meta">{fmtDateTime(f.at, lang)} · {f.category}{f.status ? ` · ${f.status}` : ""}</div>
            </div>
          ))}
          {errs.map((e, i) => (
            <div key={`e${i}`} className="rd-ua__q">
              <div className="rd-ua__q-text" style={{ color: "var(--danger)" }}>⚠ {e.text}</div>
              <div className="rd-ua__li-meta">{fmtDateTime(e.at, lang)} · {e.path}</div>
            </div>
          ))}
        </div>
      </section>

      {adm.length > 0 && (
        <section className="rd-card rd-card--pad rd-ua__wide">
          <Head name={t("Zmeny v admine", "Admin changes")} count={String(adm.length)} />
          <div className="rd-ua__list">
            {adm.map((a, i) => (
              <div key={i} className="rd-ua__li">
                <span className="rd-ua__li-main">{a.action}{a.success === false ? t(" — zlyhalo", " — failed") : ""}</span>
                <span className="rd-ua__li-meta">{a.by} · {fmtDateTime(a.at, lang)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── bits ────────────────────────────────────────────────────────────────

function Head({ name, count }) {
  return (
    <div className="rd-sect" style={{ marginBottom: "0.7rem" }}>
      <span className="rd-sect__tick" />
      <span className="rd-sect__name">{name}</span>
      {count ? <span className="rd-sect__count">{count}</span> : null}
    </div>
  );
}

function Empty({ lang, consent, text }) {
  const t = L(lang);
  return (
    <p className="rd-note">
      {text || t("Nič v tomto období.", "Nothing in this period.")}
      {consent === false && t(" Analytické cookies sú odmietnuté, takže stránky a kliky sa nezaznamenávajú.", " Analytics cookies are declined, so pages and clicks are not recorded.")}
    </p>
  );
}
