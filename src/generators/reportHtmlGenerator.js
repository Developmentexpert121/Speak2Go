const fs = require("fs");
const path = require("path");

const { esc, num } = require("../utils/escapeHtml");
const { LOGO_DATA_URI, FAVICON_DATA_URI } = require("./brandAssets");

/**
 * The stylesheet, inlined at render time.
 *
 * Read from a file so the CSS can be edited as CSS, but embedded in the
 * output rather than linked: the report is opened straight from S3 and
 * printed by a headless browser, neither of which has a server to resolve a
 * relative stylesheet against. Read once at module load — it never changes
 * between renders.
 */
const REPORT_CSS = fs.readFileSync(
  path.join(__dirname, "..", "templates", "reports", "report.css"),
  "utf8"
);

/**
 * Renders a Report Object into the HTML the spec calls for (section 2,
 * "Detailed Reports: Generated in HTML for inline UI rendering and
 * downloadable PDF"). Kept dependency-free (a plain template literal) so it
 * runs server-side for the PDF and can be handed to Speak2Go for inline
 * rendering unchanged.
 *
 * NO EXTERNAL REFERENCES. Styles are inline and the logo and favicon are
 * embedded as data URIs. That is what lets the same file sit in S3, be opened
 * directly, and print to PDF with no server to resolve assets against.
 *
 * LAYOUT NOTES follow the client's video review of 19 Aug 2026:
 *   - the teacher's recommendations moved from the very end to just under the
 *     summary, because that is the part a teacher acts on and nobody scrolls
 *     past five question breakdowns to find it;
 *   - student details are set large, since the report is read at a glance
 *     before it is read in detail;
 *   - questions are numbered "1.1", not "1a" — a letter suffix reads as a
 *     variant of one question rather than the first of two choices;
 *   - each question block is unbreakable across pages. A response split over
 *     a page boundary was the specific thing he called "problematic".
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

  // "0:26". The client asked for the duration on every answer: a deduction for
  // a short answer is unarguable when the length is printed beside it, and
  // unexplainable when it is not.
  const duration = (seconds) => {
    if (seconds == null || !Number.isFinite(Number(seconds))) return null;
    const total = Math.round(Number(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  /**
   * The overall score as a ring, taken from the client's design reference.
   * Drawn as inline SVG rather than an image so the document stays
   * self-contained, and coloured by band rather than with a fixed gradient so
   * a failing score still reads as failing at a glance.
   */
  const scoreGauge = (score) => {
    const value = Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Number(score))) : 0;
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const filled = (value / 100) * circumference;
    const colour = scoreColor(value);
    return `
      <svg class="gauge" viewBox="0 0 130 130" width="130" height="130" role="img" aria-label="${esc(num(score))} out of 100">
        <circle cx="65" cy="65" r="${radius}" fill="none" stroke="#E8EEF3" stroke-width="13"></circle>
        <circle cx="65" cy="65" r="${radius}" fill="none" stroke="${colour}" stroke-width="13"
                stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${(circumference - filled).toFixed(2)}"
                transform="rotate(-90 65 65)"></circle>
        <text x="65" y="63" text-anchor="middle" class="gauge-num" fill="${colour}">${num(score)}</text>
        <text x="65" y="82" text-anchor="middle" class="gauge-den">out of 100</text>
      </svg>`;
  };

  /**
   * The four Student Object fields as labelled cards, which is the client's
   * reference layout and also what he asked for in the video — the student
   * details set large enough to read at a glance rather than as one grey line.
   * Icons are inline paths; nothing is fetched.
   */
  const ICONS = {
    student: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    class: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 20V9"/>',
    school: '<path d="M12 3 2 9h20L12 3Z"/><path d="M5 10v9h14v-9M9 19v-5h6v5"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h10"/>',
  };
  const studentCard = (icon, label, value) => `
      <div class="scard">
        <svg class="sicon" viewBox="0 0 24 24" fill="none" stroke="#0A6E9E" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>
        <div>
          <span class="slabel">${esc(label)}</span>
          <span class="svalue">${esc(value || "—")}</span>
        </div>
      </div>`;

  const partRows = (report.partScores || []).length
    ? report.partScores
        .map(
          (p) => `
        <tr>
          <td>${esc(p.label)}</td>
          <td class="mono">${esc((p.questionNumbers || p.questionIds || []).join(", "))}</td>
          <td class="right"><strong>${num(p.pointsEarned)}</strong> / ${num(p.pointsPossible, 0)}</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="3">No part breakdown available.</td></tr>`;

  const questionBlocks = (report.questions || [])
    .map((q) => {
      const dur = duration(q.speechMetrics?.durationSeconds);
      return `
    <div class="question-block">
      <div class="question-head">
        <span class="qid">Q${esc(q.questionNumber ?? q.questionId)}</span>
        <span class="qdesc">${esc(q.typeDescription)}</span>
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

      ${
        // The link points at the Speak2Go app, which authorises each playback
        // itself — never a presigned S3 link. Labelled rather than hidden
        // behind the transcript heading, because the client looked for it and
        // could not find it.
        q.recordingUrl
          ? `<div class="qaudio"><span class="label">Audio URL</span><a class="play" href="${esc(q.recordingUrl)}">${esc(q.recordingUrl)}</a></div>`
          : ""
      }

      <div class="qmeta">
        ${
          // Field order and wording set by the client (24 Aug 2026):
          // "Score after deduction" sits immediately right of "Deductions", so
          // the three numbers read as the sum they are — raw, what came off,
          // what is left. Whole numbers only; a grade of "64.28" implies a
          // precision the rubric's four bands do not have.
          ""
        }
        <span>Raw Score: <strong>${num(q.rawScore, 0)}</strong></span>
        <span>Deductions: <strong class="ded-pct">${esc(q.deduction)}%</strong></span>
        <span>Score after deduction: <strong>${num(q.finalQuestionScore, 0)}</strong></span>
        ${dur ? `<span>Duration: <strong>${esc(dur)}</strong></span>` : ""}
        ${
          // "Fluency", not "Speaking" — his wording. The unit stays spelled out
          // in brackets because the bare number read as meaningless on paper.
          q.speechMetrics?.wordsPerMinute
            ? `<span>Fluency: <strong>${esc(q.speechMetrics.wordsPerMinute)}</strong> <span class="unit">[words per minute]</span></span>`
            : ""
        }
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
                           <td colspan="4" style="color:${scoreColor(c.criterionScore)}">${esc(c.criterionName)}</td>
                           <td class="right" style="color:${scoreColor(c.criterionScore)}">${num(c.criterionScore)}</td>
                         </tr>
                         <tr class="crit-gap"><td colspan="5"></td></tr>`
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
  `;
    })
    .join("");

  const deductionRows = (report.deductionsTable || []).length
    ? report.deductionsTable
        .map(
          (d) => `
        <tr>
          <td class="ded-q">Q${esc(d.questionNumber ?? d.questionId)}</td>
          <td class="ded-reason">${esc(d.reason)}</td>
          <td class="ded-pct right">−${esc(d.deduction)}%</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="3">No deductions applied.</td></tr>`;

  // A question the student never answered forfeits its points, and the Details
  // table above shows that only as a silent 0 / 25 — indistinguishable from an
  // answer that was given and scored zero. The two mean completely different
  // things to a teacher, so the forfeited questions are named explicitly.
  const unattempted = report.unattemptedQuestions || [];
  const unattemptedSection = unattempted.length
    ? `
  <div class="section-title">Not Attempted</div>
  <table class="deductions">
    <thead><tr><th>Question</th><th>Description</th><th class="right">Loss of points</th></tr></thead>
    <tbody>${unattempted
      .map(
        (u) => `
        <tr>
          <td class="ded-q">Q${esc(u.questionNumber ?? u.questionId)}</td>
          <td>${esc(u.description)}</td>
          <td class="ded-pct right">−${num(u.pointsForfeited, 0)}</td>
        </tr>`
      )
      .join("")}</tbody>
  </table>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>COBE - Spoken English Exam Test Report</title>
<link rel="icon" type="image/png" href="${FAVICON_DATA_URI}">
<style>${REPORT_CSS}</style>
</head>
<body>
  <img class="page-mark" src="${LOGO_DATA_URI}" alt="">

  <div class="topbar">
    <img class="brand-logo" src="${LOGO_DATA_URI}" alt="Speak2Go">
    ${meta.dateExecuted ? `<span class="topbar-date">${esc(meta.dateExecuted)}</span>` : ""}
  </div>

  <div class="titleblock">
    <div class="doc-title">COBE - Spoken English Exam Test Report</div>
    ${meta.examName ? `<div class="exam-name">${esc(meta.examName)}</div>` : ""}
    ${meta.examDescription ? `<div class="exam-desc">${esc(meta.examDescription)}</div>` : ""}
  </div>

  <div class="scoreblock">
    ${scoreGauge(report.overallScore)}
    <div class="score-caption">Final score</div>
    <div class="score-level">${esc(meta.examLevel)}${meta.cefrLevel ? " · CEFR " + esc(meta.cefrLevel) : ""}</div>
  </div>

  <div class="section-title">Student</div>
  <div class="student-grid">
    ${studentCard("student", "Full name", meta.studentName)}
    ${studentCard("class", "Class", meta.className)}
    ${studentCard("school", "School", meta.schoolName)}
    ${studentCard("id", "School ID (Semel Mosad)", meta.schoolId)}
  </div>

  <div class="section-title">Details</div>
  <table class="parts">
    <thead><tr><th>Part</th><th>Questions</th><th class="right">Points</th></tr></thead>
    <tbody>${partRows}</tbody>
  </table>

  <div class="section-title">Teacher Recommendations</div>
  <div class="recommendations">${esc(report.teacherRecommendations) || "—"}</div>

  <div class="section-title page-break">Question Breakdown</div>
  ${questionBlocks}

  <div class="section-title page-break">Deductions Summary</div>
  <table class="deductions">
    <thead><tr><th>Question</th><th>Reason</th><th class="right">Deduction</th></tr></thead>
    <tbody>${deductionRows}</tbody>
  </table>
${unattemptedSection}
</body></html>`;
}

module.exports = { renderReportHtml };
