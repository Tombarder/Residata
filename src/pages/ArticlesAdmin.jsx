/**
 * /app/articles (admin → Analýzy) — manage the /analyzy analyses without a developer.
 *
 * WHAT IT DOES
 *   Holds Boss's switch for the whole section (shown / hidden on the site —
 *   lib/siteSections, Boss 2026-10-07). Lists every analysis including drafts — filtered (all / on the site / drafts)
 *   and searchable — publishes, withdraws and deletes with one click, and opens
 *   one in an editor where every piece of text can be changed in both languages,
 *   any block (a paragraph, a heading, a chart, a table) added, moved or deleted,
 *   and the result previewed exactly as the public page will draw it before it
 *   is saved.
 *
 * WHY NO RICH-TEXT EDITOR
 *   The app has four runtime dependencies and the analyses have a deliberate
 *   fixed shape — declarative headline, lead, sections, figures, a mandatory
 *   method note. A WYSIWYG box would let that shape drift and would add ~100 kB
 *   to do it. Each block gets the input its type needs instead: a heading is one
 *   line, a paragraph is a textarea, a figure's image is fixed and only its
 *   caption is editable. Charts are generated files, not something to retype.
 *   The preview is the public page's own component (insightsView ArticleView),
 *   so what it shows cannot drift from what readers get.
 *
 * WHY NO API ROUTE
 *   The app is at exactly 12 of 12 Vercel Hobby functions. Writes go straight to
 *   PostgREST and RLS decides who may make them — see the migration.
 *
 * SAFETY
 *   Nothing saves until Save (or ⌘S) is pressed, the button only lights up when
 *   something actually changed, and leaving with unsaved edits asks first. Every
 *   question is the platform's own dialog (components/Modal), never the browser's
 *   alert/confirm/prompt — those block the tab and read like a message from
 *   another site.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArticles, useArticle, setArticlePublished, saveArticle, createArticle, deleteArticle } from "../lib/useArticles";
import { filesNotLive } from "../lib/articleFiles";
import { SITE_BASE } from "../lib/seo";
import { openManualSteps } from "../lib/articleSeo";
import { articleMatches, articleCounts, slugProblem, ARTICLE_FILTERS } from "../lib/articlesAdmin.js";
import { useSiteSection } from "../lib/siteSections";
import Modal from "../components/Modal";
import ArticleSeoPanel from "./articleSeoPanel";
import { ArticleView } from "./insightsView";

const HISTORY_LIMIT = 20;

/** Block kinds an editor can add. `lead` is excluded: an article has one, first. */
const ADDABLE = ["h2", "p", "figure", "table", "bullets"];

let keySeq = 0;
/** Give every block a stable React key. Index keys reuse the wrong input the
 *  moment a block moves, which lands your cursor in a different paragraph. */
const withKeys = (blocks) => (blocks || []).map((b) => ({ ...b, _k: b._k ?? `k${++keySeq}` }));
/** …and take them off again, so a client-side id never reaches the database. */
const stripKeys = (blocks) => (blocks || []).map(({ _k, ...rest }) => rest);

/** "a | b | c" -> ["a","b","c"]; empty string -> []. */
const splitCells = (line) =>
  (line || "").split("|").map((c) => c.trim()).filter((c, i, all) => c || i < all.length - 1);

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
    heading: "Analýzy", sub: "Články na residata.eu/analyzy — publikovanie, úpravy, mazanie.",
    published: "Publikované", draft: "Koncept", edit: "Upraviť", back: "← Späť na zoznam",
    manualSteps: "ručné kroky",
    publish: "Publikovať", unpublish: "Stiahnuť z webu", view: "Zobraziť na webe",
    save: "Uložiť zmeny", saving: "Ukladám…", saved: "Uložené", noChanges: "Žiadne zmeny",
    title: "Titulok", perex: "Perex", method: "Metodika", blocks: "Obsah",
    lead: "Úvodný odsek", h2: "Nadpis sekcie", p: "Odsek", figure: "Graf",
    table: "Tabuľka", caption: "Popis pod grafom", empty: "Zatiaľ žiadne články.",
    noMatch: "Žiadny článok nezodpovedá filtru.",
    loading: "Načítavam…",
    lastEdit: "Naposledy upravené",
    undo: "Späť", redo: "Dopredu", revert: "Zahodiť zmeny",
    steps: "krokov v pamäti",
    emptyTitle: "Titulok nesmie byť prázdny — bez neho je článok na webe bez nadpisu.",
    emptyPerex: "Perex nesmie byť prázdny — zobrazuje sa v zozname a vo vyhľadávaní.",
    emptyDate: "Dátum musí byť vyplnený — určuje poradie článkov na webe.",
    liveNow: "Článok je na webe", draftNow: "Článok nie je na webe",
    liveHidden: "Publikovaný — ale sekcia je skrytá, na webe sa nezobrazuje",
    secTitle: "Sekcia Analýzy na webe", secOn: "Zobrazená", secOff: "Skrytá",
    secOnBody: "Návštevníci vidia v menu odkaz Analýzy a všetky publikované články.",
    secOnEmpty: "Zapnutá, ale na webe sa nezobrazí, kým nie je publikovaný aspoň jeden článok.",
    secOffBody: "Na webe nie je odkaz v menu, stránka /analyzy ani žiadny článok — ani v mape stránky pre Google. Články ostávajú tak, ako sú: po zobrazení sa vrátia publikované.",
    secHide: "Skryť sekciu z webu", secShow: "Zobraziť sekciu na webe",
    secChanged: "Naposledy zmenené", secDelay: "Zmena sa na webe prejaví do pár minút — web sa sám znovu zostaví.",
    secLoadFailed: "Nastavenie sekcie sa nepodarilo načítať.", secNotAllowed: "Sekciu môže skryť alebo zobraziť len admin.",
    qHideT: "Skryť celú sekciu Analýzy?",
    qHideB: "Z webu zmizne odkaz v menu, stránka /analyzy aj všetky články, aj z mapy stránky pre Google. Nič sa nemaže — články ostanú publikované a po zobrazení sekcie sa vrátia. Prejaví sa do pár minút.",
    qShowT: "Zobraziť sekciu Analýzy na webe?",
    qShowB: (n) => n > 0
      ? `Na webe sa objaví odkaz v menu a ${n} publikovaných článkov. Prejaví sa do pár minút.`
      : "Sekcia sa zapne, ale na webe sa objaví až keď publikujete aspoň jeden článok.",
    tHidden: "Sekcia skrytá — z webu zmizne do pár minút.", tShown: "Sekcia zobrazená — na webe do pár minút.",
    date: "Dátum článku", ogImage: "Zdieľaný obrázok (cesta k súboru)",
    alt: "Alternatívny text obrázka (pre čítačky a vyhľadávače)",
    newArticle: "Nový článok", newSlug: "Adresa článku", newSlugHint: "Malé písmená, čísla a pomlčky — napr. trh-novostavieb-2026-10. Adresu po vytvorení už nemeňte, odkazy na ňu by prestali fungovať.",
    create: "Vytvoriť a otvoriť",
    slugErr: {
      empty: "Vyplňte adresu článku.",
      format: "Adresa smie obsahovať len malé písmená bez diakritiky, číslice a pomlčky (nie na začiatku ani na konci).",
      taken: "Článok s touto adresou už existuje.",
    },
    addBlock: "Pridať blok", up: "Posunúť hore", down: "Posunúť dole", removeBlock: "Zmazať blok",
    bAddP: "Odsek", bAddH2: "Nadpis", bAddFigure: "Graf", bAddTable: "Tabuľka", bAddBullets: "Odrážky",
    imgPath: "Cesta k obrázku (SK)", imgPathEn: "Cesta k obrázku (EN)",
    tableHead: "Hlavička (stĺpce oddelené |)", tableRows: "Riadky (bunky |, riadok na nový riadok)",
    deleteArticle: "Zmazať článok",
    filesNotLive: "Článok sa zatiaľ nedá publikovať: tieto grafy alebo obrázok na zdieľanie ešte nie sú na webe. Najprv ich treba nahrať do repozitára a počkať na nasadenie:",
    loadFailed: "Články sa nepodarilo načítať.",
    conflict: "Článok medzitým zmenil niekto iný. Načítajte ho znova, inak prepíšete jeho zmeny.",
    reloadArticle: "Načítať znova",
    methodTooShort: "Metodika musí mať aspoň 40 znakov v oboch jazykoch.",
    search: "Hľadať v názve, perexe alebo adrese…",
    filters: { all: "Všetky", published: "Publikované", draft: "Koncepty" },
    tabEdit: "Úpravy", tabPreview: "Náhľad",
    previewNote: "Takto bude článok vyzerať na webe — vrátane neuložených zmien.",
    cancel: "Zrušiť", close: "Zavrieť",
    // dialogs
    qUnpublishT: "Stiahnuť článok z webu?",
    qUnpublishB: "Prestane byť verejne dostupný a zmizne zo zoznamu analýz aj z mapy stránky. Web sa obnoví do pár minút. Neskôr ho môžete znova publikovať.",
    qDeleteT: "Natrvalo zmazať článok?",
    qDeleteB: (title) => `„${title}" bude nenávratne zmazaný vrátane celého textu. Toto sa nedá vrátiť.`,
    qDeleteLiveB: (title) => `„${title}" je teraz na webe. Najprv ho stiahneme z webu a potom nenávratne zmažeme vrátane celého textu. Toto sa nedá vrátiť.`,
    qRemoveBlockT: "Zmazať tento blok?",
    qRemoveBlockB: (what) => `${what} zmizne z článku. Kým neuložíte, vráti ho tlačidlo Späť (⌘Z).`,
    qRevertT: "Zahodiť neuložené zmeny?",
    qRevertB: "Článok sa vráti do poslednej uloženej verzie.",
    qLeaveT: "Odísť bez uloženia?",
    qLeaveB: "Máte neuložené zmeny. Ak odídete, stratia sa.",
    leave: "Odísť bez uloženia",
    // toasts
    tPublished: "Publikované — na webe do pár minút.",
    tWithdrawn: "Stiahnuté z webu — zmizne do pár minút.",
    tDeleted: "Článok zmazaný.",
    tSaved: "Uložené.",
    tSavedLive: "Uložené — web sa obnoví do pár minút.",
  },
  en: {
    heading: "Analyses", sub: "The articles at residata.eu/analyzy — publish, edit, delete.",
    published: "Published", draft: "Draft", edit: "Edit", back: "← Back to list",
    manualSteps: "manual steps",
    publish: "Publish", unpublish: "Withdraw", view: "View on the site",
    save: "Save changes", saving: "Saving…", saved: "Saved", noChanges: "No changes",
    title: "Title", perex: "Standfirst", method: "Method note", blocks: "Body",
    lead: "Opening paragraph", h2: "Section heading", p: "Paragraph", figure: "Chart",
    table: "Table", caption: "Caption", empty: "No articles yet.",
    noMatch: "No article matches the filter.",
    loading: "Loading…",
    lastEdit: "Last edited",
    undo: "Undo", redo: "Redo", revert: "Discard changes",
    steps: "steps remembered",
    emptyTitle: "The title cannot be empty — the article would have no headline.",
    emptyPerex: "The standfirst cannot be empty — it is shown in the list and in search results.",
    emptyDate: "The date is required — it orders the articles on the site.",
    liveNow: "Live on the site", draftNow: "Not on the site",
    liveHidden: "Published — but the section is hidden, so it is not on the site",
    secTitle: "The Analyses section on the site", secOn: "Shown", secOff: "Hidden",
    secOnBody: "Visitors see the Analyses link in the menu and every published article.",
    secOnEmpty: "Switched on, but it will not appear until at least one article is published.",
    secOffBody: "The site has no menu link, no /analyzy page and no article — not in the sitemap for Google either. The articles stay as they are and come back published when the section is shown.",
    secHide: "Hide the section", secShow: "Show the section",
    secChanged: "Last changed", secDelay: "The site follows within minutes — it rebuilds itself.",
    secLoadFailed: "The section setting could not be loaded.", secNotAllowed: "Only an admin can hide or show the section.",
    qHideT: "Hide the whole Analyses section?",
    qHideB: "The menu link, the /analyzy page and every article leave the site, the sitemap for Google included. Nothing is deleted — the articles stay published and come back when the section is shown. Takes effect within minutes.",
    qShowT: "Show the Analyses section?",
    qShowB: (n) => n > 0
      ? `The menu link and ${n} published articles appear on the site. Takes effect within minutes.`
      : "The section is switched on, but it appears only once an article is published.",
    tHidden: "Section hidden — gone from the site within minutes.", tShown: "Section shown — on the site within minutes.",
    date: "Article date", ogImage: "Share image (file path)",
    alt: "Image alt text (for screen readers and search)",
    newArticle: "New article", newSlug: "Article address", newSlugHint: "Lower-case letters, digits and hyphens — e.g. trh-novostavieb-2026-10. Do not change it once created; links to it would break.",
    create: "Create and open",
    slugErr: {
      empty: "Fill in the article address.",
      format: "The address may hold only lower-case letters without accents, digits and hyphens (not first or last).",
      taken: "An article with this address already exists.",
    },
    addBlock: "Add block", up: "Move up", down: "Move down", removeBlock: "Delete block",
    bAddP: "Paragraph", bAddH2: "Heading", bAddFigure: "Chart", bAddTable: "Table", bAddBullets: "Bullets",
    imgPath: "Image path (SK)", imgPathEn: "Image path (EN)",
    tableHead: "Header (columns separated by |)", tableRows: "Rows (cells by |, one row per line)",
    deleteArticle: "Delete article",
    filesNotLive: "This article cannot be published yet: these charts or the share image are not on the site. Commit them and wait for the deploy first:",
    loadFailed: "The articles could not be loaded.",
    conflict: "Someone else changed this article in the meantime. Reload it, or you will overwrite their changes.",
    reloadArticle: "Reload",
    methodTooShort: "The method note needs at least 40 characters in both languages.",
    search: "Search title, standfirst or address…",
    filters: { all: "All", published: "Published", draft: "Drafts" },
    tabEdit: "Edit", tabPreview: "Preview",
    previewNote: "This is how the article will look on the site — unsaved changes included.",
    cancel: "Cancel", close: "Close",
    qUnpublishT: "Withdraw the article?",
    qUnpublishB: "It stops being publicly available and leaves the analyses list and the sitemap. The site updates within minutes. You can publish it again later.",
    qDeleteT: "Delete the article for good?",
    qDeleteB: (title) => `"${title}" will be deleted permanently, all its text included. This cannot be undone.`,
    qDeleteLiveB: (title) => `"${title}" is on the site now. It will be withdrawn first and then deleted permanently, all its text included. This cannot be undone.`,
    qRemoveBlockT: "Delete this block?",
    qRemoveBlockB: (what) => `${what} leaves the article. Until you save, Undo (⌘Z) brings it back.`,
    qRevertT: "Discard unsaved changes?",
    qRevertB: "The article goes back to its last saved version.",
    qLeaveT: "Leave without saving?",
    qLeaveB: "You have unsaved changes. They will be lost if you leave.",
    leave: "Leave without saving",
    tPublished: "Published — on the site within minutes.",
    tWithdrawn: "Withdrawn — gone from the site within minutes.",
    tDeleted: "Article deleted.",
    tSaved: "Saved.",
    tSavedLive: "Saved — the site updates within minutes.",
  },
};

const box = {
  background: "var(--surface)", border: "1px solid var(--border-soft)",
  borderRadius: 10, padding: "1rem 1.1rem",
};

const fieldLabel = {
  fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.09em",
  textTransform: "uppercase", color: "var(--text-dim)", marginBottom: "0.45rem",
};

const DANGER_BTN = { color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 55%, transparent)" };

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
      {label ? <div style={fieldLabel}>{label}</div> : null}
      <div className="rd-form" style={{ gap: "0.55rem" }}>
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

/* ───────────────────────────── dialogs ───────────────────────────── */

/**
 * The page's questions and notices: `confirm()` resolves true/false from the
 * platform dialog, `notify()` shows a toast. Promise-shaped so a call site reads
 * like the browser's confirm it replaced: `if (!(await confirm({...}))) return;`.
 */
function useDialogs(t) {
  const [ask, setAsk] = useState(null);       // { title, body, okLabel, danger, resolve }
  const [toast, setToast] = useState(null);   // { kind: 'ok'|'err'|'warn', text }
  const timer = useRef(null);

  const confirm = useCallback((opts) => new Promise((resolve) => setAsk({ ...opts, resolve })), []);
  const notify = useCallback((kind, text) => {
    clearTimeout(timer.current);
    setToast({ kind, text });
    if (kind === "ok") timer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const answer = (yes) => { ask?.resolve(yes); setAsk(null); };

  const ui = (
    <>
      <Modal open={!!ask} onClose={() => answer(false)} title={ask?.title} width={480}
        footer={(
          <>
            <button type="button" className="rd-btn" onClick={() => answer(false)} data-autofocus>{t.cancel}</button>
            <button type="button" className={`rd-btn ${ask?.danger ? "rd-btn--warn" : "rd-btn--primary"}`}
                    style={ask?.danger ? DANGER_BTN : undefined} onClick={() => answer(true)}>
              {ask?.okLabel}
            </button>
          </>
        )}>
        <p style={{ margin: 0, color: "var(--text-2)", lineHeight: 1.6, fontSize: "0.86rem", whiteSpace: "pre-line" }}>
          {ask?.body}
        </p>
      </Modal>
      {toast && (
        <div className={`rd-toast rd-alert ${toast.kind === "ok" ? "rd-alert--ok" : toast.kind === "warn" ? "rd-alert--warn" : "rd-alert--err"}`}
             role={toast.kind === "ok" ? "status" : "alert"}>
          <span style={{ whiteSpace: "pre-line" }}>{toast.text}</span>
          <button type="button" className="rd-alert__x" onClick={() => setToast(null)} aria-label={t.close}>×</button>
        </div>
      )}
    </>
  );
  return { confirm, notify, ui };
}

/** A new article starts from its address — the one thing that must not change later.
 *  Mounted only while open, so every opening starts from a fresh form. */
function NewArticleDialog({ t, taken, onClose, onCreate }) {
  const today = new Date().toISOString().slice(0, 10);
  const [slug, setSlug] = useState(`trh-novostavieb-${today.slice(0, 7)}`);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const code = slugProblem(slug, taken);
  const problem = code ? t.slugErr[code] : null;
  async function submit(e) {
    e?.preventDefault();
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try { await onCreate({ slug: slug.trim(), date: date || today }); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={t.newArticle} width={520} dismissable={false}
      footer={(
        <>
          <button type="button" className="rd-btn" onClick={onClose}>{t.cancel}</button>
          <button type="submit" form="rd-new-article" className="rd-btn rd-btn--primary" disabled={busy || !!problem}>
            {busy ? "…" : t.create}
          </button>
        </>
      )}>
      <form id="rd-new-article" className="rd-form" onSubmit={submit}>
        <label className="rd-form__item rd-form__full">
          <span className="rd-label">{t.newSlug}<span className="rd-form__req">*</span></span>
          <input className="rd-field" value={slug} data-autofocus spellCheck={false}
                 style={{ fontFamily: MONO }}
                 onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          <span className="rd-form__hint">residata.eu/analyzy/{slug || "…"} — {t.newSlugHint}</span>
        </label>
        <label className="rd-form__item">
          <span className="rd-label">{t.date}</span>
          <input className="rd-field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {(error || (slug && problem)) && (
          <div className="rd-form__full rd-alert rd-alert--err" role="alert">{error || problem}</div>
        )}
      </form>
    </Modal>
  );
}

/* ───────────────────────────── the section switch ───────────────────────────── */

/**
 * Boss's switch for the whole /analyzy section (public.site_sections). Says what
 * is true on the site now, what the button will do, and that the site follows
 * after its rebuild — the database flips at once, the pages a few minutes later.
 */
function SectionCard({ t, section, publishedCount, dialogs }) {
  const { confirm, notify } = dialogs;
  const [busy, setBusy] = useState(false);
  const { row, loading, error } = section;

  if (loading) return <div style={{ ...box, marginBottom: "1.4rem", color: "var(--text-dim)" }}>{t.loading}</div>;
  if (error) {
    return <div className="rd-alert rd-alert--err" role="alert" style={{ marginBottom: "1.4rem" }}>⚠ {t.secLoadFailed} <span style={{ opacity: 0.7 }}>({error.message || error.code})</span></div>;
  }

  const shown = row.visible;
  async function flip() {
    const ok = await confirm(shown
      ? { title: t.qHideT, body: t.qHideB, okLabel: t.secHide, danger: true }
      : { title: t.qShowT, body: t.qShowB(publishedCount), okLabel: t.secShow });
    if (!ok) return;
    setBusy(true);
    try {
      await section.set(!shown);
      notify("ok", shown ? t.tHidden : t.tShown);
    } catch (e) {
      notify("err", e.code === "NOT_ALLOWED" ? t.secNotAllowed : e.message);
    } finally { setBusy(false); }
  }

  const empty = shown && publishedCount === 0;
  return (
    <div style={{
      ...box, marginBottom: "1.4rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap",
      borderColor: shown && !empty ? "color-mix(in srgb, var(--accent) 35%, var(--border-soft))" : "color-mix(in srgb, var(--accent-2) 45%, var(--border-soft))",
    }}>
      <div style={{ flex: "1 1 340px", minWidth: 0 }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 650, color: "var(--text)" }}>{t.secTitle}</span>
          <Pill on={shown && !empty}>{shown ? t.secOn : t.secOff}</Pill>
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--text-2)", lineHeight: 1.55 }}>
          {!shown ? t.secOffBody : empty ? t.secOnEmpty : t.secOnBody}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--text-faint)", marginTop: "0.4rem" }}>
          {row.updatedAt && `${t.secChanged} ${String(row.updatedAt).slice(0, 16).replace("T", " ")} UTC · `}{t.secDelay}
        </div>
      </div>
      <button type="button" disabled={busy}
              className={`rd-btn rd-btn--sm ${shown ? "rd-btn--warn" : "rd-btn--primary"}`}
              style={shown ? DANGER_BTN : undefined} onClick={flip}>
        {busy ? "…" : (shown ? t.secHide : t.secShow)}
      </button>
    </div>
  );
}

/* ────────────────────────────── the list ────────────────────────────── */

function ArticleList({ t, dialogs, section, onEdit }) {
  const { articles, loading, error, reload } = useArticles({ admin: true });
  const [busy, setBusy] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const { confirm, notify } = dialogs;

  const counts = useMemo(() => articleCounts(articles), [articles]);
  const shown = useMemo(
    () => articles.filter((a) => articleMatches(a, filter, query)),
    [articles, filter, query],
  );

  async function remove(a) {
    const title = a.title?.sk || a.title?.en || a.slug;
    const ok = await confirm({
      title: t.qDeleteT, body: a.published ? t.qDeleteLiveB(title) : t.qDeleteB(title),
      okLabel: t.deleteArticle, danger: true,
    });
    if (!ok) return;
    setBusy(a.id);
    try {
      // The table refuses to delete a published row (deleteArticle → PUBLISHED),
      // so an article on the site is withdrawn first — one decision, two writes.
      if (a.published) await setArticlePublished(a.id, false);
      await deleteArticle(a.id);
      await reload();
      notify("ok", t.tDeleted);
    } catch (e) { notify("err", e.message); }
    finally { setBusy(null); }
  }

  async function toggle(a) {
    if (a.published && !(await confirm({ title: t.qUnpublishT, body: t.qUnpublishB, okLabel: t.unpublish }))) return;
    setBusy(a.id);
    try {
      // A chart is a file the deploy ships, not part of the row (board 693ea7):
      // publishing before it is on the site would put a broken image in the article.
      if (!a.published) {
        const missing = await filesNotLive(a);
        if (missing.length) {
          notify("err", `${t.filesNotLive}\n${missing.map((m) => `${m.path} (${m.why})`).join("\n")}`);
          return;
        }
      }
      await setArticlePublished(a.id, !a.published);
      await reload();
      notify("ok", a.published ? t.tWithdrawn : t.tPublished);
    }
    catch (e) { notify("err", e.message); }
    finally { setBusy(null); }
  }

  async function create({ slug, date }) {
    const made = await createArticle({ slug, date });
    setCreating(false);
    await reload();
    onEdit(made);                       // straight into the editor, which is the point
  }

  if (loading) return <div style={{ color: "var(--text-dim)" }}>{t.loading}</div>;
  if (error) {
    return <div className="rd-alert rd-alert--err" role="alert">⚠ {t.loadFailed} <span style={{ opacity: 0.7 }}>({error})</span></div>;
  }

  const sectionHidden = section.row?.visible === false;
  return (
    <div>
      <SectionCard t={t} section={section} publishedCount={counts.published} dialogs={dialogs} />
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div className="rd-tabs" role="tablist" style={{ flex: "1 1 320px" }}>
          {ARTICLE_FILTERS.map((f) => (
            <button key={f} type="button" role="tab" className="rd-tab" aria-selected={filter === f}
                    onClick={() => setFilter(f)}>
              {t.filters[f]}<span className="rd-tab__n">{counts[f]}</span>
            </button>
          ))}
        </div>
        <button className="rd-btn rd-btn--sm rd-btn--primary" onClick={() => setCreating(true)}>
          + {t.newArticle}
        </button>
      </div>

      <input className="rd-field" type="search" value={query} placeholder={t.search}
             aria-label={t.search} onChange={(e) => setQuery(e.target.value)}
             style={{ width: "100%", marginBottom: "1rem" }} />

      <div style={{ display: "grid", gap: "0.7rem" }}>
        {!articles.length && <div style={{ color: "var(--text-dim)" }}>{t.empty}</div>}
        {articles.length > 0 && !shown.length && <div style={{ color: "var(--text-dim)" }}>{t.noMatch}</div>}
        {shown.map((a) => (
          <div key={a.id} style={{ ...box, display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0 }}>
              <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginBottom: "0.4rem", flexWrap: "wrap" }}>
                <Pill on={a.published}>{a.published ? t.published : t.draft}</Pill>
                {/* The steps no system can take (lib/articleSeo MANUAL_STEPS) —
                    counted here so an article is not left half-promoted. */}
                {a.published && openManualSteps(a) > 0 && (
                  <span style={{
                    fontSize: "0.66rem", padding: "0.12rem 0.45rem", borderRadius: 999,
                    border: "1px solid color-mix(in srgb, var(--warning) 50%, transparent)", color: "var(--warning)",
                  }}>{openManualSteps(a)} {t.manualSteps}</span>
                )}
                <span style={{ fontFamily: MONO, fontSize: "0.7rem", color: "var(--text-faint)" }}>{a.date}</span>
              </div>
              <button type="button" onClick={() => onEdit(a.slug)} style={{
                all: "unset", cursor: "pointer", display: "block",
                fontWeight: 600, color: "var(--text)", marginBottom: "0.3rem",
              }}>
                {a.title?.sk || a.title?.en || a.slug}
              </button>
              <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", lineHeight: 1.55 }}>
                {(a.perex?.sk || a.perex?.en || "").slice(0, 180)}
              </div>
              <div style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--text-faint)", marginTop: "0.5rem" }}>
                /analyzy/{a.slug}
                {a.updatedAt && ` · ${t.lastEdit} ${String(a.updatedAt).slice(0, 16).replace("T", " ")}`}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", flexShrink: 0, minWidth: 150 }}>
              <button className="rd-btn rd-btn--sm" onClick={() => onEdit(a.slug)}>{t.edit}</button>
              <button className={"rd-btn rd-btn--sm" + (a.published ? "" : " rd-btn--primary")}
                      disabled={busy === a.id} onClick={() => toggle(a)}>
                {busy === a.id ? "…" : (a.published ? t.unpublish : t.publish)}
              </button>
              {a.published && !sectionHidden && (
                <a className="rd-btn rd-btn--sm rd-btn--ghost" href={`${SITE_BASE}/analyzy/${a.slug}`}
                   target="_blank" rel="noreferrer">{t.view} ↗</a>
              )}
              <button className="rd-btn rd-btn--sm rd-btn--ghost" disabled={busy === a.id}
                      style={{ color: "var(--danger)" }} onClick={() => remove(a)}>{t.deleteArticle}</button>
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <NewArticleDialog t={t} taken={articles.map((a) => a.slug)}
                          onClose={() => setCreating(false)} onCreate={create} />
      )}
    </div>
  );
}

/* ───────────────────────────── the preview ───────────────────────────── */

/**
 * The draft drawn by the public page's own component, in the public page's own
 * (dark) colours whatever theme the admin uses — `.rd-article-preview` in
 * styles/ui.css pins the tokens and takes off the site's fixed-header padding.
 * Unsaved edits included: that is what a preview is for.
 */
function ArticlePreview({ draft, published, t }) {
  const [lang, setLang] = useState("sk");
  const article = useMemo(
    () => ({ ...draft, published, blocks: stripKeys(draft.blocks) }),
    [draft, published],
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "0.8rem", flexWrap: "wrap" }}>
        <div className="rd-seg" role="group" aria-label="Language">
          {["sk", "en"].map((lc) => (
            <button key={lc} type="button" className="rd-seg__btn" aria-pressed={lang === lc}
                    onClick={() => setLang(lc)}>{lc.toUpperCase()}</button>
          ))}
        </div>
        <span style={{ fontSize: "0.76rem", color: "var(--text-dim)" }}>{t.previewNote}</span>
      </div>
      <div className="rd-article-preview">
        <ArticleView article={article} related={[]} navigate={() => {}} lang={lang} />
      </div>
    </div>
  );
}

/* ───────────────────────────── the editor ───────────────────────────── */

function ArticleEditor({ slug, t, dialogs, sectionHidden, onBack, onChanged }) {
  const { article, loading } = useArticle(slug, { admin: true });
  const { confirm, notify } = dialogs;
  const [saved, setSaved] = useState(null);      // last state known to be in the DB
  const [state, setState] = useState("idle");    // idle | saving
  const [err, setErr] = useState(null);
  const [busyPub, setBusyPub] = useState(false);
  const [view, setView] = useState("edit");      // edit | preview
  // `published` is a live fact about the row, not editable content, so it is NOT
  // in the history stack: undo after publishing would otherwise show KONCEPT
  // while the database said published.
  const [published, setPublished] = useState(false);
  const [version, setVersion] = useState(null);   // updated_at we based this edit on
  // Saved on each tick and not an edit (the database keeps updated_at), so it
  // lives outside the undo history and never makes the draft "unsaved".
  const [checklist, setChecklist] = useState({});
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
    setChecklist(article.promoChecklist || {});
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
    // article_date is NOT NULL and it orders the public index, so an empty date
    // is a failed save with an unreadable Postgres error rather than a warning.
    if (!draft.date) out.push(t.emptyDate);
    return out;
  }, [draft, t]);

  const save = useCallback(async () => {
    if (!dirty || state === "saving") return;
    if (problems.length) { setErr(problems[0]); return; }
    setState("saving"); setErr(null); setConflict(false);
    try {
      const next = await saveArticle(
        draft.id, { ...draft, blocks: stripKeys(draft.blocks) }, { expectUpdatedAt: version });
      setSaved(JSON.parse(JSON.stringify(draft)));
      setVersion(next);
      onChanged?.();
      notify("ok", published ? t.tSavedLive : t.tSaved);
    } catch (e) {
      if (e.code === "CONFLICT") { setConflict(true); setErr(t.conflict); }
      else setErr(e.message);
    } finally { setState("idle"); }
  }, [dirty, state, problems, draft, version, onChanged, notify, published, t]);

  // ⌘Z / ⇧⌘Z anywhere in the editor, including inside a textarea — the browser's
  // own undo only covers the focused field, not a block you deleted. ⌘S saves.
  // Not while a dialog is open: its keys are its own.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || document.querySelector(".rd-modal")) return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); save(); return; }
      if (k !== "z") return;
      e.preventDefault();
      if (e.shiftKey) hist.redo(); else hist.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hist, save]);

  // Losing an edit to a stray click is the one unrecoverable thing here.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function leave() {
    if (dirty && !(await confirm({ title: t.qLeaveT, body: t.qLeaveB, okLabel: t.leave, danger: true }))) return;
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

  async function removeBlock(i) {
    const what = blockLabel(draft.blocks[i]);
    if (!(await confirm({ title: t.qRemoveBlockT, body: t.qRemoveBlockB(what), okLabel: t.removeBlock, danger: true }))) return;
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

  async function revert() {
    if (!(await confirm({ title: t.qRevertT, body: t.qRevertB, okLabel: t.revert, danger: true }))) return;
    hist.reset(JSON.parse(JSON.stringify(saved)));
  }

  /** Publish / withdraw from inside the editor — not only from the list. */
  async function togglePublished() {
    const next = !published;
    if (!next && !(await confirm({ title: t.qUnpublishT, body: t.qUnpublishB, okLabel: t.unpublish }))) return;
    setBusyPub(true); setErr(null);
    try {
      // Same refusal as the list's button: the charts must already be on the site.
      if (next) {
        const missing = await filesNotLive(draft);
        if (missing.length) { setErr(`${t.filesNotLive} ${missing.map((m) => m.path).join(", ")}`); return; }
      }
      const stamp = await setArticlePublished(draft.id, next);
      setPublished(next);
      if (stamp) setVersion(stamp);
      onChanged?.();
      notify("ok", next ? t.tPublished : t.tWithdrawn);
    } catch (e) { setErr(e.message); }
    finally { setBusyPub(false); }
  }

  async function removeArticle() {
    const title = saved?.title?.sk || saved?.title?.en || draft.slug;
    const ok = await confirm({
      title: t.qDeleteT, body: published ? t.qDeleteLiveB(title) : t.qDeleteB(title),
      okLabel: t.deleteArticle, danger: true,
    });
    if (!ok) return;
    setBusyPub(true); setErr(null);
    try {
      if (published) await setArticlePublished(draft.id, false);
      await deleteArticle(draft.id);
      onChanged?.();
      notify("ok", t.tDeleted);
      onBack();
    } catch (e) { setErr(e.message); setBusyPub(false); }
  }

  function blockLabel(b) {
    return ({ lead: t.lead, h2: t.h2, p: t.p, figure: t.figure, table: t.table, bullets: t.bAddBullets }[b?.type] || b?.type);
  }

  if (loading || !draft) return <div style={{ color: "var(--text-dim)" }}>{t.loading}</div>;

  return (
    <div>
      <div style={{
        position: "sticky", top: 0, zIndex: 5, background: "var(--bg)",
        paddingBottom: "0.8rem", marginBottom: "1.2rem",
        borderBottom: "1px solid var(--border-soft)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <button className="rd-btn rd-btn--sm rd-btn--ghost" onClick={leave}>{t.back}</button>

          {/* Publish state and its control together — the badge says what is true,
              the button next to it is what changes it. */}
          <Pill on={published}>{published ? t.published : t.draft}</Pill>
          <button className={"rd-btn rd-btn--sm" + (published ? "" : " rd-btn--primary")}
                  disabled={busyPub} onClick={togglePublished}>
            {busyPub ? "…" : (published ? t.unpublish : t.publish)}
          </button>
          {published && !sectionHidden && (
            <a className="rd-btn rd-btn--sm rd-btn--ghost"
               href={`${SITE_BASE}/analyzy/${draft.slug}`} target="_blank" rel="noreferrer">
              {t.view} ↗
            </a>
          )}

          <span style={{ width: 1, height: 20, background: "var(--border-soft)", margin: "0 0.2rem" }} />

          {/* Undo / redo. The browser's own undo only covers the focused field,
              so a deleted block or a cleared title had no way back. */}
          <button className="rd-btn rd-btn--sm rd-btn--ghost" onClick={hist.undo}
                  disabled={!hist.canUndo} title="⌘Z">↶ {t.undo}</button>
          <button className="rd-btn rd-btn--sm rd-btn--ghost" onClick={hist.redo}
                  disabled={!hist.canRedo} title="⇧⌘Z">↷ {t.redo}</button>
          <button className="rd-btn rd-btn--sm rd-btn--ghost" disabled={!dirty} onClick={revert}>
            {t.revert}
          </button>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--text-faint)" }}>
            {hist.depth}/{HISTORY_LIMIT} {t.steps}
          </span>

          <div style={{ flex: 1 }} />
          <button className="rd-btn rd-btn--sm rd-btn--primary" title="⌘S"
                  disabled={!dirty || state === "saving" || problems.length > 0}
                  onClick={save}>
            {state === "saving" ? t.saving : (dirty ? t.save : t.noChanges)}
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.7rem", alignItems: "center", marginTop: "0.6rem", flexWrap: "wrap" }}>
          <div className="rd-tabs" role="tablist" style={{ borderBottom: "none" }}>
            {[["edit", t.tabEdit], ["preview", t.tabPreview]].map(([k, label]) => (
              <button key={k} type="button" role="tab" className="rd-tab" aria-selected={view === k}
                      onClick={() => setView(k)}>{label}</button>
            ))}
          </div>
          <span style={{ fontFamily: MONO, fontSize: "0.68rem", color: "var(--text-faint)" }}>
            /analyzy/{draft.slug}
          </span>
          <span style={{ fontSize: "0.72rem", color: published ? (sectionHidden ? "var(--accent-2)" : "var(--accent)") : "var(--text-faint)" }}>
            {published ? (sectionHidden ? "◐ " + t.liveHidden : "● " + t.liveNow) : "○ " + t.draftNow}
          </span>
        </div>

        {/* A required field left blank is how the title was lost the first time:
            cleared, saved, and the public page had no headline. Save stays off
            until it is filled. */}
        {problems.map((msg) => (
          <div key={msg} className="rd-alert rd-alert--err" role="alert" style={{ marginTop: "0.6rem" }}>⚠ {msg}</div>
        ))}
        {err && (
          <div className="rd-alert rd-alert--err" role="alert" style={{ marginTop: "0.6rem", alignItems: "center" }}>
            <span style={{ flex: 1 }}>{err}</span>
            {conflict && (
              <button className="rd-btn rd-btn--sm" onClick={() => window.location.reload()}>
                {t.reloadArticle}
              </button>
            )}
          </div>
        )}
      </div>

      {view === "preview" ? <ArticlePreview draft={draft} published={published} t={t} /> : (
        <>
          <div className="rd-form" style={{ gap: "0.55rem", marginBottom: "1.1rem" }}>
            <div>
              <div style={fieldLabel}>{t.date}</div>
              <input type="date" value={draft.date || ""}
                     onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                     style={{
                       width: "100%", background: "var(--bg)", color: "var(--text)",
                       border: "1px solid var(--border-soft)", borderRadius: 7,
                       padding: "0.6rem 0.7rem", fontSize: "0.88rem", fontFamily: MONO,
                     }} />
            </div>
            <div>
              <div style={fieldLabel}>{t.ogImage}</div>
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

          <div style={{ ...fieldLabel, margin: "2rem 0 0.8rem", paddingTop: "1rem", borderTop: "1px solid var(--border-soft)" }}>
            {t.blocks} · {draft.blocks.length}
          </div>

          {draft.blocks.map((b, i) => (
            <div key={b._k || i} style={{ ...box, marginBottom: "0.9rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.6rem" }}>
                <div style={{
                  fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.09em",
                  textTransform: "uppercase", color: "var(--text-faint)", flex: 1,
                }}>
                  {i + 1}. {blockLabel(b)}
                </div>
                <button className="rd-btn rd-btn--sm rd-btn--ghost" title={t.up} aria-label={t.up}
                        disabled={i === 0} onClick={() => moveBlock(i, -1)}>↑</button>
                <button className="rd-btn rd-btn--sm rd-btn--ghost" title={t.down} aria-label={t.down}
                        disabled={i === draft.blocks.length - 1} onClick={() => moveBlock(i, 1)}>↓</button>
                <button className="rd-btn rd-btn--sm rd-btn--ghost" title={t.removeBlock}
                        style={{ color: "var(--danger)" }} onClick={() => removeBlock(i)}>✕ {t.removeBlock}</button>
              </div>

              {(b.type === "lead" || b.type === "p" || b.type === "h2") && (
                <BiField label="" rows={b.type === "h2" ? 1 : 5} value={b.text}
                         onChange={(v) => setBlock(i, { text: v })} />
              )}

              {b.type === "bullets" && (
                <>
                  {(b.items || []).map((it, k) => (
                    <div key={k} style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <BiField label={`• ${k + 1}`} rows={2} value={it}
                                 onChange={(v) => setBlock(i, {
                                   items: (b.items || []).map((x, y) => (y === k ? v : x)),
                                 })} />
                      </div>
                      <button className="rd-btn rd-btn--sm rd-btn--ghost" title={t.removeBlock} aria-label={t.removeBlock}
                              style={{ marginTop: "1.4rem" }}
                              onClick={() => setBlock(i, { items: (b.items || []).filter((_, y) => y !== k) })}>✕</button>
                    </div>
                  ))}
                  <button className="rd-btn rd-btn--sm rd-btn--ghost"
                          onClick={() => setBlock(i, { items: [...(b.items || []), { sk: "", en: "" }] })}>
                    + {t.bAddBullets}
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
                    <div className="rd-form" style={{ gap: "0.55rem", marginBottom: "1.1rem" }}>
                      {[["src", t.imgPath], ["srcEn", t.imgPathEn]].map(([field, label]) => (
                        <div key={field}>
                          <div style={{ fontSize: "0.65rem", color: "var(--text-faint)", marginBottom: "0.25rem" }}>
                            {label}
                          </div>
                          <input value={b[field] || ""} placeholder="/analyzy/…svg"
                                 onChange={(e) => setBlock(i, field === "src"
                                   // A new chart: what the generator recorded about the
                                   // OLD one (its phone drawing, its sizes) no longer
                                   // applies — keeping srcM would show phones a different chart.
                                   ? { src: e.target.value, srcM: undefined, w: undefined, h: undefined, wM: undefined, hM: undefined }
                                   : { [field]: e.target.value })}
                                 style={{
                                   width: "100%", background: "var(--bg)", color: "var(--text)",
                                   border: "1px solid var(--border-soft)", borderRadius: 7,
                                   padding: "0.55rem 0.7rem", fontSize: "0.82rem", fontFamily: MONO,
                                 }} />
                        </div>
                      ))}
                    </div>
                  )}
                  {b.type === "table" && (
                    <>
                      {/* A table's contents had no editor at all, so "+ Tabuľka"
                          could only ever produce an empty table. Pipes and newlines
                          keep it typeable without a grid widget. */}
                      <BiField label={t.tableHead} rows={1}
                               value={{ sk: (b.head?.sk || []).join(" | "), en: (b.head?.en || []).join(" | ") }}
                               onChange={(v) => setBlock(i, {
                                 head: { sk: splitCells(v.sk), en: splitCells(v.en) },
                               })} />
                      <div style={{ marginBottom: "1.1rem" }}>
                        <div style={fieldLabel}>{t.tableRows}</div>
                        {/* A cell may be a {sk, en} pair — the decimal mark differs
                            by language, so a generated table carries both. Render the
                            Slovak side here; editing a generated table by hand would
                            flatten it, which is why tables come from the generator. */}
                        <textarea rows={5} value={(b.rows || []).map(
                          (r) => r.map((c) => (c && typeof c === "object" ? (c.sk ?? "") : c)).join(" | ")
                        ).join("\n")}
                                  onChange={(e) => setBlock(i, {
                                    rows: e.target.value.split("\n").filter((l) => l.trim()).map(splitCells),
                                  })}
                                  style={{
                                    width: "100%", background: "var(--bg)", color: "var(--text)",
                                    border: "1px solid var(--border-soft)", borderRadius: 7,
                                    padding: "0.6rem 0.7rem", fontSize: "0.85rem", fontFamily: MONO,
                                    lineHeight: 1.6, resize: "vertical",
                                  }} />
                      </div>
                    </>
                  )}
                  <BiField label={t.caption} rows={2} value={b.caption}
                           onChange={(v) => setBlock(i, { caption: v })} />
                  {b.type === "figure" && (
                    <BiField label={t.alt} rows={1} value={b.alt}
                             onChange={(v) => setBlock(i, { alt: v })} />
                  )}
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

          {/* What Google and LinkedIn will show, whether the live page has caught
              up with the last save, and the steps that stay manual. */}
          <ArticleSeoPanel
            draft={{ ...draft, promoChecklist: checklist }}
            published={published}
            updatedAt={version}
            onSeoTitle={(v) => setDraft((d) => ({ ...d, seoTitle: v }))}
            onChecklist={setChecklist}
          />

          <div style={{ marginTop: "2.4rem", paddingTop: "1rem", borderTop: "1px solid var(--border-soft)" }}>
            <button className="rd-btn rd-btn--sm rd-btn--warn" style={DANGER_BTN} disabled={busyPub}
                    onClick={removeArticle}>{t.deleteArticle}</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── the page ───────────────────────────── */

export default function ArticlesAdmin({ lang = "sk" }) {
  const t = LABEL[lang === "en" ? "en" : "sk"];
  const [editing, setEditing] = useState(null);
  // Bumped whenever the editor publishes, saves or deletes, so returning to the
  // list shows the change rather than a cached row.
  const [rev, setRev] = useState(0);
  const dialogs = useDialogs(t);
  const section = useSiteSection("analyzy");

  return (
    <div style={{ padding: "1.5rem 1.75rem 4rem", maxWidth: 1000 }}>
      <div style={{
        fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.1em",
        textTransform: "uppercase", color: "var(--accent)", marginBottom: "0.4rem",
      }}>Residata</div>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0 0 0.3rem", color: "var(--text)" }}>
        {t.heading}
      </h1>
      <p style={{ color: "var(--text-dim)", fontSize: "0.86rem", margin: "0 0 1.6rem" }}>{t.sub}</p>

      {editing
        ? <ArticleEditor slug={editing} t={t} dialogs={dialogs} sectionHidden={section.row?.visible === false}
                         onBack={() => setEditing(null)}
                         onChanged={() => setRev((r) => r + 1)} />
        : <ArticleList key={rev} t={t} dialogs={dialogs} section={section} onEdit={setEditing} />}

      {dialogs.ui}
    </div>
  );
}
