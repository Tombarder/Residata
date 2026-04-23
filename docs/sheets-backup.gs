/**
 * Residata Sheets auto-backup — Google Apps Script.
 *
 * What it does:
 *   Makes a timestamped copy of the Residata master sheet (Prehlad
 *   projektov + all {Projekt} Raw tabs + Clean Master) into a dedicated
 *   Backups folder in your Drive. Runs on a daily trigger.
 *
 * Why: the sheet is your single source of truth for the scraper pipeline.
 * Google has internal version history but if the file is ever
 * accidentally deleted, shared too broadly, or corrupted by a bad formula,
 * having point-in-time .xlsx copies saves the day.
 *
 * Setup (one-time, ~3 minutes):
 *   1. Open the Residata master sheet in Google Sheets.
 *      URL: https://docs.google.com/spreadsheets/d/1OHb9eddPYCYfqmw81fOVIqWybVtnkIvc2YGgG9ZT3Rc/edit
 *   2. Menu: Extensions → Apps Script.
 *      A code editor opens in a new tab.
 *   3. Delete whatever boilerplate is there (`function myFunction() {}`).
 *   4. Paste THIS entire file.
 *   5. Top toolbar: Save (disk icon) — name the project "Residata Backup".
 *   6. Click "Run" once while `backupNow` is selected in the dropdown.
 *      Google will ask for permissions (one-time):
 *        "This app isn't verified" → Advanced → Go to Residata Backup (unsafe)
 *        Grant: "See and manage your spreadsheets" + "See and manage your files"
 *      Wait ~10s. Check the execution log (Ctrl+Enter).
 *      A file named "Residata master — backup YYYY-MM-DD" should appear
 *      in a folder called "Residata backups" at the root of your Drive.
 *   7. Left sidebar → Triggers (alarm-clock icon).
 *      Add trigger:
 *        - Function: backupNow
 *        - Event source: Time-driven
 *        - Type: Day timer
 *        - Hour: 3am - 4am (anytime at night)
 *      Save.
 *   8. Done. A fresh backup will be created every night.
 *
 * Retention: script keeps last 30 backups; older ones get auto-deleted
 * to not bloat Drive.
 */

const SOURCE_SHEET_ID = "1OHb9eddPYCYfqmw81fOVIqWybVtnkIvc2YGgG9ZT3Rc";
const BACKUP_FOLDER_NAME = "Residata backups";
const KEEP_LAST_N = 30;

function backupNow() {
  const source = DriveApp.getFileById(SOURCE_SHEET_ID);
  const folder = getOrCreateBackupFolder();

  const stamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || "Europe/Bratislava",
    "yyyy-MM-dd"
  );
  const name = `Residata master — backup ${stamp}`;

  // If a backup for today already exists, skip (avoids duplicates from
  // test runs or daylight-savings overlaps).
  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) {
    Logger.log("Backup for " + stamp + " already exists — skipping.");
    return;
  }

  source.makeCopy(name, folder);
  Logger.log("Backup created: " + name);

  pruneOldBackups(folder);
}

function getOrCreateBackupFolder() {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

function pruneOldBackups(folder) {
  const files = [];
  const iter = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (iter.hasNext()) {
    const f = iter.next();
    files.push({ file: f, date: f.getDateCreated() });
  }
  files.sort((a, b) => b.date - a.date);
  const toDelete = files.slice(KEEP_LAST_N);
  toDelete.forEach(({ file }) => {
    Logger.log("Pruning old backup: " + file.getName());
    file.setTrashed(true);
  });
}

/**
 * Manual trigger helper — you can Run this from the Apps Script UI
 * anytime to verify the script works without waiting for the daily trigger.
 */
function testRun() {
  backupNow();
  Logger.log("Manual test run complete. Check " + BACKUP_FOLDER_NAME + " in Drive.");
}
