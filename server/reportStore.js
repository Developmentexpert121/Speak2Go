/**
 * Renders and serves the HTML and PDF reports, so that spec 3.1's
 * `report_html_url` and `report_pdf_url` can hold real, fetchable values.
 *
 * Spec section 2 wants both formats: HTML "for inline UI rendering" and a
 * "downloadable PDF". Both renderers already existed in src/report — they were
 * simply never reachable from the server, so those two URL fields had nowhere
 * to point.
 *
 * WHERE THE FILES LIVE. Not in a database (the client asked for no DB writes)
 * and not in S3 (no credentials). We hold the HTML in memory and spill only
 * the PDF to a temp directory, because Puppeteer writes to a path rather than
 * a buffer. Both are evicted with the job, so a restart loses them — which is
 * correct for a module whose reports are meant to be handed to a dashboard,
 * not archived here. This is option (a) in the client question: we host, the
 * URLs point at us, and moving to S3 later changes nothing for the caller.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { renderReportHtml } = require("../src/report/renderReportHtml");
const { renderDashboardHtml } = require("../src/report/renderDashboardHtml");
const { renderReportPdf } = require("../src/report/renderReportPdf");

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

  return {
    reportHtmlUrl: `/api/exams/${examId}/report.html`,
    reportPdfUrl: pdfPath ? `/api/exams/${examId}/report.pdf` : null,
    reportDashboardUrl: dashboardHtml ? `/api/exams/${examId}/dashboard.html` : null,
  };
}

function getReport(examId) {
  return reports.get(examId) || null;
}

module.exports = { buildReports, getReport };
