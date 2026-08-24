/**
 * tableClipboard — turn a table of values into something a spreadsheet reads
 * correctly, whether it arrives by download or by Ctrl+V.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pivot's CSV export wrote `1234.56` separated by commas. On a Slovak
 * Windows the list separator is `;` and the decimal separator is `,` — so
 * Excel-SK dropped the whole file into column A and read every decimal as
 * text. The numbers were right; the file was unreadable. Copy & paste had no
 * path at all: selecting the rendered table copies the on-screen strings
 * ("1 200 €", "57.3%"), which Excel stores as text.
 *
 * So: ONE place decides how a value becomes a spreadsheet cell, and both the
 * download and the clipboard go through it. They cannot drift.
 *
 * THE CELL UNION — what a caller puts in the matrix
 * -------------------------------------------------
 *   number              → a number. Written with the locale's decimal mark and
 *                         NO thousands separator (a space or a comma inside a
 *                         number is what breaks the paste).
 *   { v, pct: true }    → a percentage. `v` is in percent units (57.3, not
 *                         0.573); emitted as "57,3 %", which Excel parses back
 *                         into a real percentage.
 *   string              → text. Pinned as text so "01-02" and "2026-05" stay
 *                         themselves instead of becoming dates.
 *   null / undefined    → an empty cell.
 *
 * FORMULA INJECTION
 * -----------------
 * A cell that starts with = + - @ is executed by Excel on open. Project and
 * developer names come from scraped pages, so they are not ours to trust:
 * every text cell gets a leading apostrophe when it starts with one of those.
 * (Same rule as src/lib/sanitize.js, applied at the spreadsheet boundary.)
 */

/** Slovak and Czech spreadsheets use `,` for decimals and therefore `;` between
 *  fields. English ones use `.` and `,`. Nothing else in the app needs to know. */
export function exportFormats(lang) {
  const commaDecimal = lang === "sk" || lang === "cs";
  return { decimal: commaDecimal ? "," : ".", delimiter: commaDecimal ? ";" : "," };
}

/** A number as a spreadsheet reads it: no thousands separator, locale decimal
 *  mark, at most `maxDecimals` places, and never "1.0" where "1" will do. */
export function formatExportNumber(n, lang, maxDecimals = 2) {
  if (n == null || !Number.isFinite(n)) return "";
  // toFixed then back through Number drops the trailing zeros, so 1200.00 → "1200".
  const s = String(Number(n.toFixed(maxDecimals)));
  return exportFormats(lang).decimal === "," ? s.replace(".", ",") : s;
}

/** Excel executes a cell that opens with = + - @. Neutralise it, keep it readable. */
export function guardFormula(text) {
  const s = String(text);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** One cell → the string a spreadsheet should see. Shared by every serializer
 *  below, which is the whole point: TSV, CSV and HTML can never disagree. */
function cellText(cell, lang) {
  if (cell == null || cell === "") return "";
  if (typeof cell === "number") return formatExportNumber(cell, lang);
  if (typeof cell === "object" && cell.pct) {
    const v = formatExportNumber(cell.v, lang, 1);
    return v === "" ? "" : v + " %";
  }
  return guardFormula(cell);
}

/** True when this cell is meant to be a number (or a percentage) rather than text. */
function isNumeric(cell) {
  return typeof cell === "number" || (cell != null && typeof cell === "object" && cell.pct);
}

/* ─── serializers ──────────────────────────────────────────────────────── */

/** Tab-separated — the format every spreadsheet splits into columns on paste.
 *  Tabs need no quoting rules because a cell can never contain one (guardFormula
 *  catches a leading tab; interior tabs are stripped here). */
export function toTSV(matrix, lang) {
  return matrix
    .map((row) => row.map((c) => cellText(c, lang).replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\r\n");
}

/** Delimiter-separated for the .csv download, using the locale's list separator
 *  so Excel splits it into columns instead of dumping it into column A. */
export function toCSV(matrix, lang) {
  const { delimiter } = exportFormats(lang);
  const needsQuotes = (s) => s.includes(delimiter) || s.includes('"') || /[\n\r]/.test(s);
  const esc = (s) => (needsQuotes(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return matrix.map((row) => row.map((c) => esc(cellText(c, lang))).join(delimiter)).join("\r\n");
}

const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => HTML_ESC[ch]);

/**
 * A real HTML table — the clipboard flavour Excel, Numbers, Google Sheets and
 * Word all prefer over plain text. It gives them cells directly, so nothing
 * depends on the receiving app guessing where the columns are.
 *
 * `mso-number-format:'\@'` pins a text cell as text. Without it Excel helpfully
 * turns a unit id like "01-02" into the 2nd of January.
 */
export function toHTMLTable(matrix, lang, { headerRows = 1 } = {}) {
  const body = matrix
    .map((row, r) => {
      const tag = r < headerRows ? "th" : "td";
      const cells = row
        .map((c) => {
          const text = escHtml(cellText(c, lang));
          const style = isNumeric(c)
            ? "text-align:right"
            : "mso-number-format:'\\@';text-align:left";
          return `<${tag} style="${style}">${text}</${tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<meta charset="utf-8"><table>${body}</table>`;
}

/* ─── the clipboard itself ─────────────────────────────────────────────── */

/**
 * Put the table on the clipboard in BOTH flavours: the HTML table (what a
 * spreadsheet reaches for first, giving real cells) and the TSV (what a plain
 * editor gets, and the fallback for anything that ignores HTML).
 *
 * Returns true when something reached the clipboard. Never throws — a copy
 * button that explodes is worse than one that reports it did nothing.
 */
export async function copyTable(matrix, { lang = "en", headerRows = 1 } = {}) {
  const tsv = toTSV(matrix, lang);
  const html = toHTMLTable(matrix, lang, { headerRows });

  if (typeof navigator !== "undefined" && navigator.clipboard && typeof window !== "undefined" && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new window.ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([tsv], { type: "text/plain" }),
        }),
      ]);
      return true;
    } catch { /* Safari/permissions — fall through to the text-only path */ }
  }
  try {
    await navigator.clipboard.writeText(tsv);
    return true;
  } catch { /* fall through to the pre-async-clipboard path */ }

  // Last resort for older WebKit: a selected off-screen textarea + execCommand.
  try {
    const ta = document.createElement("textarea");
    ta.value = tsv;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
