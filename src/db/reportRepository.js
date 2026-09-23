const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Stores and retrieves rendered reports. Data access only — see
 * docs/architecture.md for why these live in memory rather than a database.
 */

const OUT_DIR = path.join(os.tmpdir(), "s2g_reports");
const MAX_REPORTS = 50;

/** examId -> { html, dashboardHtml, pdfPath } */
const reports = new Map();

/**
 * Oldest-first eviction. The PDF is a real file, so dropping the map entry
 * without unlinking it would leak disk for the life of the process.
 */
function evictOldest() {
  while (reports.size > MAX_REPORTS) {
    const oldest = reports.keys().next().value;
    const entry = reports.get(oldest);
    if (entry?.pdfPath) {
      try {
        fs.unlinkSync(entry.pdfPath);
      } catch {
        /* best effort */
      }
    }
    reports.delete(oldest);
  }
}

/** Where a PDF for this exam should be written. Creates the directory. */
function pdfPathFor(examId) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  return path.join(OUT_DIR, `${examId}.pdf`);
}

function saveReport(examId, { html, dashboardHtml, pdfPath }) {
  reports.set(examId, { html, dashboardHtml, pdfPath });
  evictOldest();
  return reports.get(examId);
}

function getReport(examId) {
  return reports.get(examId) || null;
}

module.exports = { saveReport, getReport, pdfPathFor, OUT_DIR, MAX_REPORTS };
