const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");

/**
 * The Part C clip transcript is per QUESTION, not per part. The client
 * confirmed on 13 Aug 2026 that it rides on the question object as
 * `videoTranscription`, null or text.
 *
 * Why this has a test of its own: the scorer judges relevance against the
 * reference material it is handed. Give question 4 the transcript belonging to
 * question 3 and a perfectly good answer reads as off-topic, which shows up as
 * a low Topic Development score — half the grade — with nothing anywhere
 * saying the wrong clip was used.
 */

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const ALL_SUB_CRITERIA = [
  "sc1_relevancy", "sc2_prompt_understanding", "sc3_answer_logic", "sc4_answer_development",
  "sc5_speech_quality", "sc6_fluency", "sc7_vocabulary_range", "sc8_correct_grammar", "sc9_english_only",
];

function words(count, durationSeconds) {
  const step = durationSeconds / count;
  return Array.from({ length: count }, (_, i) => ({
    word: "word", punctuated_word: "word", start: i * step, end: i * step + step * 0.8,
  }));
}

stub(path.join(SRC, "services", "sttService.js"), {
  transcribeAudioFile: async () => ({
    transcript: "a ".repeat(150), words: words(150, 90), durationSeconds: 90, confidence: 0.95,
  }),
});

/** Records what reference material each question's scoring call received. */
const seen = [];
stub(path.join(SRC, "services", "llmScoring.js"), {
  scoreQuestionAgainstRubric: async ({ questionText, referenceMaterial }) => {
    seen.push({ questionText, referenceMaterial });
    return {
      subCriteriaScores: ALL_SUB_CRITERIA.map((id) => ({ id, selected_level: 75, justification: "stub" })),
      contentFlags: { foul_language: false, non_english: false, unintelligible: false, flag_reasoning: "" },
    };
  },
});

const { evaluateFullExam } = require(path.join(SRC, "pipeline", "evaluateFullExam.js"));

const LEVEL = "5_UNITS_CEFR_B2";

test("each Part C question is scored against its own clip transcript", async () => {
  seen.length = 0;

  await evaluateFullExam({
    questions: [
      {
        question_id: "3", part: "C", description: "Part C", question_text: "q3",
        weight: 25, audioFilePath: "a.wav",
        referenceMaterial: "transcript of the sun-safety clip",
      },
      {
        question_id: "4", part: "C", description: "Part C", question_text: "q4",
        weight: 25, audioFilePath: "b.wav",
        referenceMaterial: "transcript of the city-traffic clip",
      },
    ],
    level: LEVEL,
  });

  const byQuestion = Object.fromEntries(seen.map((s) => [s.questionText, s.referenceMaterial]));
  assert.equal(byQuestion.q3, "transcript of the sun-safety clip");
  assert.equal(byQuestion.q4, "transcript of the city-traffic clip");
});

test("a question with no clip is scored against nothing, not against another question's clip", async () => {
  // Parts A and B have no video. Leaking Part C's transcript into them would
  // have the scorer marking a personal answer against an unrelated clip.
  seen.length = 0;

  await evaluateFullExam({
    questions: [
      { question_id: "1a", part: "A", description: "Part A", question_text: "qa", weight: 25, audioFilePath: "a.wav" },
      {
        question_id: "3", part: "C", description: "Part C", question_text: "q3",
        weight: 25, audioFilePath: "b.wav", referenceMaterial: "transcript of the clip",
      },
    ],
    level: LEVEL,
  });

  const byQuestion = Object.fromEntries(seen.map((s) => [s.questionText, s.referenceMaterial]));
  assert.equal(byQuestion.qa, null, "Part A gets no reference material");
  assert.equal(byQuestion.q3, "transcript of the clip");
});

test("an explicitly null transcript is passed through as null, not as the string", async () => {
  // The client's schema says the field is "null or text". A null that reached
  // the prompt as the four characters "null" would be worse than absent.
  seen.length = 0;

  await evaluateFullExam({
    questions: [
      {
        question_id: "3", part: "C", description: "Part C", question_text: "q3",
        weight: 25, audioFilePath: "a.wav", referenceMaterial: null,
      },
    ],
    level: LEVEL,
  });

  assert.equal(seen[0].referenceMaterial, null);
});
