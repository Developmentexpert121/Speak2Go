const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");

/**
 * Part A is a CHOOSE-ONE part: the student is shown two questions and answers
 * one. The client confirmed this on 13 Aug 2026 and asked that we score both
 * for feedback but count only the higher one toward the grade.
 *
 * These tests exist because every part of that rule fails silently if it is
 * wrong. Marking Part A out of 50, or counting both answers, or deducting for
 * the "missing" second answer all produce a plausible-looking number on a
 * report that nobody can tell is wrong by looking at it.
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

const SPOKEN = { transcript: "a ".repeat(150), words: words(150, 90), durationSeconds: 90, confidence: 0.95 };
const SILENT = { transcript: "", words: [], durationSeconds: 0, confidence: 0 };

// Keyed by audio path so a test can give each Part A answer a different
// quality, which is the only way to prove the BETTER one is the one kept.
const AUDIO = { "strong.wav": SPOKEN, "weak.wav": SPOKEN, "empty.wav": SILENT };

stub(path.join(SRC, "services", "sttService.js"), {
  transcribeAudioFile: async (p) => AUDIO[p],
});

// The rubric score is driven by the question text, which each test sets to
// "strong" or "weak" — the stub has no other way to tell the answers apart.
stub(path.join(SRC, "services", "llmScoring.js"), {
  scoreQuestionAgainstRubric: async ({ questionText }) => {
    const level = String(questionText).includes("strong") ? 100 : 54;
    return {
      subCriteriaScores: ALL_SUB_CRITERIA.map((id) => ({ id, selected_level: level, justification: "stub" })),
      contentFlags: { foul_language: false, non_english: false, unintelligible: false, flag_reasoning: "" },
    };
  },
});

const { evaluateFullExam } = require(path.join(SRC, "pipeline", "evaluateFullExam.js"));
const { buildPartScores } = require(path.join(__dirname, "..", "..", "src", "report", "buildReportObject.js"));

const LEVEL = "5_UNITS_CEFR_B2";

/** Part A only, so the arithmetic under test is not buried in a full exam. */
function partA({ aText = "strong", bText = "weak", bAudio = "weak.wav" } = {}) {
  return [
    { question_id: "1a", part: "A", description: "Part A", question_text: aText, weight: 25, audioFilePath: "strong.wav" },
    { question_id: "1b", part: "A", description: "Part A", question_text: bText, weight: 25, audioFilePath: bAudio },
  ];
}

test("Part A is worth 25 in total, not 25 per question", async () => {
  // The failure this catches: both answers counted, so a student who answered
  // both well scores 50 out of Part A's 25 and the exam total passes 100.
  const result = await evaluateFullExam({ questions: partA({ aText: "strong", bText: "strong" }), level: LEVEL });

  assert.equal(result.points_earned, 25);
  assert.equal(result.points_possible, 100);
  assert.equal(result.overall_score, 25);
});

test("the higher-scoring Part A answer is the one that counts", async () => {
  const result = await evaluateFullExam({ questions: partA(), level: LEVEL });

  const byId = Object.fromEntries(result.question_results.map((r) => [r.question_id, r]));
  assert.equal(byId["1a"].counts_toward_final, true, "1a scored higher");
  assert.equal(byId["1b"].counts_toward_final, false);

  // Both are still fully scored — the client asked for feedback on both.
  assert.ok(byId["1b"].criterion_breakdown.length > 0, "the unused answer keeps its breakdown");
  assert.ok(byId["1b"].final_question_score > 0, "and keeps its own score");

  // Only the better one reaches the grade.
  assert.equal(result.points_earned, (byId["1a"].final_question_score / 100) * 25);
});

test("order does not matter — the better answer wins even when it is second", async () => {
  const result = await evaluateFullExam({
    questions: partA({ aText: "weak", bText: "strong" }),
    level: LEVEL,
  });

  const byId = Object.fromEntries(result.question_results.map((r) => [r.question_id, r]));
  assert.equal(byId["1b"].counts_toward_final, true);
  assert.equal(byId["1a"].counts_toward_final, false);
});

test("answering only one Part A question carries no coverage deduction", async () => {
  // The regression this guards, and the reason the rule change is not just a
  // matter of arithmetic: the partial-coverage rule used to see 1 of 2
  // answered and cut Topic Development — half the grade — by 25%. Under the
  // new rule answering one is exactly what the student was told to do.
  const answeredOne = await evaluateFullExam({
    questions: partA({ aText: "strong", bText: "strong", bAudio: "empty.wav" }),
    level: LEVEL,
  });

  const kept = answeredOne.question_results.find((r) => r.counts_toward_final);
  assert.equal(kept.question_id, "1a");
  assert.equal(kept.final_question_score, 100, "a perfect answer stays perfect");
  assert.equal(answeredOne.points_earned, 25);
  assert.equal(
    answeredOne.question_results.some((r) => r.coverage_note),
    false,
    "no coverage deduction should be recorded for a choose-one part"
  );
});

test("the unchosen Part A question is not reported as points forfeited", async () => {
  // It was never meant to be answered, and its 25 points were not lost — they
  // were earned on the other question.
  const result = await evaluateFullExam({
    questions: partA({ bAudio: "empty.wav" }),
    level: LEVEL,
  });

  const forfeitedIds = result.unattempted_questions.map((u) => u.question_id);
  assert.equal(forfeitedIds.includes("1a"), false);
  assert.equal(forfeitedIds.includes("1b"), false);
});

test("skipping Part A entirely still forfeits its 25 points, once", async () => {
  // The opposite error: silently dropping a whole unanswered part would mark
  // the exam out of 75 and hand the student a pass they did not earn.
  const result = await evaluateFullExam({
    questions: [
      { question_id: "2", part: "B", description: "Part B", question_text: "strong", weight: 25, audioFilePath: "strong.wav" },
    ],
    level: LEVEL,
  });

  const partARows = result.unattempted_questions.filter((u) => String(u.question_id).startsWith("1"));
  assert.equal(partARows.length, 1, "one row for the group, not one per offered question");
  assert.equal(partARows[0].points_forfeited, 25);
  assert.equal(result.points_possible, 100);
});

test("the report's Part A row is out of 25 and shows the better answer", async () => {
  const result = await evaluateFullExam({ questions: partA(), level: LEVEL });
  const rows = buildPartScores(result);

  const rowA = rows.find((r) => r.part === "A");
  assert.equal(rowA.pointsPossible, 25, "not 50");
  assert.deepEqual(rowA.questionIds, ["1a", "1b"], "both are still listed");

  const best = Math.max(...result.question_results.map((r) => (r.final_question_score / 100) * 25));
  assert.equal(rowA.pointsEarned, Number(best.toFixed(2)));

  // And the table as a whole still adds up to the full exam.
  assert.equal(rows.reduce((s, r) => s + r.pointsPossible, 0), 100);
});
