/**
 * /app/articles — manage the /analyzy analyses without a developer.
 *
 * WHAT IT DOES
 *   Lists every analysis including drafts, publishes and withdraws with one
 *   click, and opens one in an editor where every piece of text on the page can
 *   be changed in both languages and saved.
 *
 * WHY NO RICH-TEXT EDITOR
 *   The app has four runtime dependencies and the analyses have a deliberate
 *   fixed shape — declarative headline, lead, sections, figures, a mandatory
 *   method note. A WYSIWYG box would let that shape drift and would add ~100 kB
 *   to do it. Each block gets the input its type needs instead: a heading is one
 *   line, a paragraph is a textarea, a figure's image is fixed and only its
 *   caption is editable. Charts are generated files, not something to retype.
 *
 * WHY NO API ROUTE
 *   The app is at exactly 12 of 12 Vercel Hobby functions. Writes go straight to
 *   PostgREST and RLS decides who may make them — see the migration.
 *
 * SAFETY
 *   Nothing saves until Save is pressed, the button only lights up when
 *   something actually changed, and leaving with unsaved edits asks first.
 */

import { useEffect, useMemo, useState } from "react";
import { useArticles, useArticle, setArticlePublished, saveArticle } from "../lib/useArticles";
import { SITE_BASE } from "../lib/seo";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const LABEL = {
  sk: {
    heading: "Analýzy", sub: "Správa článkov na /analyzy",
    published: "Publikované", draft: "Koncept", edit: "Upraviť", back: "← Späť na zoznam",
    publish: "Publikovať", unpublish: "Stiahnuť", view: "Zobraziť na webe",
    save: "Uložiť zmeny", saving: "Ukladám…", saved: "Uložené", noChanges: "Žiadne zmeny",
    title: "Titulok", perex: "Perex", method: "Metodika", blocks: "Obsah",
    lead: "Úvodný odsek", h2: "Nadpis sekcie", p: "Odsek", figure: "Graf — popis",
    table: "Tabuľka — popis", caption: "Popis pod grafom", empty: "Zatiaľ žiadne články.",
    loading: "Načítavam…", unsaved: "Máte neuložené zmeny. Naozaj odísť?",
    lastEdit: "Naposledy upravené",
  },
  en: {
    heading: "Analyses", sub: "Manage the articles at /analyzy",
    published: "Published", draft: "Draft", edit: "Edit", back: "← Back to list",
    publish: "Publish", unpublish: "Withdraw", view: "View on the site",
    save: "Save changes", saving: "Saving…", saved: "Saved", noChanges: "No changes",
    title: "Title", perex: "Standfirst", method: "Method note", blocks: "Body",
    lead: "Opening paragraph", h2: "Section heading", p: "Paragraph", figure: "Chart — caption",
    table: "Table — caption", caption: "Caption", empty: "No articles yet.",
    loading: "Loading…", unsaved: "You have unsaved changes. Leave anyway?",
    lastEdit: "Last edited",
  },
};

const box = {
  background: "var(--surface)", border: "1px solid var(--border-soft)",
  borderRadius: 10, padding: "1rem 1.1rem",
};

function Pill({ on, children }) {
  return (
    <span style={{
      fontFamily: MONO, fontSize: "0.65rem", letterSpacing: "0.08em",
      textTransform: "uppercase", padding: "0.22rem 0.5rem", borderRadius: 5,
      color: on ? "#0b2b23" : "var(--text-dim)",
      background: on ? "var(--accent)" : "var(--surface-2)",
      border: on ? "none" : "1px solid var(--border-soft)",
    }}>{children}</span>
  );
}

/** A {sk,en} pair of inputs. One field, two languages, always side by side. */
function BiField({ label, value, onChange, rows = 3, mono = false }) {
  const v = value || {};
  const common = {
    width: "100%", background: "var(--bg)", color: "var(--text)",
    border: "1px solid var(--border-soft)", borderRadius: 7,
    padding: "0.6rem 0.7rem", fontSize: "0.88rem", lineHeight: 1.6,
    fontFamily: mono ? MONO : "inherit", resize: "vertical",
  };
  return (
    <div style={{ marginBottom: "1.1rem" }}>
      <div style={{
        fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.09em",
        textTransform: "uppercase", color: "var(--text-dim)", marginBottom: "0.45rem",
      }}>{label}</div>
      <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "1fr 1fr" }}>
        {["sk", "en"].map((lc) => (
          <div key={lc}>
            <div style={{ fontSize: "0.65rem", color: "var(--text-faint)", marginBottom: "0.25rem" }}>
              {lc.toUpperCase()}
            </div>
            {rows === 1
              ? <input style={common} value={v[lc] || ""}
                       onChange={(e) => onChange({ ...v, [lc]: e.target.value })} />
              : <textarea style={common} rows={rows} value={v[lc] || ""}
                          onChange={(e) => onChange({ ...v, [lc]: e.target.value })} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────── the list ────────────────────────────── */

function ArticleList({ lang, onEdit }) {
  const t = LABEL[lang === "en" ? "en" : "sk"];
  const { articles, loading, reload } = useArticles({ admin: true });
  const [busy, setBusy] = useState(null);

  async function toggle(a) {
    setBusy(a.id);
    try { await setArticlePublished(a.id, !a.published); await reload(); }
    catch (e) { alert(e.message); }
    finally { setBusy(null); }
  }

  if (loading) return <div style={{ color: "var(--text-dim)" }}>{t.loading}</div>;
  if (!articles.length) return <div style={{ color: "var(--text-dim)" }}>{t.empty}</div>;

  return (
    <div style={{ display: "grid", gap: "0.7rem" }}>
      {articles.map((a) => (
        <div key={a.id} style={{ ...box, display: "flex", gap: "1rem", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginBottom: "0.4rem" }}>
              <Pill on={a.published}>{a.published ? t.published : t.draft}</Pill>
              <span style={{ fontFamily: MONO, fontSize: "0.7rem", color: "var(--text-faint)" }}>
                {a.date}
              </span>
            </div>
            <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: "0.3rem" }}>
              {a.title?.sk || a.title?.en || a.slug}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", lineHeight: 1.55 }}>
              {(a.perex?.sk || a.perex?.en || "").slice(0, 160)}
            </div>
            <div style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--text-faint)", marginTop: "0.5rem" }}>
              /analyzy/{a.slug}
              {a.updatedAt && ` · ${t.lastEdit} ${String(a.updatedAt).slice(0, 16).replace("T", " ")}`}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", flexShrink: 0 }}>
            <button className="rd-btn rd-btn--sm" onClick={() => onEdit(a.slug)}>{t.edit}</button>
            <button className={"rd-btn rd-btn--sm" + (a.published ? "" : " rd-btn--primary")}
                    disabled={busy === a.id} onClick={() => toggle(a)}>
              {busy === a.id ? "…" : (a.published ? t.unpublish : t.publish)}
            </button>
            <a className="rd-btn rd-btn--sm rd-btn--ghost" href={`${SITE_BASE}/analyzy/${a.slug}`}
               target="_blank" rel="noreferrer">{t.view}</a>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── the editor ───────────────────────────── */

function ArticleEditor({ slug, lang, onBack }) {
  const t = LABEL[lang === "en" ? "en" : "sk"];
  const { article, loading } = useArticle(slug, { admin: true });
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState("idle");   // idle | saving | saved
  const [err, setErr] = useState(null);

  useEffect(() => { if (article) setDraft(JSON.parse(JSON.stringify(article))); }, [article]);

  const dirty = useMemo(
    () => !!draft && !!article && JSON.stringify(draft) !== JSON.stringify(article),
    [draft, article]
  );

  // Losing an edit to a stray click is the one unrecoverable thing here.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function leave() {
    if (dirty && !window.confirm(t.unsaved)) return;
    onBack();
  }

  function setBlock(i, patch) {
    setDraft((d) => {
      const blocks = d.blocks.slice();
      blocks[i] = { ...blocks[i], ...patch };
      return { ...d, blocks };
    });
  }

  async function save() {
    setState("saving"); setErr(null);
    try {
      await saveArticle(draft.id, draft);
      setState("saved");
      setTimeout(() => setState("idle"), 2200);
    } catch (e) { setErr(e.message); setState("idle"); }
  }

  if (loading || !draft) return <div style={{ color: "var(--text-dim)" }}>{t.loading}</div>;

  const blockLabel = (b) => ({ lead: t.lead, h2: t.h2, p: t.p, figure: t.figure, table: t.table }[b.type] || b.type);

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "1.4rem",
        position: "sticky", top: 0, zIndex: 5, background: "var(--bg)",
        paddingBottom: "0.8rem", borderBottom: "1px solid var(--border-soft)",
      }}>
        <button className="rd-btn rd-btn--sm rd-btn--ghost" onClick={leave}>{t.back}</button>
        <Pill on={draft.published}>{draft.published ? t.published : t.draft}</Pill>
        <span style={{ fontFamily: MONO, fontSize: "0.7rem", color: "var(--text-faint)" }}>
          /analyzy/{draft.slug}
        </span>
        <div style={{ flex: 1 }} />
        {err && <span style={{ color: "var(--danger, #ff6b6b)", fontSize: "0.8rem" }}>{err}</span>}
        {state === "saved" && <span style={{ color: "var(--accent)", fontSize: "0.8rem" }}>✓ {t.saved}</span>}
        <button className="rd-btn rd-btn--sm rd-btn--primary" disabled={!dirty || state === "saving"}
                onClick={save}>
          {state === "saving" ? t.saving : (dirty ? t.save : t.noChanges)}
        </button>
      </div>

      <BiField label={t.title} rows={2} value={draft.title}
               onChange={(v) => setDraft((d) => ({ ...d, title: v }))} />
      <BiField label={t.perex} rows={3} value={draft.perex}
               onChange={(v) => setDraft((d) => ({ ...d, perex: v }))} />

      <div style={{
        fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.09em",
        textTransform: "uppercase", color: "var(--text-dim)",
        margin: "2rem 0 0.8rem", paddingTop: "1rem", borderTop: "1px solid var(--border-soft)",
      }}>{t.blocks}</div>

      {draft.blocks.map((b, i) => (
        <div key={i} style={{ ...box, marginBottom: "0.9rem" }}>
          <div style={{
            fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.09em",
            textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "0.6rem",
          }}>
            {i + 1}. {blockLabel(b)}
          </div>

          {(b.type === "lead" || b.type === "p" || b.type === "h2") && (
            <BiField label="" rows={b.type === "h2" ? 1 : 5} value={b.text}
                     onChange={(v) => setBlock(i, { text: v })} />
          )}

          {(b.type === "figure" || b.type === "table") && (
            <>
              {b.src && (
                <div style={{ marginBottom: "0.8rem" }}>
                  <img src={b.src} alt="" style={{
                    width: "100%", maxWidth: 420, borderRadius: 8, background: "#fff",
                    display: "block", border: "1px solid var(--border-soft)",
                  }} />
                  <div style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--text-faint)", marginTop: "0.35rem" }}>
                    {b.src}
                  </div>
                </div>
              )}
              <BiField label={t.caption} rows={2} value={b.caption}
                       onChange={(v) => setBlock(i, { caption: v })} />
            </>
          )}
        </div>
      ))}

      <div style={{ marginTop: "2rem", paddingTop: "1rem", borderTop: "1px solid var(--border-soft)" }}>
        <BiField label={t.method} rows={6} value={draft.method}
                 onChange={(v) => setDraft((d) => ({ ...d, method: v }))} />
      </div>
    </div>
  );
}

/* ───────────────────────────── the page ───────────────────────────── */

export default function ArticlesAdmin({ lang = "sk" }) {
  const t = LABEL[lang === "en" ? "en" : "sk"];
  const [editing, setEditing] = useState(null);

  return (
    <div style={{ padding: "1.5rem 1.75rem 4rem", maxWidth: 1000 }}>
      <div style={{
        fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.1em",
        textTransform: "uppercase", color: "var(--accent)", marginBottom: "0.4rem",
      }}>Residata</div>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.3rem", color: "var(--text)" }}>
        {t.heading}
      </h1>
      <p style={{ color: "var(--text-dim)", fontSize: "0.86rem", margin: "0 0 1.8rem" }}>{t.sub}</p>

      {editing
        ? <ArticleEditor slug={editing} lang={lang} onBack={() => setEditing(null)} />
        : <ArticleList lang={lang} onEdit={setEditing} />}
    </div>
  );
}
