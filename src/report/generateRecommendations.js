const OpenAI = require("openai");
const { questionNumber } = require("./questionNumber");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
let client;
function getClient() {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

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

  const prompt = `You are summarizing an English oral exam result for a teacher (not the student). Given this per-question breakdown, write 3-4 short, specific, actionable sentences a teacher could use to plan follow-up instruction. Do not restate scores/numbers already visible elsewhere in the report — focus on patterns (e.g. recurring weak criterion, fluency trend, missed sub-questions). Be concrete, not generic.

DATA:
${JSON.stringify(summary, null, 2)}

Return plain text only, no markdown, no headers.`;

  const response = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: "You write concise, specific teacher-facing feedback summaries." },
      { role: "user", content: prompt },
    ],
  });

  return response.choices[0].message.content.trim();
}

module.exports = { generateRecommendations };
