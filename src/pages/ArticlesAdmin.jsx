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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useArticles, useArticle, setArticlePublished, saveArticle, createArticle, deleteArticle } from "../lib/useArticles";
import { SITE_BASE } from "../lib/seo";

/**
 * Edit history for the editor.
 *
 * Boss cleared the Slovak title while trying the editor and there was no way
 * back — the previous value only existed in the database, and only until Save.
 * This keeps the last HISTORY_LIMIT states in memory so ⌘Z walks backwards and
 * ⇧⌘Z forwards, the same as any editor.
 *
 * Deliberately in memory and not persisted: it covers the mistake it exists for
 * (a wrong keystroke in this sitting) without pretending to be version history,
 * which the database already provides through updated_at and a re-seed.
 */
const HISTORY_LIMIT = 20;

/** Block kinds an editor can add. `lead` is excluded: an article has one, first. */
const ADDABLE = ["h2", "p", "figure", "table", "bullets"];

let keySeq = 0;
/** Give every block a stable React key. Index keys reuse the wrong input the
 *  moment a block moves, which lands your cursor in a different paragraph. */
const withKeys = (blocks) => (blocks || []).map((b) => ({ ...b, _k: b._k ?? `k${++keySeq}` }));
/** …and take them off again, so a client-side id never reaches the database. */
const stripKeys = (blocks) => (blocks || []).map(({ _k, ...rest }) => rest);

function emptyBlock(type) {
  const pair = { sk: "", en: "" };
  if (type === "figure") return { type, src: "", srcEn: "", alt: { ...pair }, caption: { ...pair } };
  if (type === "table") return { type, head: { sk: [], en: [] }, rows: [], caption: { ...pair } };
  if (type === "bullets") return { type, items: [{ ...pair }] };
  return { type, text: { ...pair } };
}

/**
 * Edit history for the editor.
 *
 * Boss cleared the Slovak title while trying the editor and there was no way
 * back — the previous value existed only in the database, and only until Save.
 * This keeps the last HISTORY_LIMIT states so ⌘Z walks backwards and ⇧⌘Z
 * forwards, like any editor.
 *
 * The stack and the cursor live in ONE state object on purpose. The first
 * version held them separately with a ref to bridge them, and they desynced:
 * publishing from the editor wrote to the database but the badge never moved,
 * because that update pushed a state the cursor never advanced onto. Two pieces
 * of state that must always agree should not be two pieces of state.
 *
 * In memory rather than persisted: it covers the mistake it exists for — a
 * wrong keystroke in this sitting — without pretending to be version history.
 */
function useHistory() {
  const [h, setH] = useState({ stack: [], at: -1 });

  const reset = useCallback((value) => setH({ stack: [value], at: 0 }), []);

  const push = useCallback((value) => setH((p) => {
    const kept = p.stack.slice(0, p.at + 1);          // a new edit drops the redo tail
    const next = [...kept, value];
    const trimmed = next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
    return { stack: trimmed, at: trimmed.length - 1 };
  }), []);

  const undo = useCallback(() => setH((p) => ({ ...p, at: Math.max(0, p.at - 1) })), []);
  const redo = useCallback(() => setH((p) => ({ ...p, at: Math.min(p.stack.length - 1, p.at + 1) })), []);

  return {
    value: h.at >= 0 ? h.stack[h.at] : undefined,
    push, reset, undo, redo,
    canUndo: h.at > 0,
    canRedo: h.at >= 0 && h.at < h.stack.length - 1,
    depth: h.stack.length,
  };
}

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
    undo: "Späť", redo: "Dopredu", revert: "Zahodiť všetky zmeny",
    steps: "krokov v pamäti",
    emptyTitle: "Titulok nesmie byť prázdny — bez neho je článok na webe bez nadpisu.",
    emptyPerex: "Perex nesmie byť prázdny — zobrazuje sa v zozname a vo vyhľadávaní.",
    liveNow: "Článok je na webe", draftNow: "Článok nie je na webe",
    confirmUnpublish: "Stiahnuť článok z webu? Prestane byť verejne dostupný.",
    date: "Dátum článku", ogImage: "Zdieľaný obrázok (cesta k súboru)",
    alt: "Alternatívny text obrázka (pre čítačky a vyhľadávače)",
    newArticle: "Nový článok", newSlug: "URL nového článku (napr. trh-novostavieb-2026-10)",
    addBlock: "Pridať", up: "Hore", down: "Dole", removeBlock: "Zmazať blok",
    confirmRemoveBlock: "Zmazať tento blok? Undo (⌘Z) ho vráti.",
    bAddP: "Odsek", bAddH2: "Nadpis", bAddFigure: "Graf", bAddTable: "Tabuľka", bAddBullets: "Odrážky",
    imgPath: "Cesta k obrázku (SK)", imgPathEn: "Cesta k obrázku (EN)",
    deleteArticle: "Zmazať článok",
    confirmDeleteArticle: "Nenávratne zmazať tento článok? Publikovaný článok najprv stiahnite.",
    cannotDeletePublished: "Publikovaný článok sa nedá zmazať — najprv ho stiahnite z webu.",
    loadFailed: "Články sa nepodarilo načítať.",
    conflict: "Článok medzitým zmenil niekto iný. Načítajte ho znova, inak prepíšete jeho zmeny.",
    reloadArticle: "Načítať znova",
    methodTooShort: "Metodika musí mať aspoň 40 znakov v oboch jazykoch.",
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
    undo: "Undo", redo: "Redo", revert: "Discard all changes",
    steps: "steps remembered",
    emptyTitle: "The title cannot be empty — the article would have no headline.",
    emptyPerex: "The standfirst cannot be empty — it is shown in the list and in search results.",
    liveNow: "Live on the site", draftNow: "Not on the site",
    confirmUnpublish: "Withdraw from the site? It will stop being publicly available.",
    date: "Article date", ogImage: "Share image (file path)",
    alt: "Image alt text (for screen readers and search)",
    newArticle: "New article", newSlug: "URL for the new article (e.g. trh-novostavieb-2026-10)",
    addBlock: "Add", up: "Up", down: "Down", removeBlock: "Delete block",
    confirmRemoveBlock: "Delete this block? Undo (⌘Z) brings it back.",
    bAddP: "Paragraph", bAddH2: "Heading", bAddFigure: "Chart", bAddTable: "Table", bAddBullets: "Bullets",
    imgPath: "Image path (SK)", imgPathEn: "Image path (EN)",
    deleteArticle: "Delete article",
    confirmDeleteArticle: "Permanently delete this article? Withdraw it from the site first.",
    cannotDeletePublished: "A published article cannot be deleted — withdraw it from the site first.",
    loadFailed: "The articles could not be loaded.",
    conflict: "Someone else changed this article in the meantime. Reload it, or you will overwrite their changes.",
    reloadArticle: "Reload",
    methodTooShort: "The method note needs at least 40 characters in both languages.",
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
  const { articles, loading, error, reload } = useArticles({ admin: true });
  const [busy, setBusy] = useState(null);
  const [creating, setCreating] = useState(false);

  async function remove(a) {
    if (a.published) { alert(t.cannotDeletePublished); return; }
    if (!window.confirm(t.confirmDeleteArticle)) return;
    setBusy(a.id);
    try { await deleteArticle(a.id); await reload(); }
    catch (e) { alert(e.code === "PUBLISHED" ? t.cannotDeletePublished : e.message); }
    finally { setBusy(null); }
  }

  async function create() {
    const slug = window.prompt(t.newSlug, `trh-novostavieb-${new Date().toISOString().slice(0, 7)}`);
    if (!slug) return;
    setCreating(true);
    try {
      const made = await createArticle({ slug: slug.trim(), date: new Date().toISOString().slice(0, 10) });
      await reload();
      onEdit(made);                       // straight into the editor, which is the point
    } catch (e) { alert(e.message); }
    finally { setCreating(false); }
  }

  async function toggle(a) {
    setBusy(a.id);
    try { await setArticlePublished(a.id, !a.published); await reload(); }
    catch (e) { alert(e.message); }
    finally { setBusy(null); }
  }

  if (loading) return <div style={{ color: "var(--text-dim)" }}>{t.loading}</div>;
  if (error) {
    return (
      <div style={{
        padding: "0.8rem 1rem", borderRadius: 8, color: "#ffb3b3",
        background: "rgba(255,107,107,0.10)", border: "1px solid rgba(255,107,107,0.35)",
      }}>⚠ {t.loadFailed} <span style={{ opacity: 0.7 }}>({error})</span></div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.7rem" }}>
      <div style={{ marginBottom: "0.3rem" }}>
        <button className="rd-btn rd-btn--sm rd-btn--primary" disabled={creating} onClick={create}>
          {creating ? "…" : "+ " + t.newArticle}
        </button>
      </div>
      {!articles.length && <div style={{ color: "var(--text-dim)" }}>{t.empty}</div>}
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
            {!a.published && (
              <button className="rd-btn rd-btn--sm rd-btn--ghost" disabled={busy === a.id}
                      onClick={() => remove(a)}>{t.deleteArticle}</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── the editor ───────────────────────────── */

function ArticleEditor({ slug, lang, onBack, onChanged }) {
  const t = LABEL[lang === "en" ? "en" : "sk"];
  const { article, loading } = useArticle(slug, { admin: true });
  const [saved, setSaved] = useState(null);      // last state known to be in the DB
  const [state, setState] = useState("idle");    // idle | saving | saved
  const [err, setErr] = useState(null);
  const [busyPub, setBusyPub] = useState(false);
  // `published` is a live fact about the row, not editable content, so it is NOT
  // in the history stack: undo after publishing would otherwise show KONCEPT
  // while the database said published.
  const [published, setPublished] = useState(false);
  const [version, setVersion] = useState(null);   // updated_at we based this edit on
  const [conflict, setConflict] = useState(false);
  const hist = useHistory();
  const draft = hist.value;

  useEffect(() => {
    if (!article) return;
    const { published: pub, ...content } = JSON.parse(JSON.stringify(article));
    content.blocks = withKeys(content.blocks);
    hist.reset(content);
    setSaved(content);
    setPublished(pub);
    setVersion(article.updatedAt || null);
  }, [article]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setDraft = useCallback((updater) => {
    hist.push(typeof updater === "function" ? updater(hist.value) : updater);
  }, [hist]);

  const dirty = useMemo(
    () => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  // Empty required text is how the title was lost the first time: the field
  // cleared, the save succeeded, and the public page had no headline. Blocked
  // at the button rather than discovered on the site.
  const problems = useMemo(() => {
    if (!draft) return [];
    const out = [];
    if (!draft.title?.sk?.trim() || !draft.title?.en?.trim()) out.push(t.emptyTitle);
    if (!draft.perex?.sk?.trim() || !draft.perex?.en?.trim()) out.push(t.emptyPerex);
    // The table refuses a method note under 40 characters in either language.
    // Say so here rather than letting Save fail on a constraint.
    if ((draft.method?.sk || "").trim().length <= 40 || (draft.method?.en || "").trim().length <= 40) {
      out.push(t.methodTooShort);
    }
    return out;
  }, [draft, t]);

  // ⌘Z / ⇧⌘Z anywhere in the editor, including inside a textarea — the browser's
  // own undo only covers the focused field, not a block you deleted.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) hist.redo(); else hist.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hist]);

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

  function addBlock(type) {
    setDraft((d) => ({ ...d, blocks: [...d.blocks, ...withKeys([emptyBlock(type)])] }));
  }

  function removeBlock(i) {
    if (!window.confirm(t.confirmRemoveBlock)) return;
    setDraft((d) => ({ ...d, blocks: d.blocks.filter((_, x) => x !== i) }));
  }

  function moveBlock(i, delta) {
    const j = i + delta;
    setDraft((d) => {
      if (j < 0 || j >= d.blocks.length) return d;
      const blocks = d.blocks.slice();
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...d, blocks };
    });
  }

  async function save() {
    if (problems.length) { setErr(problems[0]); return; }
    setState("saving"); setErr(null); setConflict(false);
    try {
      const next = await saveArticle(
        draft.id, { ...draft, blocks: stripKeys(draft.blocks) }, { expectUpdatedAt: version });
      setSaved(JSON.parse(JSON.stringify(draft)));
      setVersion(next);
      setState("saved");
      onChanged?.();
      setTimeout(() => setState("idle"), 2200);
    } catch (e) {
      if (e.code === "CONFLICT") { setConflict(true); setErr(t.conflict); }
      else setErr(e.message);
      setState("idle");
    }
  }

  /** Publish / withdraw from inside the editor — not only from the list. */
  async function togglePublished() {
    const next = !published;
    if (!next && !window.confirm(t.confirmUnpublish)) return;
    setBusyPub(true); setErr(null);
    try {
      await setArticlePublished(draft.id, next);
      setPublished(next);
      onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setBusyPub(false); }
  }

  if (loading || !draft) return <div style={{ color: "var(--text-dim)" }}>{t.loading}</div>;

  const blockLabel = (b) => ({ lead: t.lead, h2: t.h2, p: t.p, figure: t.figure, table: t.table, bullets: t.bAddBullets }[b.type] || b.type);

  return (
    <div>
      <div style={{
        position: "sticky", top: 0, zIndex: 5, background: "var(--bg)",
        paddingBottom: "0.8rem", marginBottom: "1.4rem",
        borderBottom: "1px solid var(--border-soft)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <button className="rd-btn rd-btn--sm rd-btn--ghost" onClick={leave}>{t.back}</button>

          {/* Publish state and its control together — the badge says what is true,
              the button next to it is what changes it. Previously this lived only
              on the list and was not findable from inside the editor. */}
          <Pill on={published}>{published ? t.published : t.draft}</Pill>
          <button className={"rd-btn rd-btn--sm" + (published ? "" : " rd-btn--primary")}
                  disabled={busyPub} onClick={togglePublished}>
            {busyPub ? "…" : (published ? t.unpublish : t.publish)}
          </button>
          <a className="rd-btn rd-btn--sm rd-btn--ghost"
             href={`${SITE_BASE}/analyzy/${draft.slug}`} target="_blank" rel="noreferrer">
            {t.view}
          </a>

          <span style={{ width: 1, height: 20, background: "var(--border-soft)", margin: "0 0.2rem" }} />

          {/* Undo / redo. The browser's own undo only covers the focused field,
              so a deleted block or a cleared title had no way back. */}
          <button className="rd-btn rd-btn--sm rd-btn--ghost" onClick={hist.undo}
                  disabled={!hist.canUndo} title="⌘Z">↶ {t.undo}</button>
          <button className="rd-btn rd-btn--sm rd-btn--ghost" onClick={hist.redo}
                  disabled={!hist.canRedo} title="⇧⌘Z">↷ {t.redo}</button>
          <button className="rd-btn rd-btn--sm rd-btn--ghost" disabled={!dirty}
                  onClick={() => { if (window.confirm(t.revert + "?")) hist.reset(JSON.parse(JSON.stringify(saved))); }}>
            {t.revert}
          </button>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--text-faint)" }}>
            {hist.depth}/{HISTORY_LIMIT} {t.steps}
          </span>

          <div style={{ flex: 1 }} />
          {state === "saved" && <span style={{ color: "var(--accent)", fontSize: "0.8rem" }}>✓ {t.saved}</span>}
          <button className="rd-btn rd-btn--sm rd-btn--primary"
                  disabled={!dirty || state === "saving" || problems.length > 0}
                  onClick={save}>
            {state === "saving" ? t.saving : (dirty ? t.save : t.noChanges)}
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.7rem", alignItems: "center", marginTop: "0.5rem" }}>
          <span style={{ fontFamily: MONO, fontSize: "0.68rem", color: "var(--text-faint)" }}>
            /analyzy/{draft.slug}
          </span>
          <span style={{ fontSize: "0.72rem", color: published ? "var(--accent)" : "var(--text-faint)" }}>
            {published ? "● " + t.liveNow : "○ " + t.draftNow}
          </span>
        </div>

        {/* A required field left blank is how the title was lost the first time:
            cleared, saved, and the public page had no headline. Save stays off
            until it is filled. */}
        {problems.map((msg) => (
          <div key={msg} style={{
            marginTop: "0.6rem", padding: "0.5rem 0.7rem", borderRadius: 7,
            background: "rgba(255,107,107,0.10)", border: "1px solid rgba(255,107,107,0.35)",
            color: "#ffb3b3", fontSize: "0.78rem",
          }}>⚠ {msg}</div>
        ))}
        {err && (
          <div style={{
            marginTop: "0.6rem", padding: "0.5rem 0.7rem", borderRadius: 7,
            background: "rgba(255,107,107,0.10)", border: "1px solid rgba(255,107,107,0.35)",
            color: "#ffb3b3", fontSize: "0.78rem",
            display: "flex", gap: "0.7rem", alignItems: "center",
          }}>
            <span style={{ flex: 1 }}>{err}</span>
            {conflict && (
              <button className="rd-btn rd-btn--sm" onClick={() => window.location.reload()}>
                {t.reloadArticle}
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "200px 1fr", marginBottom: "1.1rem" }}>
        <div>
          <div style={{
            fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.09em",
            textTransform: "uppercase", color: "var(--text-dim)", marginBottom: "0.45rem",
          }}>{t.date}</div>
          <input type="date" value={draft.date || ""}
                 onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                 style={{
                   width: "100%", background: "var(--bg)", color: "var(--text)",
                   border: "1px solid var(--border-soft)", borderRadius: 7,
                   padding: "0.6rem 0.7rem", fontSize: "0.88rem", fontFamily: MONO,
                 }} />
        </div>
        <div>
          <div style={{
            fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.09em",
            textTransform: "uppercase", color: "var(--text-dim)", marginBottom: "0.45rem",
          }}>{t.ogImage}</div>
          <input value={draft.ogImage || ""}
                 onChange={(e) => setDraft((d) => ({ ...d, ogImage: e.target.value }))}
                 placeholder="/analyzy/og-2026-09.png"
                 style={{
                   width: "100%", background: "var(--bg)", color: "var(--text)",
                   border: "1px solid var(--border-soft)", borderRadius: 7,
                   padding: "0.6rem 0.7rem", fontSize: "0.88rem", fontFamily: MONO,
                 }} />
        </div>
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
        <div key={b._k || i} style={{ ...box, marginBottom: "0.9rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.6rem" }}>
            <div style={{
              fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.09em",
              textTransform: "uppercase", color: "var(--text-faint)", flex: 1,
            }}>
              {i + 1}. {blockLabel(b)}
            </div>
            <button className="rd-btn rd-btn--sm rd-btn--ghost" title={t.up}
                    disabled={i === 0} onClick={() => moveBlock(i, -1)}>↑</button>
            <button className="rd-btn rd-btn--sm rd-btn--ghost" title={t.down}
                    disabled={i === draft.blocks.length - 1} onClick={() => moveBlock(i, 1)}>↓</button>
            <button className="rd-btn rd-btn--sm rd-btn--ghost" title={t.removeBlock}
                    onClick={() => removeBlock(i)}>✕</button>
          </div>

          {(b.type === "lead" || b.type === "p" || b.type === "h2") && (
            <BiField label="" rows={b.type === "h2" ? 1 : 5} value={b.text}
                     onChange={(v) => setBlock(i, { text: v })} />
          )}

          {b.type === "bullets" && (
            <>
              {(b.items || []).map((it, k) => (
                <BiField key={k} label={`• ${k + 1}`} rows={2} value={it}
                         onChange={(v) => setBlock(i, {
                           items: (b.items || []).map((x, y) => (y === k ? v : x)),
                         })} />
              ))}
              <button className="rd-btn rd-btn--sm rd-btn--ghost"
                      onClick={() => setBlock(i, { items: [...(b.items || []), { sk: "", en: "" }] })}>
                + {t.addBlock}
              </button>
            </>
          )}

          {(b.type === "figure" || b.type === "table") && (
            <>
              {b.src ? (
                <div style={{ marginBottom: "0.8rem" }}>
                  <img src={b.src} alt="" style={{
                    width: "100%", maxWidth: 420, borderRadius: 8, background: "#fff",
                    display: "block", border: "1px solid var(--border-soft)",
                  }} />
                </div>
              ) : null}
              {b.type === "figure" && (
                <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: "1fr 1fr", marginBottom: "1.1rem" }}>
                  {[["src", t.imgPath], ["srcEn", t.imgPathEn]].map(([field, label]) => (
                    <div key={field}>
                      <div style={{ fontSize: "0.65rem", color: "var(--text-faint)", marginBottom: "0.25rem" }}>
                        {label}
                      </div>
                      <input value={b[field] || ""} placeholder="/analyzy/…svg"
                             onChange={(e) => setBlock(i, { [field]: e.target.value })}
                             style={{
                               width: "100%", background: "var(--bg)", color: "var(--text)",
                               border: "1px solid var(--border-soft)", borderRadius: 7,
                               padding: "0.55rem 0.7rem", fontSize: "0.82rem", fontFamily: MONO,
                             }} />
                    </div>
                  ))}
                </div>
              )}
              <BiField label={t.caption} rows={2} value={b.caption}
                       onChange={(v) => setBlock(i, { caption: v })} />
              <BiField label={t.alt} rows={1} value={b.alt}
                       onChange={(v) => setBlock(i, { alt: v })} />
            </>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.4rem" }}>
        <span style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--text-dim)" }}>
          {t.addBlock}:
        </span>
        {ADDABLE.map((type) => (
          <button key={type} className="rd-btn rd-btn--sm rd-btn--ghost" onClick={() => addBlock(type)}>
            + {{ h2: t.bAddH2, p: t.bAddP, figure: t.bAddFigure, table: t.bAddTable, bullets: t.bAddBullets }[type]}
          </button>
        ))}
      </div>

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
  // Bumped whenever the editor publishes or saves, so returning to the list
  // shows the change rather than a cached row.
  const [rev, setRev] = useState(0);

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
        ? <ArticleEditor slug={editing} lang={lang} onBack={() => setEditing(null)}
                         onChanged={() => setRev((r) => r + 1)} />
        : <ArticleList key={rev} lang={lang} onEdit={setEditing} />}
    </div>
  );
}
