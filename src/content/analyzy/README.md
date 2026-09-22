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
