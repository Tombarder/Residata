/**
 * /analyzy — published market analyses, and the detail page for one.
 *
 * WHAT THIS PAGE IS FOR
 *   Three jobs, in order: rank for what developers actually search
 *   ("ceny novostavieb", "analýza trhu novostavieb"), give a journalist a stable
 *   URL they can cite, and be the canonical home of an issue that is syndicated
 *   elsewhere. Everything below serves one of those.
 *
 * DESIGN
 *   The article shell copies LegalPages' idiom deliberately (same CSS variables,
 *   same 9rem top padding to clear the fixed Nav + Ticker, same 760px measure) so
 *   the section does not read as bolted on. Figures are LIGHT cards on the dark
 *   page — the standard publication pattern — because one light chart variant
 *   then serves the page, the LinkedIn image, the og:image and print, instead of
 *   two variants that have to be kept in sync and still break when printed.
 *
 * BLOCKS
 *   Content is a list of typed blocks, not Markdown, so the house style cannot
 *   drift between issues and `method` cannot be forgotten. See content/analyzy/format.js.
 */

import { useEffect, useState } from "react";
import { ARTICLES, getArticle } from "../content/analyzy";
import { t, dateLong, monthLong } from "../content/analyzy/format";
import { SITE_BASE } from "../lib/seo";
import { COMPANY } from "../lib/company";

const MEASURE = 760;

const EYEBROW = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.7rem",
  color: "var(--accent)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  marginBottom: "0.8rem",
};

function Shell({ children }) {
  return (
    <div className="rd-analysis" style={{ background: "var(--bg)", minHeight: "100vh", color: "var(--text)" }}>
      <div style={{ maxWidth: MEASURE, margin: "0 auto", padding: "9rem 2rem 6rem" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Land at the headline, not wherever the previous page was scrolled to.
 *
 * App's handleNav already calls scrollTo({behavior:"smooth"}), but the smooth
 * animation gets cancelled when the outgoing page unmounts and the document
 * height changes underneath it — measured: clicking an article from the index
 * at scroll 600 left the reader at 600, i.e. halfway down the piece. An instant
 * reset on mount is unconditional and also covers arriving by direct URL.
 */
function useScrollToTop(key) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [key]);
}

/* ─────────────────────────── block renderers ─────────────────────────── */

function Figure({ src, srcEn, alt, caption, lang }) {
  const source = lang === "en" && srcEn ? srcEn : src;
  return (
    <figure style={{ margin: "2.4rem 0" }}>
      {/* Light card on a dark page. The chart is generated light once and reused
          for the page, LinkedIn and print — see the file header. */}
      <div style={{
        background: "#fff",
        borderRadius: 12,
        padding: "0.75rem",
        // Hairline + shadow so the white card reads as a mounted figure rather
        // than a hole punched in the page.
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
      }}>
        <img src={source} alt={t(alt, lang)} loading="lazy"
             style={{ width: "100%", height: "auto", display: "block", borderRadius: 6 }} />
      </div>
      {caption && (
        <figcaption style={{
          fontSize: "0.8rem", color: "#8b8b95", marginTop: "0.7rem", lineHeight: 1.5,
        }}>{t(caption, lang)}</figcaption>
      )}
    </figure>
  );
}

function Table({ head, rows, caption, lang }) {
  const heads = t(head, lang) || head;
  return (
    <figure style={{ margin: "2.4rem 0" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr>
              {heads.map((h, i) => (
                <th key={h} style={{
                  textAlign: i === 0 ? "left" : "right",
                  padding: "0.6rem 0.75rem",
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
                    padding: "0.55rem 0.75rem",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    color: ci === 0 ? "#e8e8ee" : "#c5c5cc",
                    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                  }}>{cell}</td>
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

function Block({ block, lang }) {
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
      return <Figure {...block} lang={lang} />;
    case "table":
      return <Table {...block} lang={lang} />;
    default:
      return null;
  }
}

/* ───────────────────────────── structured data ───────────────────────── */

/**
 * JSON-LD `Article`. This is what lets Google treat the page as a dated article
 * with an author and a publisher rather than as another marketing page, and it is
 * what a citation surface needs. Removed on unmount so a client-side navigation
 * never leaves a previous article's schema behind on an unrelated page.
 */
function useArticleSchema(article, lang) {
  useEffect(() => {
    if (!article || typeof document === "undefined") return undefined;
    const url = `${SITE_BASE}/analyzy/${article.slug}`;
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "ld-article";
    el.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: t(article.title, lang),
      description: t(article.perex, lang),
      datePublished: article.date,
      dateModified: article.date,
      inLanguage: lang === "en" ? "en" : "sk",
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      url,
      image: article.ogImage ? SITE_BASE + article.ogImage : undefined,
      author: { "@type": "Organization", name: "Residata", url: SITE_BASE },
      // The publisher is the legal entity, the author is the product brand —
      // both come from lib/company, which is the single source for every surface
      // that names the company. Never retype a company detail here.
      publisher: {
        "@type": "Organization",
        name: COMPANY.legalName,
        url: SITE_BASE,
      },
      isAccessibleForFree: true,
    });
    document.head.appendChild(el);
    return () => { document.getElementById("ld-article")?.remove(); };
  }, [article, lang]);
}

/* ────────────────────────────── the pages ────────────────────────────── */

/**
 * One row in the index. A card the whole of which is clickable needs to SAY so —
 * a pointer cursor alone is the difference between "a list" and "a list you can
 * use". Hover lifts the title to the accent and warms the row; the arrow slides.
 */
function ArticleCard({ article, navigate, sk, lang }) {
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
        padding: "1.6rem 1rem 1.6rem 1rem", margin: "0 -1rem",
        borderTop: "1px solid rgba(255,255,255,0.12)",
        borderRadius: hover ? 10 : 0,
        background: hover ? "rgba(255,255,255,0.035)" : "transparent",
        transition: "background 160ms ease, border-radius 160ms ease",
      }}
    >
      <div style={{ ...EYEBROW, marginBottom: "0.55rem" }}>{monthLong(article.date, lang)}</div>
      <div style={{
        fontSize: "1.15rem", fontWeight: 650, lineHeight: 1.35,
        color: hover ? "var(--accent)" : "var(--text)",
        marginBottom: "0.55rem", transition: "color 160ms ease",
      }}>{t(article.title, lang)}</div>
      <div style={{ fontSize: "0.92rem", lineHeight: 1.6, color: "#a5a5b0" }}>{t(article.perex, lang)}</div>
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
    </a>
  );
}

export function InsightsIndex({ navigate, lang }) {
  const sk = lang !== "en";
  useScrollToTop("index");
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

      {ARTICLES.map((a) => <ArticleCard key={a.slug} article={a} navigate={navigate} sk={sk} lang={lang} />)}

      {ARTICLES.length === 0 && (
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
        <p style={{ margin: "0 0 0.9rem", fontSize: "0.95rem", lineHeight: 1.7, color: "#c5c5cc" }}>
          {sk
            ? "Analýzu vydávame raz mesačne — ponuka, predaje a ceny za celé Slovensko a Česko, z cenníkov, ktoré čítame každú noc."
            : "A new analysis every month — supply, sales and prices across Slovakia and Czechia, from price lists we read every night."}
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

export function InsightsArticle({ slug, navigate, lang }) {
  const article = getArticle(slug);
  const [backHover, setBackHover] = useState(false);
  useArticleSchema(article, lang);
  useScrollToTop(slug);

  // Unknown slug: land on the index rather than a dead end. A stale link stays
  // inside the section it pointed at, which is what a visitor from a shared URL
  // or an old newsletter actually wants.
  if (!article) return <InsightsIndex navigate={navigate} lang={lang} />;

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
        Residata · Analýzy
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
        {article.blocks.map((b, i) => <Block key={i} block={b} lang={lang} />)}

        {/* Methodology is a required field on every article — see content/analyzy/format.js.
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

        <p style={{ marginTop: "2rem", fontSize: "0.87rem", color: "#8b8b95", lineHeight: 1.7 }}>
          {lang === "en"
            ? "You are welcome to quote this analysis, citing Residata and linking to this page. For the figures on a specific town or district, write to "
            : "Analýzu môžete voľne citovať s uvedením zdroja (Residata) a odkazom na túto stránku. Ak chcete čísla za konkrétne mesto alebo mestskú časť, napíšte na "}
          <a href={`mailto:${COMPANY.email}`} style={{ color: "var(--accent)" }}>{COMPANY.email}</a>.
        </p>
      </div>
    </Shell>
  );
}

export default InsightsIndex;
