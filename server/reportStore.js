/**
 * Renders and serves the HTML and PDF reports, so that the Exam Object's
 * `reportHtmlUrl` and `reportPdfUrl` can hold real, fetchable values.
 *
 * Spec section 2 wants both formats: HTML "for inline UI rendering" and a
 * "downloadable PDF".
 *
 * WHERE THE FILES LIVE. Not in a database — the client asked for no DB writes.
 * When S3 credentials are present the report HTML is uploaded to the client's
 * bucket and reportHtmlUrl points there; without them we fall back to holding
 * it in memory and serving it from this process. That fallback is what stops a
 * missing credential from turning into a failed exam run.
 *
 * The PDF spills to a temp directory because Puppeteer writes to a path rather
 * than a buffer. It is deliberately NOT uploaded: the client asked (11 Aug
 * 2026) that PDFs not be pre-rendered, since Avinoam generates them on demand
 * from the HTML. It is still produced locally so the download link keeps
 * working for anyone using this service directly.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { renderReportHtml } = require("../src/report/renderReportHtml");
const { renderDashboardHtml } = require("../src/report/renderDashboardHtml");
const { renderReportPdf } = require("../src/report/renderReportPdf");
const { uploadReport, isConfigured: s3IsConfigured } = require("./s3ReportStorage");

const OUT_DIR = path.join(os.tmpdir(), "s2g_reports");
const MAX_REPORTS = 50;

/** examId -> { html, dashboardHtml, pdfPath } */
const reports = new Map();

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

/**
 * Render every report format for a finished exam.
 *
 * PDF rendering launches headless Chrome and is by far the slowest step here,
 * so a failure is caught and recorded rather than thrown: a missing PDF must
 * not invalidate a completed evaluation. The HTML is always produced.
 *
 * @returns {Promise<{ reportHtmlUrl: string, reportPdfUrl: string|null }>}
 */
async function buildReports({ examId, examResult, report, meta }) {
  const html = renderReportHtml(report, meta);

  // The richer operator-facing view: adds part breakdown, criterion profile,
  // pipeline and per-question audio metrics that the formal report omits.
  let dashboardHtml = null;
  try {
    dashboardHtml = renderDashboardHtml(examResult, report, meta);
  } catch (err) {
    console.warn(`  dashboard render failed for ${examId}: ${err.message}`);
  }

  let pdfPath = null;
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const candidate = path.join(OUT_DIR, `${examId}.pdf`);
    await renderReportPdf(html, candidate);
    pdfPath = candidate;
  } catch (err) {
    console.warn(`  PDF render failed for ${examId}: ${err.message}`);
  }

  reports.set(examId, { html, dashboardHtml, pdfPath });
  evictOldest();

  // Publish to the client's bucket when we can. The local URL is kept as the
  // fallback so the report is always reachable somewhere, and `s3` is returned
  // alongside it so a caller can tell which one it got.
  let s3 = null;
  if (s3IsConfigured()) {
    s3 = await uploadReport({ examId, body: html });
  }

  return {
    reportHtmlUrl: s3?.url || `/api/exams/${examId}/report.html`,
    reportPdfUrl: pdfPath ? `/api/exams/${examId}/report.pdf` : null,
    reportDashboardUrl: dashboardHtml ? `/api/exams/${examId}/dashboard.html` : null,
    s3,
  };
}

function getReport(examId) {
  return reports.get(examId) || null;
}

module.exports = { buildReports, getReport };
