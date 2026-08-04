/**
 * Builds the Report Object exactly as defined in spec section 3.6:
 *   overall_score      (Float) [0..100]
 *   question_scores    (List of Question Breakdown objects): (Float) [0..100]
 *   deductions_table   (List of Deduction objects): (% [0..100])
 *   teacher_recommendations (String/Text)
 *
 * @param {object} examResult - output of evaluateFullExam()
 * @param {string} teacherRecommendations - generated separately (see
 *   generateRecommendations.js), passed in here to keep this function pure
 */
function buildReportObject(examResult, teacherRecommendations) {
  const question_scores = examResult.question_results.map((r) => ({
    question_id: r.question_id,
    description: r.description,
    raw_score: r.raw_score,
    final_question_score: r.final_question_score,
    criterion_breakdown: r.criterion_breakdown,
  }));

  const deductions_table = examResult.question_results.flatMap((r) =>
    (r.deductions || []).map((d) => ({
      question_id: r.question_id,
      reason: d.reason,
      deductionPct: d.deductionPct,
    }))
  );

  return {
    overall_score: examResult.overall_score,
    question_scores,
    deductions_table,
    teacher_recommendations: teacherRecommendations,
  };
}

module.exports = { buildReportObject };
