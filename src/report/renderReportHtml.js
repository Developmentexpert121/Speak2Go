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
  // Band colours match renderDashboardHtml and public/styles.css so the same
  // score is never green in one artefact and amber in another.
  const scoreColor = (s) => (s >= 85 ? "#12925F" : s >= 60 ? "#B0730A" : "#D0402F");

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
          <td class="ded-pct">−${esc(d.deductionPct)}%</td>
        </tr>`).join("")
    : `<tr><td colspan="3">No deductions applied.</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Exam Report</title>
<style>
  /* Speak2Go logo palette, matching renderDashboardHtml and public/styles.css.
     #17ADF2 is the logo blue and appears only as a rule or fill — it is far
     too light to carry text. #0A6E9E is the blue used for type. */
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1F2730; margin:0; padding:32px; }
  .header { display:flex; justify-content:space-between; align-items:baseline; border-bottom:3px solid #17ADF2; padding-bottom:12px; margin-bottom:20px; }
  .overall { font-size:32px; font-weight:700; }
  .meta { color:#667582; font-size:13px; margin-bottom:24px; }
  .question-block { margin-bottom:18px; border:1px solid #DDE8F1; border-radius:8px; padding:14px 16px; }
  .question-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .qid { font-weight:700; color:#0A6E9E; background:#E9F6FE; border-radius:5px; padding:2px 8px; }
  .qdesc { color:#46545F; font-size:12.5px; flex:1; }
  .qscore { font-weight:700; font-size:16px; }
  .criteria-table { width:100%; border-collapse:collapse; font-size:12.5px; }
  .criteria-table th, .criteria-table td { text-align:left; padding:5px 8px; border-bottom:1px solid #EDF3F8; }
  .criteria-table th { color:#667582; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
  .no-score { color:#D0402F; font-size:12.5px; font-style:italic; }
  .section-title { font-size:14px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; margin:26px 0 10px; color:#0A6E9E; }
  table.deductions { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.deductions th, table.deductions td { text-align:left; padding:6px 8px; border-bottom:1px solid #EDF3F8; }
  table.deductions th { color:#667582; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
  /* Same red as a failing score — a deduction is the reason a score fell, so
     the two should read as one idea rather than two unrelated colours. */
  .ded-pct { color:#D0402F; font-weight:700; }
  .recommendations { background:#E9F6FE; border:1px solid #CBE8FA; border-radius:8px; padding:14px 16px; font-size:13px; line-height:1.6; white-space:pre-line; }
  @media print { * { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
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
