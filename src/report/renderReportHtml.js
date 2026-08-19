const { esc, num } = require("./escapeHtml");
const { LOGO_DATA_URI, FAVICON_DATA_URI } = require("./assets");

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
        <span>Raw score <strong>${num(q.rawScore)}</strong></span>
        <span>Final score <strong>${num(q.finalQuestionScore)}</strong></span>
        <span>Deductions <strong class="ded-pct">${esc(q.deduction)}%</strong></span>
        ${dur ? `<span>Duration <strong>${esc(dur)}</strong></span>` : ""}
        ${
          // "Speaking 118" rather than "118 wpm": the client's point was that a
          // student reading their own report does not know what wpm means.
          q.speechMetrics?.wordsPerMinute
            ? `<span>Speaking <strong>${esc(q.speechMetrics.wordsPerMinute)}</strong></span>`
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
    <thead><tr><th>Question</th><th>Description</th><th class="right">Points forfeited</th></tr></thead>
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
<style>
  /* Speak2Go logo palette, matching renderDashboardHtml and public/styles.css.
     #17ADF2 is the logo blue and appears only as a rule or fill — it is far
     too light to carry text. #0A6E9E is the blue used for type. */
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1F2730; margin:0; padding:32px 32px 48px; }

  .topbar { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #17ADF2; padding-bottom:10px; }
  .brand-logo { height:38px; display:block; }
  .topbar-date { font-size:12px; color:#667582; }

  .titleblock { text-align:center; margin:18px 0 4px; }
  .doc-title { font-weight:700; font-size:21px; letter-spacing:-.01em; }
  .exam-name { font-size:14px; color:#46545F; margin-top:4px; font-weight:600; }
  .exam-desc { font-size:12.5px; color:#667582; margin-top:2px; }

  /* The score as a ring, from the client's design reference. Centred and
     given room, because it is the one number every reader looks for first. */
  .scoreblock { text-align:center; margin:6px 0 4px; }
  .gauge { display:inline-block; }
  .gauge-num { font-size:30px; font-weight:700; font-family:'Helvetica Neue',Arial,sans-serif; }
  .gauge-den { font-size:10px; fill:#667582; font-family:'Helvetica Neue',Arial,sans-serif; letter-spacing:.04em; }
  .score-caption { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#667582; margin-top:2px; }
  .score-level { font-size:13.5px; color:#1F2730; font-weight:600; margin-top:3px; }

  /* Student details as cards rather than one grey line — the client asked for
     them "much bigger", and four labelled fields are easier to check at a
     glance than a run-on sentence. */
  .student-grid { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
  .scard { display:flex; align-items:center; gap:10px; background:#F6FAFD; border:1px solid #E4EEF6; border-radius:8px; padding:9px 12px; }
  .sicon { width:22px; height:22px; flex:0 0 22px; }
  .slabel { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:#667582; }
  .svalue { display:block; font-size:15px; font-weight:700; color:#0F2E42; line-height:1.25; }

  .section-title { font-size:17px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; margin:28px 0 10px; color:#0A6E9E; border-bottom:2px solid #DDE8F1; padding-bottom:5px; }

  .question-block { margin-bottom:18px; border:1px solid #DDE8F1; border-radius:8px; padding:14px 16px; page-break-inside:avoid; break-inside:avoid; }
  .question-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .qid { font-weight:700; font-size:15px; color:#0A6E9E; background:#E9F6FE; border-radius:5px; padding:3px 10px; }
  .qdesc { color:#46545F; font-size:13px; flex:1; font-weight:600; }
  .qscore { font-weight:700; font-size:19px; }
  .not-counted { font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:#667582; background:#F1F4F7; border-radius:4px; padding:2px 7px; white-space:nowrap; }

  .label { display:block; color:#667582; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px; }
  .qtext { font-size:13px; margin-bottom:8px; }
  /* The transcript is the evidence behind the grade, so it is shown in full
     rather than truncated — a teacher fielding an appeal needs to read it. */
  .qtranscript { font-size:13px; line-height:1.55; background:#F6FAFD; border:1px solid #EDF3F8; border-radius:6px; padding:9px 11px; margin-bottom:8px; white-space:pre-line; }
  .qaudio { font-size:11.5px; margin-bottom:9px; word-break:break-all; }
  .play { color:#0A6E9E; text-decoration:none; border-bottom:1px solid #9BD3F0; }
  .qmeta { display:flex; gap:16px; font-size:12px; color:#46545F; margin-bottom:9px; flex-wrap:wrap; }

  .criteria-table, table.deductions, table.parts { width:100%; border-collapse:collapse; font-size:12.5px; }
  .criteria-table th, .criteria-table td,
  table.deductions th, table.deductions td,
  table.parts th, table.parts td { text-align:left; padding:5px 8px; border-bottom:1px solid #EDF3F8; vertical-align:top; }
  .criteria-table th, table.deductions th, table.parts th { color:#0A6E9E; font-size:11px; text-transform:uppercase; letter-spacing:.05em; background:#EDF6FC; border-bottom:1px solid #CFE6F5; }
  table.parts td { font-size:13px; }
  table.parts tbody tr:nth-child(even) td { background:#FAFCFE; }
  .crit-name { font-weight:600; }
  .crit-weight { color:#667582; }
  .crit-total td { font-size:11.5px; color:#46545F; background:#F6FAFD; font-weight:600; }
  .stars { color:#0A6E9E; letter-spacing:1px; }
  .right { text-align:right; }
  .mono { font-family:'SFMono-Regular',Consolas,monospace; font-size:11.5px; color:#667582; }
  .no-score { color:#D0402F; font-size:12.5px; font-style:italic; margin-bottom:9px; }

  /* Deductions are the part a student will query, so they are set to be
     impossible to skim past. Same red as a failing score — a deduction is the
     reason a score fell, so the two read as one idea. */
  .ded-pct { color:#D0402F; font-weight:700; }
  table.deductions .ded-q, table.deductions .ded-reason { font-weight:700; color:#8E2B20; }
  table.deductions .ded-pct { font-size:13.5px; }

  .recommendations { background:#E9F6FE; border:1px solid #CBE8FA; border-radius:8px; padding:14px 16px; font-size:13.5px; line-height:1.6; white-space:pre-line; }

  /* Repeated on every printed page. A fixed element is painted once per page
     by the print engine, which is the only way to get a running mark without
     a templating layer. */
  .page-mark { display:none; }
  @media print {
    .page-mark { display:block; position:fixed; bottom:10px; right:14px; height:16px; opacity:.75; }
    /* Without this the score colours and the tinted panels print as white, and
       a report whose whole point is a colour-coded grade prints meaningless. */
    * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
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

  <div class="section-title">Question Breakdown</div>
  ${questionBlocks}

  <div class="section-title">Deductions</div>
  <table class="deductions">
    <thead><tr><th>Question</th><th>Reason</th><th class="right">Deduction</th></tr></thead>
    <tbody>${deductionRows}</tbody>
  </table>
${unattemptedSection}
</body></html>`;
}

module.exports = { renderReportHtml };
