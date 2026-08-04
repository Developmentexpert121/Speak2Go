/**
 * Implements the scoring pipeline from the spec:
 *  1. Sub-Criteria Scores (4-level classifiers, fixed values) -> already given
 *  2. Main Criterion Score = simple average of its sub-criteria
 *  3. Raw Question Score = weighted average of main criteria
 *
 * @param {Array} criteria - rubric criteria for this question level (from rubrics.json)
 * @param {Array} llmScores - [{ id, selected_level, justification }, ...] from the LLM
 */
function aggregateQuestionScore(criteria, llmScores) {
  const scoreById = Object.fromEntries(
    llmScores.map((s) => [s.id, Number(s.selected_level)])
  );

  const criterionBreakdown = criteria.map((criterion) => {
    const subScores = criterion.sub_criteria.map((sc) => {
      const level = scoreById[sc.id];
      if (level === undefined) {
        throw new Error(`Missing LLM score for sub-criterion ${sc.id}`);
      }
      return { id: sc.id, name: sc.name, score: level };
    });

    // Main Criterion Score = simple average of its sub-criteria (per spec section 4.B.2)
    const criterionScore =
      subScores.reduce((sum, s) => sum + s.score, 0) / subScores.length;

    return {
      criterion_name: criterion.criterion_name,
      weight: criterion.weight,
      sub_criteria: subScores,
      criterion_score: Number(criterionScore.toFixed(2)),
    };
  });

  // Raw Question Score = weighted average of main criteria (per spec section 4.B.3)
  const rawQuestionScore = criterionBreakdown.reduce(
    (sum, c) => sum + c.criterion_score * c.weight,
    0
  );

  return {
    criterion_breakdown: criterionBreakdown,
    raw_score: Number(rawQuestionScore.toFixed(2)), // 0-100 scale
  };
}

module.exports = { aggregateQuestionScore };
