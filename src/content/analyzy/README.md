# Authoring an analysis

**Nothing in this folder is imported by the app.** The live site reads
`public.articles`; the admin screen at `/app/articles` edits it. This folder is
the workspace where an issue's *numbers* are produced before its text is written.

Two files used to live here — a JS module per issue and a registry — and both
were orphaned the moment content moved into the database. They were deleted
rather than left looking load-bearing. `format.js` moved to
`src/lib/articleFormat.js`, because the live article page imports it and code
that runs on every visit should not sit in a folder that says it does not run.

## How a new issue is made

1. **Generate the figures** (in the scraper repo):

   ```
   cd ~/novostavby && source .env && unset SUPABASE_DB_URL SUPABASE_DB_PASSWORD
   python3 -m v2.scripts.market_report --slug <slug-of-this-issue>
   ```

   It writes `data/report-<slug>.json` here and the charts into `public/analyzy/`,
   and refuses to write anything if the numbers do not hold up.

   🔴 **Pass `--slug` whenever the month already has an issue.** Everything the
   generator writes is named after the slug — the JSON, the charts and the
   `og-<slug>.png` share card — because the default slug is
   `trh-novostavieb-YYYY-MM` and a second issue in the same month used to
   regenerate the first one's files underneath it. On 21 September that
   overwrote the live 8 September article's three charts and its share card
   with a different issue's figures.

   It will also **withhold every sales-derived figure** — months-to-clear, the
   sold/supply mix, the price quartiles, the price signal — whenever
   `analytics.sale_events` and `reference.unit_ledger` disagree about how many
   flats were sold. That is not a warning to write around: those keys are simply
   absent from the JSON, `salesWithheld` says why, and an issue generated on such
   a day has to be built from stock and price alone.

2. **Write the prose into a template**, one per language, beside this file:
   `drafts/<slug>.sk.md.tmpl` and `drafts/<slug>.en.md.tmpl`. Slovak is the
   source language; the English one is produced from it.

   🔴 **Never type a figure.** Every number is a `{placeholder}` that
   `drafts/render.py` fills from the report JSON — and it REFUSES to render a
   template containing a bare number at all, so this is enforced rather than
   asked for. That includes words that are figures in disguise: a direction
   ("rose", "klesla"), a superlative ("the cheapest layout") and a fraction
   ("under a tenth") each has to be computed beside the number it describes, or
   it will one day contradict it. One of them, "necelá desatina predaja", was
   published while it was false.

3. **Render, then build the row:**

   ```
   python3 src/content/analyzy/drafts/render.py <slug>
   python3 src/content/analyzy/drafts/to_cms.py <slug> > /tmp/row.json
   ```

   `render.py` writes the two `.md` files and refuses on a typed number or a
   placeholder the report cannot fill. `to_cms.py` turns the pair into the row
   `public.articles` expects — it prints JSON and writes nothing itself.

4. **Publish.** For a NEW issue, paste the row in `/app/articles` → *Nový
   článok*. For an issue that already exists, UPDATE the existing row keyed on
   slug — never insert, or the site grows a duplicate — and do not carry the
   `published` field from the row file: `to_cms.py` emits `published: false`, so
   applying it wholesale takes the live article off the site.

5. **Verify against the live row, not the draft on disk.** Read
   `public.articles` back, check the figures, and open the page.


## The Bratislava quarterly overview

`ba-prehlad-<year>-q<n>` is the reference issue: supply and sales by okres and
by layout, prices by okres against the previous quarter, and the price per
metre since the first quarter anyone published. It reproduces the shape the
incumbent houses use, so it is a DATA article — a table someone looks things up
in, with interpretation only where it is mechanical.

Since 2026-09-27 it is a **literal copy of the Herrys Q1 2025 report** — Boss's
instruction, verbatim: *"totalna kopia, len zmen cisla"* — five figures, three
tables and five text blocks in their order (Úvod · Ponuka · Dopyt · Cena ·
Výhľad). The source PDF is in the scraper repo at
`v2/docs/research/market_content/corpus/herrys-q1-2025-report.pdf`.

Its panels come from `v2/lib/ba_overview.py` and its five charts from
`v2/lib/charts_ba_overview.py::draw_all`, both called by `market_report.py`, so
re-running the issue redraws the figures. A page carrying this quarter's prose
over last quarter's charts is what that avoids.

Four things that module gets right only because they were wrong first, all in
its docstring: a day is not a snapshot (thirteen days hold more than one); our
own supply count is not the market's, because it moves when WE onboard a
project; a district is read from `reference.projects` and not from the
denormalised copy in `analytics.unit_facts`; and Rovinka is not Bratislava.

History before our own measurements begins lives in
`v2/lib/published_market_history.py`, with each series named for the house that
published it. It is never spliced onto ours — their "sold" is not our "sold"
(Herrys count reserved flats as sold and say so), and a gap in the public
record is drawn as a gap rather than interpolated.

## The same issue for every other geography

Slovakia, its largest towns and its eight kraje get the Bratislava issue with
the numbers changed — Boss, 2026-09-22: *"vsetko templates rovnake iba budeme
aktualizovat a menit cisla"*. One command builds one issue:

```
python3 -m v2.scripts.issue_report --scope sk --slug sk-prehlad-2026-q3 --as-of 2026-09-27
python3 -m v2.scripts.issue_report --scope "city:Košice" --slug ke-prehlad-2026-q3 --as-of 2026-09-27
python3 -m v2.scripts.issue_report --scope kraj:sk-kosicky --slug kraj-ke-prehlad-2026-q3 --as-of 2026-09-27
```

It measures the panels with `v2/lib/issue_overview.py`, draws the five figures on
both frames with `charts_ba_overview.draw_issue`, lints them, writes the share
card, and writes `drafts/<slug>.sk.md.tmpl` from **`drafts/_prehlad.master.sk.md.tmpl`**
— the Bratislava skeleton with the scope's words (`__SCOPE_IN__`, `__SUB_BY_PL__` …)
substituted. Then render → to_cms → the row, as for any issue. A geography under
five projects or ten sales in the quarter gets no issue; it is left out and
named, never padded.

What changes from Bratislava, and why:

- **The rows of the three tables.** Slovakia breaks into kraje, a kraj into its
  towns, a town into flat sizes — outside Bratislava the price lists do not name
  the mestská časť. The sentences that name a row are built whole per breakdown
  (`issue_report.SUBUNIT_WORDS`), because Slovak declines the name.
- **Figures 2 and 4 use our own history.** Nobody publishes one for these places.
  Demand is drawn by month and the price as a weekly **change** on the same flats.
- 🔴 **Every monthly figure is same-panel**: only projects we were already
  watching on the quarter's first day. Counted over all projects, Košice showed
  demand jumping to 89 in September and asking prices falling 5 % — both were
  new projects entering our coverage. The asking-vs-sold sentence uses the same
  panel, so it and its chart agree.
- A price row resting on fewer than ten comparable flats is left out of the
  table, and the table says so.

## Re-publishing an issue whose quarter has closed

An issue previewed before its period ended carries a projected figure and must
be regenerated once the period closes. The chain and the traps are in the
`market_report.py` module docstring, under **"RE-PUBLISHING AN ISSUE WHOSE
QUARTER HAS CLOSED"** — read it there rather than here, because that is the file
you are already running, and because the nightly
`integrity_check.article_figures_are_measured` will tell you it is owed.

## Why the numbers are generated and the prose is not

The analysis and the writing are the work; retyping figures is how the text, the
charts and the database drift apart. The generator produces every number once,
self-checks it, and refuses to emit a figure it cannot stand behind.
