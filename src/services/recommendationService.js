const { createChatCompletion } = require("../integrations/openaiClient");
const { questionNumber } = require("../utils/questionNumber");
const { RECOMMENDATIONS_SYSTEM, buildRecommendationsPrompt } = require("../prompts/recommendations");

/**
 * Produces the Report Object's teacher_recommendations text: a short,
 * pattern-level summary across the whole exam (not per-question), meant to
 * help a teacher decide what to focus on with this student next.
 */
async function generateRecommendations(examResult) {
  const summary = examResult.question_results.map((r) => ({
    // The number the teacher will see on the page ("1.1"), not our internal id
    // and not the hash. The model quotes this back in its prose, so feeding it
    // the raw id produces advice about "question 1a" printed next to a
    // question headed Q1.1 — or, once ids are hashes, about "question f3c9a1".
    question: questionNumber({ questionType: r.question_type, questionId: r.question_id }),
    final_question_score: r.final_question_score,
    fluency: r.audio_metrics?.fluencyLabel,
    weakest_criteria: (r.criterion_breakdown || [])
      .slice()
      .sort((a, b) => a.criterion_score - b.criterion_score)
      .slice(0, 1)
      .map((c) => c.criterion_name),
    deductions: r.deductions,
  }));

  const text = await createChatCompletion({
    temperature: 0.3,
    messages: [
      { role: "system", content: RECOMMENDATIONS_SYSTEM },
      { role: "user", content: buildRecommendationsPrompt(summary) },
    ],
  });

  return text.trim();
}

module.exports = { generateRecommendations };
