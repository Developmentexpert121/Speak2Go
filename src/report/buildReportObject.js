/**
 * Builds the Report Object — the single payload Speak2Go receives back for a
 * graded exam, and the thing the webhook POSTs.
 *
 * ON CASING. The spec doc writes every field in snake_case. The client asked
 * on 12 Aug 2026 for camelCase on the wire, so this module is the one place
 * that translates: everything upstream of here (the scoring engine, the
 * rubric config, the penalty rules) keeps its original snake_case internals,
 * and nothing downstream of here ever sees them.
 *
 * Doing the rename at this boundary rather than across the engine was
 * deliberate. A blanket find-replace would also have caught three families of
 * identifier that only LOOK like snake_case fields and must not move:
 *   - rubric sub-criterion ids (`sc1_relevancy`, `sc8_correct_grammar`),
 *     which are matched by string against rubrics.json and the LLM's reply;
 *   - level codes (`5_UNITS_B2`);
 *   - Speak2Go's own Mongo columns (`IDNumber`, `SemelMosad`), which are
 *     inputs, not outputs.
 * Listing the output keys by hand costs a few lines and makes it impossible
 * to rename one of those by accident.
 *
 * @param {object} examResult - output of evaluateFullExam()
 * @param {string} teacherRecommendations - generated separately (see
 *   generateRecommendations.js), passed in here to keep this function pure
 */

/**
 * The doc renders each sub-criterion as a four-star rating. The rubric only
 * ever emits four values (25 / 54 / 75 / 100 — see rubrics.json), so this is a
 * lookup, not a rounding: 54 is the second band, not "two-and-a-bit stars".
 * Anything unexpected returns null so the renderer shows the number alone
 * rather than inventing a star count.
 */
const { buildRecordingUrl } = require("./recordingUrl");

const STAR_BY_SCORE = { 25: 1, 54: 2, 75: 3, 100: 4 };

function starsFor(score) {
  return STAR_BY_SCORE[score] ?? null;
}

/**
 * The doc's "Details" summary table: four rows, each out of 25.
 *
 * The rows are not simply the exam's three parts. Parts A and B each collapse
 * to one row however many questions they contain (Part A is always 1a+1b at
 * 12.5 each, and Part B is one question in 2019-2022 lessons but two in the
 * 2023 ones). Part C is the opposite — its two questions are reported
 * SEPARATELY, as C1 "Video Comprehension" and C2 "Personal Opinion", because
 * they test different things and the doc gives them their own rows.
 *
 * Built from the exam layout rather than from the submitted questions, so a
 * part the student skipped still appears with 0 earned instead of vanishing
 * and making the table silently add up to less than 100.
 */
const PART_ROW_LABELS = {
  A: "Part A - Personal Response",
  B: "Part B - Project Presentation",
  C1: "Part C1 - Video Comprehension",
  C2: "Part C2 - Personal Opinion",
};

function buildPartScores(examResult) {
  const layout = examResult.exam_layout || [];
  const resultById = Object.fromEntries(
    examResult.question_results.map((r) => [String(r.question_id), r])
  );

  // Part C questions get one row each, in question order; A and B share a row.
  const seenCGroups = [];
  const rowKeyFor = (bp) => {
    if (bp.part !== "C") return bp.part;
    const group = String(bp.question_id).replace(/[a-z]$/i, "");
    if (!seenCGroups.includes(group)) seenCGroups.push(group);
    return `C${seenCGroups.indexOf(group) + 1}`;
  };

  const rows = [];
  const byKey = {};

  for (const bp of layout) {
    const key = rowKeyFor(bp);
    if (!byKey[key]) {
      byKey[key] = {
        part: key,
        label: PART_ROW_LABELS[key] || `Part ${key}`,
        questionIds: [],
        pointsEarned: 0,
        pointsPossible: 0,
      };
      rows.push(byKey[key]);
    }

    const row = byKey[key];
    const r = resultById[String(bp.question_id)];
    row.questionIds.push(bp.question_id);

    // On a choose-one part (Part A) the two questions share one 25-point
    // allocation and only the better answer scores, so the row takes the
    // points once and the best result rather than the sum. Adding them would
    // mark Part A out of 50 and let a student earn 25 twice.
    const earned = r ? (r.final_question_score / 100) * (r.weight ?? bp.points) : 0;
    if (bp.choice_group) {
      row.pointsPossible = bp.points;
      row.pointsEarned = Math.max(row.pointsEarned, earned);
    } else {
      row.pointsPossible += bp.points;
      // An unattempted question earns 0 of its points — it does not shrink
      // the denominator. Same rule as the exam total in evaluateFullExam.
      row.pointsEarned += earned;
    }
  }

  return rows.map((row) => ({
    ...row,
    pointsEarned: Number(row.pointsEarned.toFixed(2)),
    pointsPossible: Number(row.pointsPossible.toFixed(2)),
  }));
}

function buildQuestionScore(r, reportId) {
  // The deduction actually applied is the worst single one, not the sum —
  // deductions in this spec don't stack (see evaluateFullExam step 4). Recorded
  // here so a reader can reconcile rawScore against finalQuestionScore without
  // having to re-derive the rule from the deductions list.
  const deductionPct = (r.deductions || []).length
    ? Math.max(...r.deductions.map((d) => d.deductionPct))
    : 0;

  const m = r.audio_metrics || {};

  return {
    questionId: r.question_id,
    // Speak2Go's semantic label ("a1", "b", "c2"), echoed back. Their schema
    // sheet carries it on the Question, and it is the only field that tells a
    // consumer which part a hashed questionId belongs to.
    questionType: r.question_type ?? null,
    typeDescription: r.description ?? null,
    // Retained alongside typeDescription: `part` is a single letter the
    // renderer groups by, and deriving it from prose on every read would be
    // fragile.
    part: r.part ?? null,
    questionText: r.question_text ?? null,
    // The clip transcript this answer was scored against, echoed so a result
    // can be reproduced from the payload alone.
    videoTranscription: r.reference_material ?? null,
    // Points this question is worth. On Part A both offered questions carry
    // the full 25, because only one of them counts.
    weight: r.weight ?? null,
    // The client asked (12 Aug 2026) that the report carry the student's own
    // words for Part C, not just the clip's. It is carried for every part.
    answerTranscript: r.transcript ?? "",
    // The S3 object key Speak2Go handed us, echoed back so a result can be
    // traced to the exact recording that produced it. It is a key, not a URL:
    // the recordings bucket is private and stays that way.
    audioFileKey: r.audio_file_key ?? null,
    // The playable link, pointing at Speak2Go's own app rather than at S3, so
    // it never expires and they authorise each playback. See recordingUrl.js.
    recordingUrl: buildRecordingUrl({ reportId, questionId: r.question_id }),
    rawScore: r.raw_score,
    finalQuestionScore: r.final_question_score,
    // Named `deduction` to match the client's schema sheet. It is a
    // percentage 0-100, and it is the WORST single deduction rather than the
    // sum, because deductions in this spec do not stack.
    deduction: deductionPct,
    // Part A offers two questions and the student answers one; both are
    // scored so the report can give feedback on each, but only the higher
    // scoring one counts toward the grade. Without this the report shows two
    // Part A scores and no way to tell which one was used.
    countsTowardFinal: r.counts_toward_final !== false,
    criterionBreakdown: (r.criterion_breakdown || []).map((c) => ({
      criterionName: c.criterion_name,
      weight: c.weight,
      criterionScore: c.criterion_score,
      subCriteria: (c.sub_criteria || []).map((sc) => ({
        // `id` stays as-is: it is a rubric key, not a field name.
        id: sc.id,
        name: sc.name,
        score: sc.score,
        stars: starsFor(sc.score),
      })),
    })),
    speechMetrics: {
      wordsPerMinute: m.wpm ?? null,
      durationSeconds: m.totalDurationSeconds ?? null,
      longPauseCount: m.longPauseCount ?? null,
      fluencyLabel: m.fluencyLabel ?? null,
    },
  };
}

function buildReportObject(examResult, teacherRecommendations, { reportId = null } = {}) {
  const questions = examResult.question_results.map((r) => buildQuestionScore(r, reportId));

  const deductionsTable = examResult.question_results.flatMap((r) =>
    (r.deductions || []).map((d) => ({
      questionId: r.question_id,
      // `reason` is not in the client's schema sheet; it is kept because a
      // deductions table a teacher cannot explain to a student is not much use
      // in an appeal. Confirmation on adding it formally is still outstanding.
      reason: d.reason,
      deduction: d.deductionPct,
    }))
  );

  // Not in the spec, but a grade that was nearly zeroed and then wasn't is the
  // first thing anyone appealing a result will ask about. Carried alongside the
  // spec fields rather than inside them, so the Report Object still matches the
  // spec for consumers that only read the documented keys.
  const suppressedFlags = examResult.question_results.flatMap((r) =>
    (r.suppressed_flags || []).map((s) => ({ questionId: r.question_id, ...s }))
  );

  const unattemptedQuestions = (examResult.unattempted_questions || []).map((u) => ({
    questionId: u.question_id,
    description: u.description,
    pointsForfeited: u.points_forfeited,
  }));

  return {
    overallScore: examResult.overall_score,
    pointsEarned: examResult.points_earned,
    pointsPossible: examResult.points_possible,
    partScores: buildPartScores(examResult),
    // Named `questions` to match the client's schema sheet, which reuses the
    // input Question type with the scoring fields filled in.
    questions,
    deductionsTable,
    teacherRecommendations,
    unattemptedQuestions,
    suppressedFlags,
  };
}

module.exports = { buildReportObject, buildPartScores, starsFor };
