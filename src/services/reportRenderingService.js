const { renderReportHtml } = require("../generators/reportHtmlGenerator");
const { renderDashboardHtml } = require("../generators/dashboardHtmlGenerator");
const { renderReportPdf } = require("../generators/reportPdfGenerator");
const { uploadReport, isConfigured: canUploadReports } = require("../integrations/s3ReportStorageClient");
const { saveReport, pdfPathFor } = require("../db/reportRepository");

/**
 * Renders every output format for a finished exam and publishes what it can.
 *
 * The HTML is mandatory; the dashboard, the PDF and the S3 upload are not. A
 * failure in any of those is recorded and stepped over rather than thrown,
 * because the exam has already been graded by this point and losing a
 * completed evaluation to a PDF renderer is a worse outcome than a report
 * without a download link. See docs/architecture.md.
 */
async function buildReports({ examId, examResult, report, meta }) {
  const html = renderReportHtml(report, meta);

  let dashboardHtml = null;
  try {
    dashboardHtml = renderDashboardHtml(examResult, report, meta);
  } catch (err) {
    console.warn(`  dashboard render failed for ${examId}: ${err.message}`);
  }

  let pdfPath = null;
  try {
    const candidate = pdfPathFor(examId);
    await renderReportPdf(html, candidate);
    pdfPath = candidate;
  } catch (err) {
    console.warn(`  PDF render failed for ${examId}: ${err.message}`);
  }

  saveReport(examId, { html, dashboardHtml, pdfPath });

  let s3 = null;
  if (canUploadReports()) {
    try {
      s3 = await uploadReport({ examId, body: html });
    } catch (err) {
      console.warn(`  report upload failed for ${examId}: ${err.message}`);
    }
  }

  return {
    // The S3 link when there is one, the local route otherwise, so a report is
    // always reachable somewhere. `s3` is returned alongside so a caller can
    // tell which of the two it got.
    reportHtmlUrl: s3?.url || `/api/exams/${examId}/report.html`,
    reportPdfUrl: pdfPath ? `/api/exams/${examId}/report.pdf` : null,
    reportDashboardUrl: dashboardHtml ? `/api/exams/${examId}/dashboard.html` : null,
    s3,
  };
}

module.exports = { buildReports };
