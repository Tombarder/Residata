/**
 * The "search & sharing" panel of the article editor (/app/articles).
 *
 * WHY. Since 2026-09-28 everything a search engine or a link preview needs is
 * built automatically from the article — its static page, sitemap line, feed
 * item, structured data (lib/articleSeo.js, scripts/prerender.mjs) — and
 * publishing rebuilds the site on its own. What is left is (a) seeing what
 * Google and LinkedIn will show BEFORE publishing, (b) knowing the live page
 * has caught up after a save, and (c) the few steps no system can take for us.
 * This panel is those three things, so the editor never has to remember them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  articleSeoChecks, seoTitle, headline, perex, clip, canonicalUrl, shareImage,
  MANUAL_STEPS, TITLE_IDEAL_MAX, DESCRIPTION_MAX, livePageState, manualStepsReady, PUBLIC_SITE,
} from "../lib/articleSeo";
import { setPromoStep } from "../lib/useArticles";

/** The address Google and LinkedIn see — also when editing on a preview. */
const PUBLIC_BASE = PUBLIC_SITE;
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
// Theme tokens (index.css), so a warning stays readable on the light theme too.
const LEVEL_COLOR = { error: "var(--danger)", warn: "var(--warning)", info: "var(--text-faint)" };
const LEVEL_MARK = { error: "✕", warn: "!", info: "i" };

const label = {
  fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.09em",
  textTransform: "uppercase", color: "var(--text-dim)", marginBottom: "0.45rem",
};
const panel = {
  border: "1px solid var(--border-soft)", borderRadius: 10, padding: "1rem 1.1rem",
  marginBottom: "0.9rem", background: "rgba(255,255,255,0.015)",
};

/** Is this file on the site? It must answer as an IMAGE: the site answers a
 *  path it does not have with the app's own page (200 text/html), so `r.ok`
 *  alone called every missing chart present. */
async function exists(path) {
  if (!path || !path.startsWith("/")) return undefined;
  try {
    const r = await fetch(path, { method: "HEAD", cache: "no-store" });
    return r.ok && /^image\//.test(r.headers.get("content-type") || "");
  } catch {
    return undefined;
  }
}

/** Is the static page on the site the version that was saved? (lib/articleSeo livePageState) */
function useLiveState(article, published) {
  const [state, setState] = useState({ status: "unknown" });
  const check = useCallback(async () => {
    // Only residata.eu serves the page Google and LinkedIn read; on a preview
    // or a local build there is nothing to compare with.
    const onLiveSite = typeof window !== "undefined" && /(^|\.)residata\.eu$/.test(window.location.hostname);
    if (!published || !onLiveSite) { setState(livePageState({ published, onLiveSite })); return; }
    setState((s) => ({ ...s, checking: true }));
    let html = null;
    try {
      html = await (await fetch(`/analyzy/${article.slug}`, { cache: "no-store" })).text();
    } catch {
      html = null;
    }
    setState(livePageState({ published, onLiveSite, html, updatedAt: article.updatedAt }));
  }, [article.slug, article.updatedAt, published]);
  useEffect(() => { check(); }, [check]);
  // While the site rebuilds, look again every 30 s until it has caught up.
  useEffect(() => {
    if (state.status !== "rebuilding") return undefined;
    const id = setTimeout(check, 30000);
    return () => clearTimeout(id);
  }, [state, check]);
  return [state, check];
}

export default function ArticleSeoPanel({ draft, published, updatedAt, onSeoTitle, onChecklist }) {
  const article = useMemo(() => ({ ...draft, published, updatedAt }), [draft, published, updatedAt]);
  const url = canonicalUrl(article, PUBLIC_BASE);
  const title = seoTitle(article);
  const description = clip(perex(article));

  // Files the page needs, checked on the site itself.
  const [files, setFiles] = useState({ shareImageExists: undefined, missingFigures: [] });
  const figureKey = JSON.stringify((draft.blocks || []).filter((b) => b.type === "figure").map((b) => [b.src, b.srcM]));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const shareImageExists = draft.ogImage ? await exists(draft.ogImage) : undefined;
      const missingFigures = [];
      for (const b of draft.blocks || []) {
        if (b.type !== "figure") continue;
        for (const src of [b.src, b.srcM]) if (src && (await exists(src)) === false) missingFigures.push(src);
      }
      if (!cancelled) setFiles({ shareImageExists, missingFigures });
    })();
    return () => { cancelled = true; };
  }, [draft.ogImage, figureKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const checks = articleSeoChecks(article, files);
  const [live, recheck] = useLiveState(article, published);
  const [busyStep, setBusyStep] = useState(null);
  const [stepErr, setStepErr] = useState(null);

  async function toggleStep(key, done) {
    setBusyStep(key); setStepErr(null);
    try { onChecklist(await setPromoStep(draft.id, draft.promoChecklist, key, done)); }
    catch (e) { setStepErr(e.message); }
    finally { setBusyStep(null); }
  }

  const liveLine = {
    draft: ["var(--text-faint)", "○ Koncept — na webe nie je a vyhľadávače ho nevidia. Po zverejnení sa web prebuduje sám (do ~5 minút)."],
    current: ["var(--accent)", "✓ Na webe aktuálne — stránka, ktorú čítajú Google a LinkedIn, zodpovedá uloženej verzii."],
    rebuilding: ["var(--warning)", "⏳ Web sa prebudováva — zmeny sa na stránke pre Google a LinkedIn objavia do ~5 minút po uložení."],
    stuck: ["var(--danger)", `⚠ Stránka na webe sa neaktualizovala ani po ${live.minutes} minútach. Niečo nie je v poriadku — dajte vedieť.`],
    "not-here": ["var(--text-faint)", "Stav stránky na webe sa dá overiť len na residata.eu."],
    unknown: ["var(--text-faint)", "Stav stránky na webe sa nepodarilo overiť."],
  }[live.status] || ["var(--text-faint)", ""];
  const pageReady = manualStepsReady(live);

  return (
    <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid var(--border-soft)" }}>
      <div style={{ ...label, marginBottom: "0.8rem" }}>Vyhľadávanie a zdieľanie</div>

      <div style={panel}>
        <div style={label}>SEO titulok (Google, LinkedIn)</div>
        <input value={draft.seoTitle?.sk || ""}
               onChange={(e) => onSeoTitle(e.target.value ? { sk: e.target.value, en: e.target.value } : null)}
               placeholder={`${headline(article)} · Residata`}
               style={{
                 width: "100%", background: "var(--bg)", color: "var(--text)",
                 border: "1px solid var(--border-soft)", borderRadius: 7,
                 padding: "0.6rem 0.7rem", fontSize: "0.88rem",
               }} />
        <div style={{ fontSize: "0.72rem", marginTop: "0.35rem", color: title.length > TITLE_IDEAL_MAX ? "var(--warning)" : "var(--text-faint)" }}>
          {title.length} / {TITLE_IDEAL_MAX} znakov · prázdne pole = nadpis článku s „ · Residata“.
          Nadpis na stránke sa tým nemení.
        </div>

        {/* What a Google result for this page will look like. */}
        <div style={{ marginTop: "1rem", padding: "0.8rem 0.9rem", borderRadius: 8, background: "#fff", color: "#202124", fontFamily: "Arial, sans-serif" }}>
          <div style={{ fontSize: "12px", color: "#4d5156" }}>residata.eu › analyzy › {draft.slug}</div>
          <div style={{ fontSize: "18px", color: "#1a0dab", lineHeight: 1.3, margin: "2px 0 3px" }}>
            {title.length > TITLE_IDEAL_MAX ? `${title.slice(0, TITLE_IDEAL_MAX - 1)}…` : title}
          </div>
          <div style={{ fontSize: "13px", color: "#4d5156", lineHeight: 1.5 }}>{description}</div>
        </div>

        {/* …and the LinkedIn card. */}
        <div style={{ marginTop: "0.8rem", maxWidth: 420, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border-soft)", background: "#fff" }}>
          {draft.ogImage && files.shareImageExists !== false
            ? <img src={draft.ogImage} alt="" style={{ width: "100%", display: "block", aspectRatio: "1200 / 630", objectFit: "cover" }} />
            : <div style={{ aspectRatio: "1200 / 630", display: "grid", placeItems: "center", color: "#777", fontSize: "0.8rem" }}>všeobecný obrázok Residaty</div>}
          <div style={{ padding: "0.55rem 0.7rem", color: "#000", fontFamily: "Arial, sans-serif" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, lineHeight: 1.3 }}>{title}</div>
            <div style={{ fontSize: "12px", color: "#666", marginTop: 2 }}>residata.eu</div>
          </div>
        </div>
        <div style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--text-faint)", marginTop: "0.4rem" }}>
          obrázok: {shareImage(article, PUBLIC_BASE)}
        </div>
      </div>

      <div style={panel}>
        <div style={label}>Kontrola</div>
        {checks.filter((c) => c.level !== "info").length === 0 && (
          <div style={{ fontSize: "0.8rem", color: "var(--accent)" }}>✓ Titulok, perex, metodika, obrázok na zdieľanie aj grafy sú v poriadku.</div>
        )}
        {checks.map((c) => (
          <div key={c.code + c.sk} style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem", lineHeight: 1.5, color: LEVEL_COLOR[c.level], marginBottom: "0.25rem" }}>
            <span style={{ fontFamily: MONO, width: "1em" }}>{LEVEL_MARK[c.level]}</span><span>{c.sk}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginTop: "0.7rem" }}>
          <span style={{ fontSize: "0.8rem", color: liveLine[0] }}>{liveLine[1]}</span>
          {(live.status === "rebuilding" || live.status === "stuck" || live.status === "unknown") && (
            <button className="rd-btn rd-btn--sm rd-btn--ghost" disabled={live.checking} onClick={recheck}>Skontrolovať znova</button>
          )}
        </div>
      </div>

      {published && (
        <div style={panel}>
          <div style={label}>Ručné kroky po zverejnení</div>
          <div style={{ fontSize: "0.76rem", color: "var(--text-faint)", marginBottom: "0.7rem" }}>
            Všetko ostatné je automatické: stránka pre vyhľadávače, mapa webu, RSS, štruktúrované dáta aj oznámenie pre Bing.
          </div>
          {!pageReady && (
            <div style={{ fontSize: "0.78rem", color: "var(--warning)", marginBottom: "0.6rem" }}>
              ⏳ Počkajte, kým bude stránka na webe aktuálna (✓ v Kontrole vyššie). Google aj LinkedIn by si inak
              zapamätali starú verziu — LinkedIn približne na týždeň.
            </div>
          )}
          {MANUAL_STEPS.map((s) => {
            const done = draft.promoChecklist?.[s.key];
            return (
              <div key={s.key} style={{ display: "flex", gap: "0.7rem", alignItems: "flex-start", padding: "0.5rem 0", borderTop: "1px solid var(--border-soft)" }}>
                <input type="checkbox" checked={!!done} disabled={busyStep === s.key}
                       onChange={(e) => toggleStep(s.key, e.target.checked)}
                       style={{ marginTop: "0.25rem", accentColor: "var(--accent)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.84rem", color: done ? "var(--text-dim)" : "var(--text)", textDecoration: done ? "line-through" : "none" }}>
                    {s.sk}{s.optional ? " · voliteľné" : ""}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-faint)", marginTop: 2 }}>
                    {done ? `hotovo ${String(done.done_at).slice(0, 10)}` : s.hint}
                  </div>
                </div>
                {pageReady
                  ? <a className="rd-btn rd-btn--sm rd-btn--ghost" href={s.href(url)} target="_blank" rel="noreferrer">Otvoriť ↗</a>
                  : <button className="rd-btn rd-btn--sm rd-btn--ghost" disabled title="Až keď bude stránka na webe aktuálna">Otvoriť ↗</button>}
              </div>
            );
          })}
          {stepErr && <div style={{ color: "var(--danger)", fontSize: "0.76rem", marginTop: "0.5rem" }}>{stepErr}</div>}
        </div>
      )}
      <div style={{ fontSize: "0.7rem", color: "var(--text-faint)" }}>
        Limit pre popis vo výsledkoch Google je {DESCRIPTION_MAX} znakov — do popisu ide začiatok perexu.
      </div>
    </div>
  );
}
