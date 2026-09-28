/**
 * How an analysis LOOKS — the index and one article — with no data loading.
 *
 * Split out of Insights.jsx on 2026-09-28 so the build can render the same
 * markup into a static page per article (scripts/prerender.mjs): what a crawler
 * or a link preview receives before any JavaScript runs is then the page a
 * reader sees, not a hand-written copy of it that drifts. Everything here must
 * render without a browser: no effects that matter, no window, no fetch.
 * Insights.jsx owns the data and hands it in.
 */
import { useState } from "react";
import { t, dateLong, monthLong } from "../lib/articleFormat";
import { COMPANY } from "../lib/company";
import { DATA_LICENSE, publicUrl, citationText, embedCode } from "../lib/articleSeo.js";
import { MEASURE, EYEBROW } from "./insightsStyle.js";

export function Shell({ children }) {
  return (
    <div className="rd-analysis" style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <div style={{ maxWidth: MEASURE, margin: "0 auto", padding: "9rem 2rem 6rem" }}>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────── block renderers ─────────────────────────── */

/** A button that copies text; without a clipboard the text stays selectable. */
function CopyButton({ text, label, done }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="rd-btn rd-btn--sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch { /* no clipboard access: the text itself is selectable */ }
            }}>
      {copied ? done : label}
    </button>
  );
}

function Figure({ src, srcEn, srcM, w, h, wM, hM, alt, caption, lang, article }) {
  const source = lang === "en" && srcEn ? srcEn : src;
  // 🔴 ONE CHART IS TWO DRAWINGS, AND THE PHONE DOWNLOADS ONLY ITS OWN.
  // Measured here at a 375px viewport, this column renders a figure at 285px
  // — 28% of the 1000px canvas the wide charts are drawn on, which put 179
  // strings across the eight published charts below 9px. The generator now
  // also writes a "-m" drawing authored at phone width, with its own type
  // scale, its own row heights, fewer ticks and labels collapsed into a
  // legend. <picture> picks; <source media> is evaluated before the fetch, so
  // a phone never downloads the desktop file.
  // srcM is written by to_cms.py only when the file really exists. An article
  // published before phone drawings has none, and falls back to the one
  // drawing it has rather than to a broken image.
  return (
    <figure className="rd-fig" style={{ margin: "2.4rem 0" }}>
      {/* Light card on a dark page. The chart is generated light once and reused
          for the page, LinkedIn and print — see the file header. */}
      <div className="rd-fig-card" style={{
        background: "#fff",
        borderRadius: 12,
        padding: "0.75rem",
        // Hairline + shadow so the white card reads as a mounted figure rather
        // than a hole punched in the page.
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
      }}>
        {/* The zoom link stays: a reader who wants to read a single value off
            a long series still wants the figure full size. It is no longer
            carrying the job of making the chart legible at all. */}
        <a href={source} target="_blank" rel="noreferrer"
           aria-label={t(alt, lang)}
           style={{ display: "block", cursor: "zoom-in" }}>
          {/* width/height are the drawing's own size (to_cms.py reads it from
              the file): CSS keeps the chart fluid, and the browser reserves the
              right height before the image arrives instead of pushing the text
              below it down when it does. */}
          <picture>
            {srcM && <source media="(max-width: 640px)" srcSet={srcM} width={wM} height={hM} />}
            <img src={source} alt={t(alt, lang)} loading="lazy" width={w} height={h}
                 style={{ width: "100%", height: "auto", display: "block", borderRadius: 6 }} />
          </picture>
        </a>
      </div>
      {caption && (
        <figcaption style={{
          fontSize: "0.8rem", color: "#8b8b95", marginTop: "0.7rem", lineHeight: 1.5,
        }}>{t(caption, lang)}</figcaption>
      )}
      {/* <details> opens without JavaScript, so the code is there on the
          pre-built page too; only the copy button waits for the app. */}
      {article && src && src.startsWith("/") && (
        <details style={{ marginTop: "0.55rem" }}>
          <summary style={{ fontSize: "0.74rem", color: "#8b8b95", cursor: "pointer" }}>
            {lang === "en" ? "Embed this chart on your site" : "Vložiť graf na vlastný web"}
          </summary>
          <pre style={{
            margin: "0.55rem 0", padding: "0.7rem 0.8rem", borderRadius: 8,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
            fontSize: "0.72rem", lineHeight: 1.55, color: "#a5a5b0",
            fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: "pre-wrap", wordBreak: "break-all",
          }}>{embedCode({ src, w, h, alt }, article, lang)}</pre>
          <CopyButton text={embedCode({ src, w, h, alt }, article, lang)}
                      label={lang === "en" ? "Copy code" : "Kopírovať kód"}
                      done={lang === "en" ? "Copied ✓" : "Skopírované ✓"} />
        </details>
      )}
    </figure>
  );
}

function Table({ head, rows, caption, lang }) {
  const heads = t(head, lang) || head;
  return (
    <figure style={{ margin: "2.4rem 0" }}>
      {/* On a phone the padding and type step down (clamp on the viewport width)
          so a four-column table fits a 375px screen; on a desktop both clamps
          sit at their maximum and nothing changes. It still scrolls sideways
          if a table is wider than the screen — nothing is ever cut off. */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "clamp(0.8rem, 3.4vw, 0.9rem)" }}>
          <thead>
            <tr>
              {heads.map((h, i) => (
                <th key={h} style={{
                  textAlign: i === 0 ? "left" : "right",
                  padding: "0.6rem clamp(0.35rem, 1.6vw, 0.75rem)",
                  borderBottom: "1px solid rgba(255,255,255,0.18)",
                  color: "#e8e8ee", fontWeight: 600, whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((cell, ci) => (
                  <td key={ci} style={{
                    textAlign: ci === 0 ? "left" : "right",
                    padding: "0.55rem clamp(0.35rem, 1.6vw, 0.75rem)",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    color: ci === 0 ? "#e8e8ee" : "#c5c5cc",
                    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                  }}>{t(cell, lang)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && (
        <figcaption style={{ fontSize: "0.8rem", color: "#8b8b95", marginTop: "0.7rem" }}>
          {t(caption, lang)}
        </figcaption>
      )}
    </figure>
  );
}

export function Block({ block, lang, article }) {
  // Clearing a paragraph in the editor left an empty <p> holding its margin, so
  // the page grew a gap where the text had been. Nothing to say, nothing to lay out.
  if (["lead", "h2", "p"].includes(block.type) && !t(block.text, lang).trim()) return null;

  switch (block.type) {
    case "lead":
      return (
        <p style={{
          fontSize: "1.12rem", lineHeight: 1.65, color: "#e4e4ea",
          margin: "0 0 2rem", fontWeight: 500,
        }}>{t(block.text, lang)}</p>
      );
    case "h2":
      return (
        <h2 style={{
          fontSize: "1.28rem", fontWeight: 650, letterSpacing: "-0.015em",
          color: "var(--text)", margin: "2.8rem 0 1rem", lineHeight: 1.3,
        }}>{t(block.text, lang)}</h2>
      );
    case "p":
      return <p style={{ margin: "0 0 1.15rem" }}>{t(block.text, lang)}</p>;
    case "bullets":
      return (
        <ul style={{ margin: "0 0 1.4rem", paddingLeft: "1.1rem" }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ margin: "0 0 0.5rem" }}>{t(it, lang)}</li>
          ))}
        </ul>
      );
    case "figure":
      return <Figure {...block} lang={lang} article={article} />;
    case "table":
      return <Table {...block} lang={lang} />;
    default:
      return null;
  }
}

/**
 * One row in the index. A card the whole of which is clickable needs to SAY so —
 * a pointer cursor alone is the difference between "a list" and "a list you can
 * use". Hover lifts the title to the accent and warms the row; the arrow slides.
 */
export function ArticleCard({ article, navigate, sk, lang, compact = false }) {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={`/analyzy/${article.slug}`}
      onClick={(e) => { e.preventDefault(); navigate("Analyza:" + article.slug); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display: "block", textDecoration: "none", color: "inherit",
        padding: compact ? "1rem 1rem" : "1.6rem 1rem 1.6rem 1rem", margin: "0 -1rem",
        borderTop: "1px solid rgba(255,255,255,0.12)",
        borderRadius: hover ? 10 : 0,
        background: hover ? "rgba(255,255,255,0.035)" : "transparent",
        transition: "background 160ms ease, border-radius 160ms ease",
      }}
    >
      <div style={{ ...EYEBROW, marginBottom: "0.55rem" }}>{monthLong(article.date, lang)}</div>
      <div style={{
        fontSize: compact ? "1rem" : "1.15rem", fontWeight: 650, lineHeight: 1.35,
        color: hover ? "var(--accent)" : "var(--text)",
        marginBottom: compact ? 0 : "0.55rem", transition: "color 160ms ease",
      }}>{t(article.title, lang)}</div>
      {!compact && (
        <div style={{ fontSize: "0.92rem", lineHeight: 1.6, color: "#a5a5b0" }}>{t(article.perex, lang)}</div>
      )}
      {!compact && (
        <div style={{
          marginTop: "0.9rem", fontSize: "0.85rem", color: "var(--accent)",
          opacity: hover ? 1 : 0.72, transition: "opacity 160ms ease",
        }}>
          {sk ? "Čítať analýzu" : "Read the analysis"}
          <span style={{
            display: "inline-block", marginLeft: "0.4rem",
            transform: hover ? "translateX(3px)" : "none",
            transition: "transform 160ms ease",
          }}>→</span>
        </div>
      )}
    </a>
  );
}


/* ────────────────────────────── the pages ────────────────────────────── */

/** The /analyzy index: the list, and what the section is. */
export function IndexView({ articles, loading = false, error = null, navigate, lang }) {
  const sk = lang !== "en";
  return (
    <Shell>
      <div style={EYEBROW}>Residata · {sk ? "Analýzy" : "Insights"}</div>
      <h1 style={{
        fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", fontWeight: 700,
        letterSpacing: "-0.03em", margin: "0 0 1rem", lineHeight: 1.15,
      }}>
        {sk ? "Analýzy trhu novostavieb" : "New-build market analyses"}
      </h1>
      <p style={{ fontSize: "1rem", lineHeight: 1.7, color: "#c5c5cc", margin: "0 0 3rem" }}>
        {sk
          ? "Pravidelný pohľad na trh novostavieb na Slovensku a v Česku — postavený na cenníkoch, ktoré čítame každú noc. Celé Slovensko, nielen Bratislava."
          : "A regular read on the Slovak and Czech new-build market, built from developer price lists we read every night. The whole country, not just the capital."}
      </p>

      {articles.map((a) => <ArticleCard key={a.slug} article={a} navigate={navigate} sk={sk} lang={lang} />)}

      {loading && (
        <p style={{ color: "#8b8b95" }}>{sk ? "Načítavam…" : "Loading…"}</p>
      )}
      {/* A failed load must not read as "we publish nothing" — that is a claim
          about the product, made by a network error. */}
      {!loading && error && (
        <p style={{ color: "#c98b8b" }}>
          {sk ? "Analýzy sa nepodarilo načítať. Skúste stránku obnoviť."
              : "The analyses could not be loaded. Please refresh the page."}
        </p>
      )}
      {!loading && !error && articles.length === 0 && (
        <p style={{ color: "#8b8b95" }}>{sk ? "Zatiaľ nič." : "Nothing published yet."}</p>
      )}

      {/* Closes the page rather than leaving a void under a short list, and does
          the one job the index otherwise has no way of doing: telling a reader
          who wants their own town's figures how to ask for them. */}
      <div style={{
        marginTop: "3.5rem", padding: "1.6rem 1.7rem",
        border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12,
        background: "rgba(255,255,255,0.025)",
      }}>
        <div style={{ ...EYEBROW, marginBottom: "0.7rem" }}>
          {sk ? "Ďalšie číslo" : "Next issue"}
        </div>
        {/* EVERY QUARTER, not monthly: since 2026-09-27 the section is the
            quarterly issue set. "Raz mesačne" promised a cadence it does not keep. */}
        <p style={{ margin: "0 0 0.9rem", fontSize: "0.95rem", lineHeight: 1.7, color: "#c5c5cc" }}>
          {sk
            ? "Prehľady vydávame každý štvrťrok — ponuka, predaj a ceny za celé Slovensko, jeho kraje a najväčšie mestá, z cenníkov, ktoré čítame každú noc."
            : "New reports every quarter — supply, sales and prices for all of Slovakia, its kraje and its largest towns, from price lists we read every night."}
        </p>
        <p style={{ margin: 0, fontSize: "0.95rem", lineHeight: 1.7, color: "#c5c5cc" }}>
          {sk ? "Chcete čísla za svoje mesto alebo mestskú časť? Napíšte na " : "Want the figures for your own town or district? Write to "}
          <a href={`mailto:${COMPANY.email}`} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>
          {sk ? " a pošleme vám ich." : " and we'll send them."}
        </p>
      </div>
    </Shell>
  );
}

/** One article, with the analyses a reader of it is most likely to want next. */
export function ArticleView({ article, related = [], navigate, lang }) {
  const [backHover, setBackHover] = useState(false);
  const en = lang === "en";
  // Citations, share links and embed codes name the public page — never the
  // preview or local address this happens to be rendered on.
  const url = publicUrl(article);
  const title = t(article.title, lang);
  const citation = citationText(article, lang);
  return (
    <Shell>
      <a
        href="/analyzy"
        onClick={(e) => { e.preventDefault(); navigate("Insights"); }}
        onMouseEnter={() => setBackHover(true)}
        onMouseLeave={() => setBackHover(false)}
        style={{
          ...EYEBROW, display: "inline-block", textDecoration: "none",
          opacity: backHover ? 1 : 0.78, transition: "opacity 150ms ease",
        }}
      >
        <span style={{
          display: "inline-block", marginRight: "0.35rem",
          transform: backHover ? "translateX(-3px)" : "none",
          transition: "transform 150ms ease",
        }}>←</span>
        {/* The section name follows the reader's language, like the index does.
            Hardcoded Slovak here put "ANALÝZY" at the top of a fully English
            article — the one page a shared link lands on. */}
        Residata · {lang === "en" ? "Insights" : "Analýzy"}
      </a>

      <h1 style={{
        fontSize: "clamp(1.7rem, 3.2vw, 2.35rem)", fontWeight: 700,
        letterSpacing: "-0.03em", margin: "0 0 1rem", lineHeight: 1.2,
      }}>{t(article.title, lang)}</h1>

      <div style={{
        fontSize: "0.83rem", color: "#8b8b95", marginBottom: "2.4rem",
        paddingBottom: "1.6rem", borderBottom: "1px solid rgba(255,255,255,0.12)",
      }}>
        {dateLong(article.date, lang)} · Residata
      </div>

      <div style={{ fontSize: "0.97rem", lineHeight: 1.78, color: "#c5c5cc" }}>
        {article.blocks.map((b, i) => <Block key={i} block={b} lang={lang} article={article} />)}

        {/* Methodology is a required field on every article — the table refuses one without it.
            It is what makes the piece quotable instead of promotional, so it is
            rendered as part of the article, not as a footnote to be skipped. */}
        <div style={{
          marginTop: "3rem", padding: "1.4rem 1.5rem",
          border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10,
          background: "rgba(255,255,255,0.025)",
        }}>
          <div style={{ ...EYEBROW, marginBottom: "0.6rem" }}>
            {lang === "en" ? "Method" : "Metodika"}
          </div>
          <p style={{ margin: 0, fontSize: "0.87rem", lineHeight: 1.7, color: "#a5a5b0" }}>
            {t(article.method, lang)}
          </p>
        </div>

        {/* How to reuse, cite and share it — the licence in words (Terms §7,
            lib/articleSeo DATA_LICENSE), a citation to copy, and share links. A
            page that says plainly it may be reused is the page that gets cited,
            and a citation with a link is how an analysis earns its links. */}
        <div id={DATA_LICENSE.anchor} style={{
          marginTop: "1.2rem", padding: "1.4rem 1.5rem",
          border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10,
          background: "rgba(255,255,255,0.025)",
        }}>
          <div style={{ ...EYEBROW, marginBottom: "0.6rem" }}>
            {en ? "Using the data" : "Použitie údajov"}
          </div>
          <p style={{ margin: "0 0 1.1rem", fontSize: "0.87rem", lineHeight: 1.7, color: "#a5a5b0" }}>
            {en
              ? <>You may reuse the figures, tables and charts in this analysis, commercially too, as long as you credit Residata and link to this page — licence <a href={DATA_LICENSE.deed.en} target="_blank" rel="license noreferrer" style={{ color: "var(--accent)" }}>{DATA_LICENSE.name}</a>. For figures on a specific town or district, write to </>
              : <>Údaje, tabuľky a grafy z tejto analýzy môžete voľne použiť aj komerčne, ak uvediete zdroj Residata a odkaz na túto stránku — licencia <a href={DATA_LICENSE.deed.sk} target="_blank" rel="license noreferrer" style={{ color: "var(--accent)" }}>{DATA_LICENSE.name}</a>. Ak chcete čísla za konkrétne mesto alebo mestskú časť, napíšte na </>}
            <a href={`mailto:${COMPANY.email}`} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>.
          </p>
          <div style={{ fontSize: "0.72rem", color: "#8b8b95", marginBottom: "0.4rem" }}>
            {en ? "Citation" : "Citácia"}
          </div>
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{
              flex: "1 1 260px", fontSize: "0.84rem", lineHeight: 1.55, color: "#c5c5cc",
              padding: "0.55rem 0.75rem", borderRadius: 8, background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)", wordBreak: "break-word",
            }}>{citation}</div>
            <CopyButton text={citation} label={en ? "Copy" : "Kopírovať"} done={en ? "Copied ✓" : "Skopírované ✓"} />
          </div>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", marginTop: "1rem" }}>
            <span style={{ fontSize: "0.72rem", color: "#8b8b95", marginRight: "0.2rem" }}>{en ? "Share" : "Zdieľať"}</span>
            <a className="rd-btn rd-btn--sm" target="_blank" rel="noreferrer"
               href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}>LinkedIn</a>
            <a className="rd-btn rd-btn--sm"
               href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`}>E-mail</a>
            <CopyButton text={url} label={en ? "Copy link" : "Kopírovať odkaz"} done={en ? "Copied ✓" : "Skopírované ✓"} />
          </div>
        </div>
      </div>

      {/* The analyses a reader of this one most likely wants next — its town's
          kraj, the whole country, the national tables. The same links are how a
          crawler learns the issues belong together (lib/articleSeo.relatedArticles). */}
      {related.length > 0 && (
        <nav aria-label={lang === "en" ? "Related analyses" : "Súvisiace analýzy"} style={{ marginTop: "3.2rem" }}>
          <div style={{ ...EYEBROW, marginBottom: "0.4rem" }}>
            {lang === "en" ? "Related analyses" : "Súvisiace analýzy"}
          </div>
          {related.map((a) => (
            <ArticleCard key={a.slug} article={a} navigate={navigate} sk={lang !== "en"} lang={lang} compact />
          ))}
        </nav>
      )}
    </Shell>
  );
}
