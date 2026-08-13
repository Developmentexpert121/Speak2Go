const { esc, num } = require("./escapeHtml");

/**
 * Renders a Report Object into the HTML format the spec calls for
 * (section 2, "Detailed Reports: Generated in HTML for inline UI rendering
 * and downloadable PDF"). Kept dependency-free (plain template literal) so
 * it can run both server-side (for PDF via Puppeteer) and be sent directly
 * to Speak2Go for inline rendering.
 *
 * The layout follows the client's spec document: a header carrying the Exam
 * and Student objects, the four-row "Details" table scored out of 25 each,
 * then one block per question with its text, the student's transcript, and
 * the major-criteria / sub-criteria breakdown.
 *
 * NO EXTERNAL REFERENCES. Every style is inline and there are no images,
 * fonts or scripts fetched over the network. That is what lets the same file
 * be stored in S3 and opened directly, and printed to PDF on demand, without
 * a server to resolve assets against.
 *
 * Every interpolated value goes through esc() — see escapeHtml.js for why.
 */
function renderReportHtml(report, meta = {}) {
  // Band colours match renderDashboardHtml and public/styles.css so the same
  // score is never green in one artefact and amber in another.
  const scoreColor = (s) => (s >= 85 ? "#12925F" : s >= 60 ? "#B0730A" : "#D0402F");

  // Filled vs hollow stars, drawn as characters rather than images so the
  // document stays self-contained. `stars` is null for any score outside the
  // rubric's four bands, in which case the number stands on its own.
  const starRating = (n) =>
    n == null ? "" : `<span class="stars">${"★".repeat(n)}${"☆".repeat(4 - n)}</span>`;

  const partRows = (report.partScores || []).length
    ? report.partScores
        .map(
          (p) => `
        <tr>
          <td>${esc(p.label)}</td>
          <td class="mono">${esc((p.questionIds || []).join(", "))}</td>
          <td class="right"><strong>${num(p.pointsEarned)}</strong> / ${num(p.pointsPossible, 0)}</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="3">No part breakdown available.</td></tr>`;

  const questionBlocks = (report.questionScores || [])
    .map(
      (q) => `
    <div class="question-block">
      <div class="question-head">
        <span class="qid">Q${esc(q.questionId)}</span>
        <span class="qdesc">${esc(q.description)}</span>
        ${
          // Part A shows two questions and only the better one counts. Both
          // are printed with a full breakdown, so without this badge a reader
          // sees two Part A scores and cannot tell which produced the grade.
          q.countsTowardFinal === false
            ? `<span class="not-counted">feedback only — not counted</span>`
            : ""
        }
        <span class="qscore" style="color:${scoreColor(q.finalQuestionScore)}">${num(q.finalQuestionScore)}</span>
      </div>

      ${q.questionText ? `<div class="qtext"><span class="label">Question</span>${esc(q.questionText)}</div>` : ""}

      ${
        q.answerTranscript
          ? `<div class="qtranscript"><span class="label">Answer transcript</span>${esc(q.answerTranscript)}</div>`
          : `<div class="no-score">No answer recorded for this question.</div>`
      }

      <div class="qmeta">
        <span>Raw score <strong>${num(q.rawScore)}</strong></span>
        <span>Final score <strong>${num(q.finalQuestionScore)}</strong></span>
        <span>Deductions <strong class="ded-pct">${esc(q.deductionPct)}%</strong></span>
        ${q.speechMetrics?.wordsPerMinute ? `<span>${esc(q.speechMetrics.wordsPerMinute)} wpm</span>` : ""}
      </div>

      ${
        (q.criterionBreakdown || []).length
          ? `<table class="criteria-table">
              <thead><tr><th>Criterion</th><th>Weight</th><th>Sub-criterion</th><th>Rating</th><th class="right">Score</th></tr></thead>
              <tbody>
                ${q.criterionBreakdown
                  .map((c) =>
                    (c.subCriteria || []).length
                      ? c.subCriteria
                          .map(
                            (sc, i) => `
                  <tr>
                    ${
                      i === 0
                        ? `<td rowspan="${c.subCriteria.length}" class="crit-name">${esc(c.criterionName)}</td>
                           <td rowspan="${c.subCriteria.length}" class="crit-weight">${num(c.weight * 100, 0)}%</td>`
                        : ""
                    }
                    <td>${esc(sc.name)}</td>
                    <td>${starRating(sc.stars)}</td>
                    <td class="right" style="color:${scoreColor(sc.score)}">${num(sc.score, 0)}</td>
                  </tr>`
                          )
                          .join("") +
                        `<tr class="crit-total">
                           <td colspan="4">${esc(c.criterionName)} — criterion score</td>
                           <td class="right" style="color:${scoreColor(c.criterionScore)}">${num(c.criterionScore)}</td>
                         </tr>`
                      : `<tr>
                           <td class="crit-name">${esc(c.criterionName)}</td>
                           <td class="crit-weight">${num(c.weight * 100, 0)}%</td>
                           <td colspan="2"></td>
                           <td class="right" style="color:${scoreColor(c.criterionScore)}">${num(c.criterionScore)}</td>
                         </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
          : `<div class="no-score">No rubric score — question was zeroed by penalty rules before evaluation.</div>`
      }
    </div>
  `
    )
    .join("");

  const deductionRows = (report.deductionsTable || []).length
    ? report.deductionsTable
        .map(
          (d) => `
        <tr>
          <td>Q${esc(d.questionId)}</td>
          <td>${esc(d.reason)}</td>
          <td class="ded-pct right">−${esc(d.deductionPct)}%</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="3">No deductions applied.</td></tr>`;

  // A question the student never answered forfeits its points, and the Details
  // table above shows that only as a silent 0 / 25 — indistinguishable from an
  // answer that was given and scored zero. The two mean completely different
  // things to a teacher, so the forfeited questions are named explicitly. The
  // section is omitted entirely when the exam was answered in full.
  const unattempted = report.unattemptedQuestions || [];
  const unattemptedSection = unattempted.length
    ? `
  <div class="section-title">Not Attempted</div>
  <table class="deductions">
    <thead><tr><th>Question</th><th>Description</th><th class="right">Points forfeited</th></tr></thead>
    <tbody>${unattempted
      .map(
        (u) => `
        <tr>
          <td>Q${esc(u.questionId)}</td>
          <td>${esc(u.description)}</td>
          <td class="ded-pct right">−${num(u.pointsForfeited, 0)}</td>
        </tr>`
      )
      .join("")}</tbody>
  </table>`
    : "";

  const studentLine = [meta.gradeClass, meta.schoolName].filter(Boolean).map(esc).join(" · ");

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>COBE - Spoken English Exam Test Report</title>
<style>
  /* Speak2Go logo palette, matching renderDashboardHtml and public/styles.css.
     #17ADF2 is the logo blue and appears only as a rule or fill — it is far
     too light to carry text. #0A6E9E is the blue used for type. */
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1F2730; margin:0; padding:32px; }
  .header { display:flex; justify-content:space-between; align-items:baseline; border-bottom:3px solid #17ADF2; padding-bottom:12px; margin-bottom:8px; }
  .doc-title { font-weight:700; font-size:19px; }
  .overall { font-size:32px; font-weight:700; }
  .overall .of { font-size:15px; font-weight:400; color:#667582; }
  .meta { color:#667582; font-size:13px; margin-bottom:24px; }
  .question-block { margin-bottom:18px; border:1px solid #DDE8F1; border-radius:8px; padding:14px 16px; page-break-inside:avoid; }
  .question-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .qid { font-weight:700; color:#0A6E9E; background:#E9F6FE; border-radius:5px; padding:2px 8px; }
  .qdesc { color:#46545F; font-size:12.5px; flex:1; }
  .qscore { font-weight:700; font-size:16px; }
  /* Grey, not red: this answer is not a failure, it simply is not the one
     that counted. */
  .not-counted { font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:#667582; background:#F1F4F7; border-radius:4px; padding:2px 7px; white-space:nowrap; }
  .label { display:block; color:#667582; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px; }
  .qtext { font-size:12.5px; margin-bottom:8px; }
  /* The transcript is the evidence behind the grade, so it is shown in full
     rather than truncated — a teacher fielding an appeal needs to read it. */
  .qtranscript { font-size:12.5px; line-height:1.55; background:#F6FAFD; border:1px solid #EDF3F8; border-radius:6px; padding:9px 11px; margin-bottom:9px; white-space:pre-line; }
  .qmeta { display:flex; gap:16px; font-size:11.5px; color:#46545F; margin-bottom:9px; }
  .criteria-table, table.deductions, table.parts { width:100%; border-collapse:collapse; font-size:12.5px; }
  .criteria-table th, .criteria-table td,
  table.deductions th, table.deductions td,
  table.parts th, table.parts td { text-align:left; padding:5px 8px; border-bottom:1px solid #EDF3F8; vertical-align:top; }
  .criteria-table th, table.deductions th, table.parts th { color:#667582; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
  .crit-name { font-weight:600; }
  .crit-weight { color:#667582; }
  .crit-total td { font-size:11.5px; color:#46545F; background:#F6FAFD; font-weight:600; }
  .stars { color:#0A6E9E; letter-spacing:1px; }
  .right { text-align:right; }
  .mono { font-family:'SFMono-Regular',Consolas,monospace; font-size:11.5px; color:#667582; }
  .no-score { color:#D0402F; font-size:12.5px; font-style:italic; margin-bottom:9px; }
  .section-title { font-size:14px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; margin:26px 0 10px; color:#0A6E9E; }
  /* Same red as a failing score — a deduction is the reason a score fell, so
     the two should read as one idea rather than two unrelated colours. */
  .ded-pct { color:#D0402F; font-weight:700; }
  .recommendations { background:#E9F6FE; border:1px solid #CBE8FA; border-radius:8px; padding:14px 16px; font-size:13px; line-height:1.6; white-space:pre-line; }
  /* Without this the score colours and the tinted panels print as white, and
     a report whose whole point is a colour-coded grade prints meaningless. */
  @media print { * { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="doc-title">COBE - Spoken English Exam Test Report</div>
      <div class="meta">
        ${esc(meta.studentName || "Student")}${studentLine ? " · " + studentLine : ""}<br>
        ${esc(meta.examLevel)}${meta.cefrLevel ? " · CEFR " + esc(meta.cefrLevel) : ""}${meta.dateExecuted ? " · " + esc(meta.dateExecuted) : ""}
      </div>
    </div>
    <div class="overall" style="color:${scoreColor(report.overallScore)}">${num(report.overallScore)}<span class="of">/100</span></div>
  </div>

  <div class="section-title">Details</div>
  <table class="parts">
    <thead><tr><th>Part</th><th>Questions</th><th class="right">Points</th></tr></thead>
    <tbody>${partRows}</tbody>
  </table>

  <div class="section-title">Question Breakdown</div>
  ${questionBlocks}

  <div class="section-title">Deductions</div>
  <table class="deductions">
    <thead><tr><th>Question</th><th>Reason</th><th class="right">Deduction</th></tr></thead>
    <tbody>${deductionRows}</tbody>
  </table>
${unattemptedSection}

  <div class="section-title">Teacher Recommendations</div>
  <div class="recommendations">${esc(report.teacherRecommendations) || "—"}</div>
</body></html>`;
}

module.exports = { renderReportHtml };
