const { esc, num } = require("./escapeHtml");

/**
 * Renders a Report Object into the HTML format the spec calls for
 * (section 2, "Detailed Reports: Generated in HTML for inline UI rendering
 * and downloadable PDF"). Kept dependency-free (plain template literal) so
 * it can run both server-side (for PDF via Puppeteer) and be sent directly
 * to Speak2Go for inline rendering.
 *
 * Every interpolated value goes through esc() — see escapeHtml.js for why.
 */
function renderReportHtml(report, meta = {}) {
  const scoreColor = (s) => (s >= 85 ? "#2F8F5B" : s >= 60 ? "#C4862B" : "#B23B4E");

  const questionRows = report.question_scores.map((q) => `
    <div class="question-block">
      <div class="question-head">
        <span class="qid">Q${esc(q.question_id)}</span>
        <span class="qdesc">${esc(q.description)}</span>
        <span class="qscore" style="color:${scoreColor(q.final_question_score)}">${num(q.final_question_score)}</span>
      </div>
      ${
        (q.criterion_breakdown || []).length
          ? `<table class="criteria-table">
              <thead><tr><th>Criterion</th><th>Weight</th><th>Score</th></tr></thead>
              <tbody>
                ${q.criterion_breakdown.map((c) => `
                  <tr>
                    <td>${esc(c.criterion_name)}</td>
                    <td>${num(c.weight * 100, 0)}%</td>
                    <td style="color:${scoreColor(c.criterion_score)}">${num(c.criterion_score)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>`
          : `<div class="no-score">No rubric score — question was zeroed by penalty rules before evaluation.</div>`
      }
    </div>
  `).join("");

  const deductionRows = report.deductions_table.length
    ? report.deductions_table.map((d) => `
        <tr>
          <td>Q${esc(d.question_id)}</td>
          <td>${esc(d.reason)}</td>
          <td>−${esc(d.deductionPct)}%</td>
        </tr>`).join("")
    : `<tr><td colspan="3">No deductions applied.</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Exam Report</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#142226; margin:0; padding:32px; }
  .header { display:flex; justify-content:space-between; align-items:baseline; border-bottom:2px solid #142226; padding-bottom:12px; margin-bottom:20px; }
  .overall { font-size:32px; font-weight:700; }
  .meta { color:#55666B; font-size:13px; margin-bottom:24px; }
  .question-block { margin-bottom:18px; border:1px solid #E1E5E2; border-radius:8px; padding:14px 16px; }
  .question-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .qid { font-weight:700; }
  .qdesc { color:#55666B; font-size:12.5px; flex:1; }
  .qscore { font-weight:700; font-size:16px; }
  .criteria-table { width:100%; border-collapse:collapse; font-size:12.5px; }
  .criteria-table th, .criteria-table td { text-align:left; padding:5px 8px; border-bottom:1px solid #EEE; }
  .no-score { color:#B23B4E; font-size:12.5px; font-style:italic; }
  .section-title { font-size:14px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; margin:26px 0 10px; color:#55666B; }
  table.deductions { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.deductions th, table.deductions td { text-align:left; padding:6px 8px; border-bottom:1px solid #EEE; }
  .recommendations { background:#F6F7F5; border-radius:8px; padding:14px 16px; font-size:13px; line-height:1.6; white-space:pre-line; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-weight:700; font-size:18px;">${esc(meta.studentName || "Student")} — Oral Exam Report</div>
      <div class="meta">${esc(meta.examLevel)} ${meta.dateExecuted ? "· " + esc(meta.dateExecuted) : ""}</div>
    </div>
    <div class="overall" style="color:${scoreColor(report.overall_score)}">${num(report.overall_score)}</div>
  </div>

  <div class="section-title">Question Breakdown</div>
  ${questionRows}

  <div class="section-title">Deductions</div>
  <table class="deductions">
    <thead><tr><th>Question</th><th>Reason</th><th>Deduction</th></tr></thead>
    <tbody>${deductionRows}</tbody>
  </table>

  <div class="section-title">Teacher Recommendations</div>
  <div class="recommendations">${esc(report.teacher_recommendations) || "—"}</div>
</body></html>`;
}

module.exports = { renderReportHtml };
