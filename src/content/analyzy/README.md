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
   cd ~/novostavby && source .env
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

2. **Create the article** in `/app/articles` → *Nový článok*. It opens empty and
   every field is editable.

3. **Write the text**, quoting figures from `data/report-<slug>.json`. Reference
   the generated charts by path — for a `figure` block that is
   `/analyzy/<slug>-<n>-<name>.svg` and `-en.svg` for the English one.

4. **Publish** from the editor. It appears on `/analyzy`, in the sitemap on the
   next deploy, and can be withdrawn again with one click.

## Why the numbers are generated and the prose is not

The analysis and the writing are the work; retyping figures is how the text, the
charts and the database drift apart. The generator produces every number once,
self-checks it, and refuses to emit a figure it cannot stand behind.
