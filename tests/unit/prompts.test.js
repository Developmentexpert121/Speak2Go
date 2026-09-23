const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRubricPrompt, SCORING_SYSTEM } = require("../../src/prompts/rubricScoring");
const { buildRecommendationsPrompt } = require("../../src/prompts/recommendations");

/**
 * Prompts now live in .txt templates rather than inline template literals.
 * That is a readability win and a risk: a typo in a placeholder name no longer
 * breaks the build, it just ships a prompt with a literal "{{TRANSCRIPT}}" in
 * it. The model would answer anyway, plausibly, and the grade would be wrong
 * with nothing to indicate why — so every placeholder is checked as filled.
 */

const metrics = {
  wpm: 118,
  pauseCount: 2,
  longestPauseSeconds: 1.4,
  fillerWordCount: 3,
  wordCount: 64,
  fluencyLabel: "Functional (3 of 4)",
};
const criteria = [
  {
    criterion_name: "Topic Development",
    sub_criteria: [{ id: "sc1_relevancy", name: "Relevancy", levels: { 25: "a", 100: "d" } }],
  },
];

test("no placeholder survives into a rendered scoring prompt", () => {
  const prompt = buildRubricPrompt({
    questionText: "Tell me about your hometown.",
    transcript: "I live in Tiara.",
    audioMetrics: metrics,
    criteria,
    priorContext: [{ question_id: "1a", question_text: "prev", transcript: "earlier" }],
    referenceMaterial: "the clip transcript",
  });

  assert.equal(/\{\{[A-Z_]+\}\}/.test(prompt), false, "an unfilled {{TOKEN}} reached the model");
  assert.ok(prompt.includes("Tell me about your hometown."));
  assert.ok(prompt.includes("I live in Tiara."));
  assert.ok(prompt.includes("Words per minute: 118"));
  assert.ok(prompt.includes("sc1_relevancy"));
});

test("the optional blocks are omitted entirely rather than left empty", () => {
  // An empty "PRIOR ANSWERS" heading invites the model to fill it in.
  const prompt = buildRubricPrompt({
    questionText: "q",
    transcript: "t",
    audioMetrics: metrics,
    criteria,
  });

  assert.equal(prompt.includes("PRIOR ANSWERS"), false);
  assert.equal(prompt.includes("PART C REFERENCE"), false);
  assert.equal(/\{\{[A-Z_]+\}\}/.test(prompt), false);
});

test("prior answers are marked as context, never as the answer being scored", () => {
  // Crediting this question for content that only appears in a prior answer
  // would inflate the grade.
  const prompt = buildRubricPrompt({
    questionText: "q",
    transcript: "t",
    audioMetrics: metrics,
    criteria,
    priorContext: [{ question_id: "1a", question_text: "prev", transcript: "earlier" }],
  });

  assert.match(prompt, /do not score these/i);
  assert.match(prompt, /ONLY answer being scored/i);
});

test("the pause threshold quoted to the model is the one actually measured", () => {
  const config = require("../../src/config");
  const prompt = buildRubricPrompt({
    questionText: "q",
    transcript: "t",
    audioMetrics: metrics,
    criteria,
  });
  assert.ok(prompt.includes(`pauses over ${config.scoring.pauseThresholdSeconds}s`));
});

test("the recommendations prompt embeds the summary it was given", () => {
  const prompt = buildRecommendationsPrompt([{ question: "1.1", final_question_score: 80 }]);
  assert.equal(/\{\{[A-Z_]+\}\}/.test(prompt), false);
  assert.ok(prompt.includes('"question": "1.1"'));
});

test("the scoring system message demands JSON", () => {
  assert.match(SCORING_SYSTEM, /JSON/);
});
