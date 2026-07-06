// Regression test for the .xlsx export cell logic in Platform.jsx
// (parseCsvRows + xlsxCell). Pure — no file I/O. Run: node scripts/verify-xlsx-export.mjs
// Keep in sync with the helpers in src/pages/Platform.jsx.

const FLATS_NUMBER_COLUMNS = new Set([
  "izby", "obytna_plocha", "balkon_plocha", "loggia_plocha", "terasa_plocha",
  "zahrada_plocha", "exterier_plocha", "kobka_plocha", "celkova_plocha",
  "cena_bez_dph", "cena_s_dph", "cennikova_cena",
]);

function parseCsvRows(text) {
  const rows = []; let row = []; let field = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') { inQ = true; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") { field += c; }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function xlsxCell(colName, raw, numberCols) {
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return { value: null };
  if (numberCols.has(colName)) {
    const n = Number(s);
    if (Number.isFinite(n)) return { type: Number, value: n };
  }
  return { type: String, value: s };
}

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}`);
  if (!ok) { console.log("   got :", JSON.stringify(got)); console.log("   want:", JSON.stringify(want)); fail++; } else pass++;
};

// ── parseCsvRows: quoted comma, escaped quote, embedded newline, trailing NL ──
eq("csv: quoted field with comma",
  parseCsvRows('a,"b, c",d')[0], ["a", "b, c", "d"]);
eq("csv: escaped double-quote",
  parseCsvRows('x,"say ""hi""",z')[0], ["x", 'say "hi"', "z"]);
eq("csv: embedded newline inside quotes stays one field",
  parseCsvRows('p,"line1\nline2",q').length, 1);
eq("csv: trailing newline yields no phantom row",
  parseCsvRows("a,b\nc,d\n").length, 2);

// ── xlsxCell: numeric coercion only on number columns, text stays text ──
eq("cell: price string → Number", xlsxCell("cena_s_dph", "199638.39", FLATS_NUMBER_COLUMNS), { type: Number, value: 199638.39 });
eq("cell: area string → Number", xlsxCell("celkova_plocha", "72.5", FLATS_NUMBER_COLUMNS), { type: Number, value: 72.5 });
eq("cell: leading-zero unit_id stays TEXT", xlsxCell("unit_id", "007", FLATS_NUMBER_COLUMNS), { type: String, value: "007" });
eq("cell: non-numeric floor stays TEXT", xlsxCell("poschodie", "prízemie", FLATS_NUMBER_COLUMNS), { type: String, value: "prízemie" });
eq("cell: number col but non-numeric value → TEXT (no data loss)", xlsxCell("izby", "2+kk", FLATS_NUMBER_COLUMNS), { type: String, value: "2+kk" });
eq("cell: empty → blank", xlsxCell("cena_s_dph", "", FLATS_NUMBER_COLUMNS), { value: null });
eq("cell: null → blank", xlsxCell("cena_s_dph", null, FLATS_NUMBER_COLUMNS), { value: null });
eq("cell: diacritic text preserved", xlsxCell("stav", "voľný", FLATS_NUMBER_COLUMNS), { type: String, value: "voľný" });

console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
