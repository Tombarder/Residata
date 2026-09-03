/**
 * /status — the page that has to exist because the Terms make a promise.
 *
 * Clause 8 commits to 99.5 % monthly availability. A commitment nobody can
 * check is marketing, so this is where a customer checks it.
 *
 * It measures rather than asserts. Every figure on the page is fetched live in
 * the visitor's own browser when they open it: if the site is broken, the page
 * says so or fails to load at all, which is itself the answer. There is no
 * stored "all systems operational" flag that could keep saying so during an
 * outage — that is the failure mode of most status pages and it is worse than
 * having none.
 *
 * Two things are deliberately shown that a generic status page would not:
 *
 *   · DATA FRESHNESS. Our customers do not really care whether the web server
 *     answered; they care whether last night's prices are in. That is the
 *     outage that matters here and it is invisible to an uptime checker.
 *   · WHERE THE EVIDENCE IS. The independent probe runs outside our hosting,
 *     every 15 minutes, in a public repository — linked rather than summarised,
 *     because a number we compute about ourselves is not evidence.
 */
import { useEffect, useState } from "react";
import { supabasePublic, isSupabaseReady } from "../lib/supabase";
import { COMPANY } from "../lib/company";

const PROBE_HISTORY = "https://github.com/Tombarder/Residata/actions/workflows/uptime.yml";

const OK = "#00e5a0";
const WARN = "#f5a623";
const BAD = "#ff6b6b";

/** One measured check. `state` is null while it runs. */
function Row({ label, detail, state, note }) {
  const color = state === "ok" ? OK : state === "warn" ? WARN : state === "bad" ? BAD : "var(--text-dim)";
  const dot = state === null ? "◌" : state === "ok" ? "●" : state === "warn" ? "▲" : "✕";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1.2rem 1fr auto", gap: "0.75rem",
      alignItems: "baseline", padding: "0.85rem 0", borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ color, fontSize: "0.9rem", lineHeight: 1 }} aria-hidden="true">{dot}</span>
      <div>
        <div style={{ color: "var(--text)", fontWeight: 600, fontSize: "0.95rem" }}>{label}</div>
        {note && <div style={{ color: "var(--text-dim)", fontSize: "0.82rem", marginTop: "0.15rem", lineHeight: 1.5 }}>{note}</div>}
      </div>
      <div style={{ color, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
        {state === null ? "…" : detail}
      </div>
    </div>
  );
}

export default function StatusPage({ lang = "sk" }) {
  const isSK = lang === "sk";
  const t = (sk, en) => (isSK ? sk : en);

  const [web, setWeb] = useState({ state: null });
  const [api, setApi] = useState({ state: null });
  const [data, setData] = useState({ state: null, rows: [] });

  useEffect(() => {
    document.title = t("Stav služby · Residata", "Service status · Residata");
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // The website itself. A static file, so this times the edge and not a query.
  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    fetch("/llms.txt", { cache: "no-store" })
      .then((r) => {
        if (cancelled) return;
        const ms = Math.round(performance.now() - t0);
        setWeb(r.ok ? { state: ms > 2000 ? "warn" : "ok", detail: `${ms} ms` } : { state: "bad", detail: `HTTP ${r.status}` });
      })
      .catch(() => { if (!cancelled) setWeb({ state: "bad", detail: t("nedostupné", "unreachable") }); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The data layer, and how current it is. One query answers both.
  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseReady()) { setApi({ state: "bad", detail: t("nenakonfigurované", "not configured") }); return; }
    const t0 = performance.now();
    // projects_live carries a real per-project timestamp. The first version of
    // this page used market_totals.snapshot_month instead — which is a MONTH,
    // so a dataset 25 days stale still read as current, while the text beside it
    // promised "whether last night's prices are in". The claim and the
    // measurement have to be the same thing.
    supabasePublic
      .from("projects_live")
      .select("country, last_seen_at")
      .eq("status", "active")
      .order("last_seen_at", { ascending: false })
      .limit(1000)
      .then(({ data: rows, error }) => {
        if (cancelled) return;
        const ms = Math.round(performance.now() - t0);
        if (error || !rows?.length) {
          setApi({ state: "bad", detail: t("chyba", "error") });
          setData({ state: "bad", rows: [] });
          return;
        }
        setApi({ state: ms > 3000 ? "warn" : "ok", detail: `${ms} ms` });

        // Newest refresh per market, and how many projects that market holds.
        const by = new Map();
        for (const r of rows) {
          const c = r.country || "?";
          const g = by.get(c) || { country: c, newest: null, count: 0 };
          g.count += 1;
          if (r.last_seen_at && (!g.newest || r.last_seen_at > g.newest)) g.newest = r.last_seen_at;
          by.set(c, g);
        }

        // The scrape runs nightly, so under ~26 hours old is a run that landed.
        // Past ~50 hours two nights have been missed and that is worth saying
        // out loud rather than colouring green.
        const now = Date.now();
        setData({
          state: "ok",
          rows: [...by.values()]
            .sort((a, b) => a.country.localeCompare(b.country))
            .map((g) => {
              const hours = g.newest ? (now - new Date(g.newest).getTime()) / 3600000 : Infinity;
              return {
                ...g,
                hours,
                state: hours < 26 ? "ok" : hours < 50 ? "warn" : "bad",
              };
            }),
        });
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const worst = [web.state, api.state, ...data.rows.map((r) => r.state)];
  const overall = worst.includes("bad") ? "bad" : worst.includes("warn") ? "warn" : worst.includes(null) ? null : "ok";
  const headline = overall === null
    ? t("Kontrolujeme…", "Checking…")
    : overall === "ok" ? t("Všetko funguje", "All systems operational")
    : overall === "warn" ? t("Funguje, ale niečo si zaslúži pozornosť", "Operational, with something worth a look")
    : t("Máme problém", "We have a problem");

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "9rem 2rem 6rem" }}>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "var(--accent)",
          letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.8rem",
        }}>{t("Stav služby", "Service status")}</div>

        <h1 style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 0.6rem" }}>
          {headline}
        </h1>
        <p style={{ color: "var(--text-2)", margin: "0 0 2.5rem", lineHeight: 1.6, maxWidth: "60ch" }}>
          {t(`Táto stránka nič neukladá — všetko nižšie sa meria vo vašom prehliadači vo chvíli, keď ju otvoríte. Ak je služba nedostupná, nedozviete sa to od nás, ale uvidíte to priamo tu.`,
             `This page stores nothing — everything below is measured in your own browser the moment you open it. If the service is down, you do not have to take our word for it; you will see it here.`)}
        </p>

        <Row label={t("Webová aplikácia", "Web application")} state={web.state} detail={web.detail}
             note={t("Odozva na statický súbor zo siete, ktorá stránku doručuje.",
                     "Response time for a static file from the network that serves the site.")} />
        <Row label={t("Dátové rozhranie", "Data layer")} state={api.state} detail={api.detail}
             note={t("Odozva databázy na verejný dopyt.", "Database response to a public query.")} />

        <h2 style={{ fontSize: "1.05rem", fontWeight: 600, margin: "2.5rem 0 0.3rem" }}>
          {t("Aktuálnosť dát", "Data freshness")}
        </h2>
        <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", margin: "0 0 0.5rem", lineHeight: 1.55 }}>
          {t("Dôležitejšie než dostupnosť webu: či sú v systéme včerajšie ceny. Zber beží každú noc.",
             "More important than the website being up: whether last night's prices are in. Collection runs nightly.")}
        </p>
        {data.rows.length === 0 && <Row label={t("Trhy", "Markets")} state={data.state} detail="" />}
        {data.rows.map((r) => {
          const h = Math.floor(r.hours);
          const age = !Number.isFinite(r.hours)
            ? t("neznáme", "unknown")
            : h < 1 ? t("pred chvíľou", "just now")
            : h < 48 ? t(`pred ${h} h`, `${h}h ago`)
            : t(`pred ${Math.floor(h / 24)} dňami`, `${Math.floor(h / 24)}d ago`);
          return (
            <Row
              key={r.country}
              label={r.country === "SK" ? t("Slovensko", "Slovakia") : r.country === "CZ" ? t("Česko", "Czechia") : r.country}
              state={r.state}
              detail={age}
              note={t(`Posledný zber · ${r.count.toLocaleString("sk-SK")} aktívnych projektov`,
                      `Last collected · ${r.count.toLocaleString("en-GB")} active projects`)}
            />
          );
        })}

        <h2 style={{ fontSize: "1.05rem", fontWeight: 600, margin: "2.5rem 0 0.6rem" }}>
          {t("Náš záväzok", "Our commitment")}
        </h2>
        <p style={{ color: "var(--text-2)", lineHeight: 1.65, margin: "0 0 1rem", maxWidth: "62ch" }}>
          {t(<>Pre platené predplatné sa zaväzujeme k mesačnej dostupnosti <strong>99,5 %</strong>. Presné znenie vrátane výnimiek a náhrady je v článku 8 <a href="/terms" style={{ color: "var(--accent)" }}>obchodných podmienok</a>.</>,
             <>For paid subscriptions we commit to <strong>99.5 %</strong> monthly availability. The exact wording, including exclusions and the credit, is clause 8 of the <a href="/terms" style={{ color: "var(--accent)" }}>Terms</a>.</>)}
        </p>
        <p style={{ color: "var(--text-2)", lineHeight: 1.65, margin: "0 0 1rem", maxWidth: "62ch" }}>
          {t(<>Dostupnosť meria nezávislá sonda mimo nášho hostingu, každých 15 minút. Jej úplná história je verejná — {" "}
              <a href={PROBE_HISTORY} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>pozrite si ju</a>{" "}
              namiesto toho, aby ste verili číslu, ktoré si o sebe vypočítame sami.</>,
             <>Availability is measured by an independent probe outside our hosting, every 15 minutes. Its full history is public — {" "}
              <a href={PROBE_HISTORY} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>read it</a>{" "}
              rather than trusting a number we compute about ourselves.</>)}
        </p>

        <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", marginTop: "2.5rem", lineHeight: 1.6 }}>
          {t(<>Niečo nefunguje a nevidíte to tu? Napíšte na {" "}
              <a href={`mailto:${COMPANY.email}`} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>.</>,
             <>Something broken that this page does not show? Write to {" "}
              <a href={`mailto:${COMPANY.email}`} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>.</>)}
        </p>
      </div>
    </div>
  );
}
