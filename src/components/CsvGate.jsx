import { useCapabilities } from "../lib/useCapabilities";
import { track } from "../lib/track";

/**
 * Taking data OUT of Residata (a CSV download, "copy for Excel") is for paying
 * customers and admins only — useCapabilities "export_data", the same rule as the
 * Exports page. The 7-day trial may browse everything but takes nothing home.
 *
 * Wrap EVERY such control in this. On 2026-10-06 the lock went onto the three CSV
 * buttons in Reports while the unit database, Sales, the Pivot (CSV, drill-down,
 * copy-table), the unit timeline and the map's competitive set kept handing a trial
 * user the files; src/lib/csvGate.test.mjs now fails on any download in src/ that is
 * not behind this gate or an explicit export_data check.
 *
 * It also RECORDS each use (2026-10-07): admin → a person's activity shows what they
 * took home, from where. Before, only the Exports page and the unit timeline said so,
 * and a customer living in the Pivot looked like a customer who never exports.
 * `what` names the data (the test requires it); `kind="copy"` for a clipboard copy;
 * `selfTracked` where the page already records the download with its row count.
 *
 *   <CsvGate lang={lang} what="units"><button onClick={exportCsv}>⬇ CSV</button></CsvGate>
 *   <CsvGate lang={lang} what="pivot_table" kind="copy" label="Kopírovať"> … </CsvGate>
 */
export default function CsvGate({ lang, label = "CSV", what, kind = "csv", selfTracked = false, children }) {
  const { can } = useCapabilities();
  if (can("export_data")) {
    if (selfTracked) return children;
    // A click on a disabled button never reaches here, so a refused click is not counted.
    const record = () => { track(kind === "copy" ? "data_copied" : "csv_exported", { type: what || "unknown" }); };
    return <span style={{ display: "contents" }} onClickCapture={record}>{children}</span>;
  }
  return (
    <button type="button" disabled
      title={lang === "sk"
        ? "Sťahovanie a kopírovanie dát je pre platiacich (Premium) — počas trialu sa dá všetko prezerať."
        : "Downloading and copying data is for paying subscribers (Premium) — during the trial you can browse everything."}
      style={{ background: "transparent", color: "var(--text-faint)", border: "1px dashed var(--border)", borderRadius: 4,
        padding: "0.3rem 0.6rem", fontSize: "0.72rem", fontFamily: "inherit", cursor: "not-allowed", whiteSpace: "nowrap" }}>
      🔒 {label} · Premium
    </button>
  );
}
