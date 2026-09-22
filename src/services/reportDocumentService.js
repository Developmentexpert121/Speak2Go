const { getReport } = require("../db/reportRepository");
const { notFound } = require("../utils/AppError");

/**
 * The three rendered views of a finished run: the teacher's report as HTML,
 * the same as a PDF, and the operator dashboard.
 *
 * Reports live in memory and are evicted on restart (the client asked for no
 * database writes), so "not found" and "expired" are the same condition here
 * and carry the same message.
 */
function getReportHtml(examId) {
  const stored = getReport(examId);
  if (!stored) throw notFound("Report not found or evicted.");
  return stored.html;
}

function getDashboardHtml(examId) {
  const stored = getReport(examId);
  if (!stored?.dashboardHtml) throw notFound("Dashboard not found or evicted.");
  return stored.dashboardHtml;
}

function getReportPdfPath(examId) {
  const stored = getReport(examId);
  if (!stored?.pdfPath) throw notFound("PDF not found or evicted.");
  return stored.pdfPath;
}

module.exports = { getReportHtml, getDashboardHtml, getReportPdfPath };
