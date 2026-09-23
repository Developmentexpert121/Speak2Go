/**
 * The partial-answer deduction (spec 4.C): a question set where some
 * sub-questions went unanswered loses Topic Development marks only, not the
 * whole question score.
 *
 * Does not apply to choose-one parts — see docs/scoring-rules.md.
 */
function computeGroupCoverageDeduction(groupQuestions) {
  const total = groupQuestions.length;
  if (total <= 1) {
    return { deductionPct: 0, answeredCount: total, totalCount: total };
  }

  const answeredCount = groupQuestions.filter(
    (q) => !q.audio_metrics.isEffectivelyEmpty
  ).length;
  const missingCount = total - answeredCount;

  let deductionPct;
  if (missingCount === 0) deductionPct = 0;
  else if (missingCount === 1) deductionPct = 25;
  else if (answeredCount === 1) deductionPct = 50;
  else if (answeredCount === 0) deductionPct = 100;
  else deductionPct = 50; // multi-missing, >2-part set — not explicitly in spec table

  return { deductionPct, answeredCount, totalCount: total };
}

/**
 * Applies a Topic-Development-only deduction to one question's already
 * computed criterion breakdown, then recomputes the question's raw_score
 * using the same weighted-average logic as aggregateScores.js.
 */
function applyCoverageDeductionToQuestion(questionResult, deductionPct) {
  if (deductionPct === 0 || questionResult.criterion_breakdown.length === 0) {
    return questionResult;
  }

  const adjustedBreakdown = questionResult.criterion_breakdown.map((c) => {
    if (c.criterion_name !== "Topic Development") return c;
    const adjustedScore = Number((c.criterion_score * (1 - deductionPct / 100)).toFixed(2));
    return { ...c, criterion_score: adjustedScore, coverage_deduction_applied_pct: deductionPct };
  });

  const rawScore = adjustedBreakdown.reduce(
    (sum, c) => sum + c.criterion_score * c.weight,
    0
  );

  return {
    ...questionResult,
    criterion_breakdown: adjustedBreakdown,
    raw_score: Number(rawScore.toFixed(2)),
  };
}

module.exports = { computeGroupCoverageDeduction, applyCoverageDeductionToQuestion };
