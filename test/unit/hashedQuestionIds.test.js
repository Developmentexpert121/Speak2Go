const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");

/**
 * End-to-end proof that the scoring rules survive Speak2Go's real payload
 * shape: a randomly generated questionId with all the structure carried by
 * questionType.
 *
 * Every assertion here passed BEFORE questionType support existed, for the
 * wrong reason — with our own ids. Re-run against hashes and the old code
 * marked Part A out of 50 and never applied the Part B time deduction, while
 * producing a report that looked entirely normal.
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

const LONG = { transcript: "a ".repeat(150), words: words(150, 90), durationSeconds: 90, confidence: 0.95 };
// 45 seconds: inside the Part B 0:40-0:59 band (20% off) but comfortably over
// the general 20-second floor, so ONLY the Part B rule can produce a deduction
// here. A shorter clip would be zeroed by the generic rule and the test would
// pass whether or not Part B was recognised at all.
const MEDIUM = { transcript: "a ".repeat(80), words: words(80, 45), durationSeconds: 45, confidence: 0.95 };

stub(path.join(SRC, "services", "sttService.js"), {
  transcribeAudioFile: async (p) => (p === "medium.wav" ? MEDIUM : LONG),
});
stub(path.join(SRC, "services", "llmScoring.js"), {
  scoreQuestionAgainstRubric: async ({ questionText }) => ({
    subCriteriaScores: ALL_SUB_CRITERIA.map((id) => ({
      id,
      selected_level: String(questionText).includes("weak") ? 54 : 100,
      justification: "stub",
    })),
    contentFlags: { foul_language: false, non_english: false, unintelligible: false, flag_reasoning: "" },
  }),
});

const { evaluateFullExam } = require(path.join(SRC, "pipeline", "evaluateFullExam.js"));

const LEVEL = "5_UNITS_B2";

// Deliberately opaque and deliberately NOT in blueprint order, since a hash
// carries no ordering either.
const HASH = {
  a1: "f3c9a1b27de4",
  a2: "0b81ee5c4a90",
  b: "77dd12fa9c03",
  c1: "aa4419b7e6d2",
  c2: "c50e73male9f1",
};

function q(id, questionType, text, audio = "long.wav") {
  return {
    question_id: id,
    questionType,
    question_text: text,
    weight: questionType.startsWith("a") ? 25 : 25,
    audioFilePath: audio,
  };
}

test("Part A is still choose-one when the ids are hashes", async () => {
  const result = await evaluateFullExam({
    questions: [q(HASH.a1, "a1", "strong"), q(HASH.a2, "a2", "weak")],
    level: LEVEL,
  });

  // Out of 25, not 50 — the whole point.
  assert.equal(result.points_earned, 25);
  assert.equal(result.points_possible, 100);

  const byId = Object.fromEntries(result.question_results.map((r) => [r.question_id, r]));
  assert.equal(byId[HASH.a1].counts_toward_final, true);
  assert.equal(byId[HASH.a2].counts_toward_final, false);
});

test("answering one Part A question carries no coverage deduction, with hashes", async () => {
  const result = await evaluateFullExam({
    questions: [q(HASH.a1, "a1", "strong"), q(HASH.a2, "a2", "strong", "empty.wav")],
    level: LEVEL,
  });
  assert.equal(result.question_results.some((r) => r.coverage_note), false);
});

test("the Part B time deduction still fires when the id is a hash", async () => {
  // A 45-second project presentation: the Part B band takes 20% off. Chosen
  // deliberately above the 20-second floor, because a shorter answer is zeroed
  // by the GENERAL empty-answer rule and this test would then pass without
  // Part B ever being recognised.
  const typed = await evaluateFullExam({
    questions: [q(HASH.b, "b", "strong", "medium.wav")],
    level: LEVEL,
  });

  const r = typed.question_results[0];
  assert.ok(
    r.deductions.some((d) => /time-based/i.test(d.reason)),
    `expected the Part B time-based deduction, got: ${JSON.stringify(r.deductions)}`
  );
  assert.equal(r.final_question_score, 80, "100 less the 20% band");

  // The control: strip questionType and the same answer keeps full marks,
  // because nothing else can tell this is Part B.
  const untyped = await evaluateFullExam({
    questions: [{ ...q(HASH.b, "b", "strong", "medium.wav"), questionType: undefined }],
    level: LEVEL,
  });
  assert.equal(untyped.question_results[0].final_question_score, 100);
  assert.equal(untyped.question_results[0].deductions.length, 0);
});

test("Part C's two questions are scored independently, not as a set", async () => {
  // If c1 and c2 shared a group they would look like a partially-answered set
  // and both would lose Topic Development marks.
  const result = await evaluateFullExam({
    questions: [q(HASH.c1, "c1", "strong"), q(HASH.c2, "c2", "strong")],
    level: LEVEL,
  });

  assert.equal(result.question_results.some((r) => r.coverage_note), false);
  for (const r of result.question_results) {
    assert.equal(r.final_question_score, 100);
    assert.equal(r.counts_toward_final, true);
  }
});

test("a full hashed exam totals 100 and every part is recognised", async () => {
  const result = await evaluateFullExam({
    questions: [
      q(HASH.a1, "a1", "strong"),
      q(HASH.a2, "a2", "strong"),
      q(HASH.b, "b", "strong"),
      q(HASH.c1, "c1", "strong"),
      q(HASH.c2, "c2", "strong"),
    ],
    level: LEVEL,
  });

  assert.equal(result.overall_score, 100);
  assert.equal(result.points_earned, 100);

  const parts = result.question_results.map((r) => r.part).filter(Boolean);
  assert.equal(parts.length, 5, "every question resolved to a part");
});
