const test = require("node:test");
const assert = require("node:assert");

const { buildReportObject, buildPartScores, starsFor } = require("../../src/report/buildReportObject");

/**
 * A minimal but structurally complete exam result, shaped exactly as
 * evaluateFullExam() returns it. Deliberately hand-written rather than
 * generated: these tests exist to pin the OUTPUT contract Speak2Go consumes,
 * so the input needs to stay readable when one of them fails.
 */
function examResultFixture(overrides = {}) {
  return {
    level: "5_UNITS_B2",
    overall_score: 61.5,
    points_earned: 61.5,
    points_possible: 100,
    exam_layout: [
      { question_id: "1a", part: "A", points: 12.5, description: "Part A - Personal Response (Q1)" },
      { question_id: "1b", part: "A", points: 12.5, description: "Part A - Personal Response (Q2)" },
      { question_id: "2", part: "B", points: 25, description: "Part B - Project Presentation" },
      { question_id: "3", part: "C", points: 25, description: "Part C - Audio-Visual Response (Q1)" },
      { question_id: "4", part: "C", points: 25, description: "Part C - Audio-Visual Response (Q2)" },
    ],
    unattempted_questions: [],
    question_results: [
      {
        question_id: "1a",
        part: "A",
        weight: 12.5,
        description: "Part A - Personal Response (Q1)",
        question_text: "Tell me about social media.",
        transcript: "I think social media is mostly useful.",
        audio_file_key: "recordings/2026/08/abc/1a.mp3",
        raw_score: 75,
        final_question_score: 75,
        deductions: [],
        suppressed_flags: [],
        audio_metrics: { wpm: 84, totalDurationSeconds: 61, longPauseCount: 1, fluencyLabel: "some hesitations" },
        criterion_breakdown: [
          {
            criterion_name: "Topic Development",
            weight: 0.5,
            criterion_score: 75,
            sub_criteria: [
              { id: "sc1_relevancy", name: "Relevancy", score: 75 },
              { id: "sc2_prompt_understanding", name: "Prompt Understanding", score: 75 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("every key in the report object is camelCase", () => {
  const report = buildReportObject(examResultFixture(), "Work on fluency.");

  // Walks the whole tree. `id` values are excluded because rubric
  // sub-criterion ids (sc1_relevancy) are rubric keys, not field names, and
  // renaming them would break the match against rubrics.json and the LLM reply.
  const offenders = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (node === null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (k.includes("_")) offenders.push(`${path}.${k}`);
      walk(v, `${path}.${k}`);
    }
  };
  walk(report, "report");

  assert.deepEqual(offenders, [], `snake_case keys leaked into the report: ${offenders.join(", ")}`);
});

test("rubric sub-criterion ids keep their snake_case spelling", () => {
  const report = buildReportObject(examResultFixture(), "");
  const ids = report.questions[0].criterionBreakdown[0].subCriteria.map((s) => s.id);
  assert.deepEqual(ids, ["sc1_relevancy", "sc2_prompt_understanding"]);
});

test("the report carries the spec doc's per-question fields", () => {
  const report = buildReportObject(examResultFixture(), "");
  const q = report.questions[0];

  assert.equal(q.questionId, "1a");
  assert.equal(q.questionText, "Tell me about social media.");
  assert.equal(q.answerTranscript, "I think social media is mostly useful.");
  assert.equal(q.audioFileKey, "recordings/2026/08/abc/1a.mp3");
  assert.equal(q.rawScore, 75);
  assert.equal(q.finalQuestionScore, 75);
  assert.equal(q.speechMetrics.wordsPerMinute, 84);
});

test("sub-criteria get a star rating on the rubric's four bands", () => {
  assert.equal(starsFor(25), 1);
  assert.equal(starsFor(54), 2);
  assert.equal(starsFor(75), 3);
  assert.equal(starsFor(100), 4);
  // Anything off the four bands has no star equivalent — better to show the
  // number alone than to round 80 into "three stars" and imply a rubric level
  // that does not exist.
  assert.equal(starsFor(80), null);
  assert.equal(starsFor(undefined), null);
});

test("deductionPct on a question is the worst single deduction, not their sum", () => {
  const result = examResultFixture();
  result.question_results[0].deductions = [
    { reason: "coverage", deductionPct: 20 },
    { reason: "time band", deductionPct: 35 },
  ];

  const report = buildReportObject(result, "");
  assert.equal(report.questions[0].deduction, 35);
  assert.equal(report.deductionsTable.length, 2, "the table still lists both reasons");
  assert.equal(report.deductionsTable[0].questionId, "1a");
});

test("the part table is four rows of 25, with Part C split into C1 and C2", () => {
  // The spec doc's Details table: Parts A and B collapse to one row each
  // however many questions they hold, but Part C's two questions are reported
  // separately because they test different things.
  const rows = buildPartScores(examResultFixture());

  assert.deepEqual(
    rows.map((r) => r.part),
    ["A", "B", "C1", "C2"]
  );
  assert.deepEqual(
    rows.map((r) => r.pointsPossible),
    [25, 25, 25, 25]
  );
  assert.equal(rows[0].label, "Part A - Personal Response");
  assert.equal(rows[2].label, "Part C1 - Video Comprehension");
  assert.deepEqual(rows[0].questionIds, ["1a", "1b"]);
  assert.deepEqual(rows[3].questionIds, ["4"]);

  // 75% on one of Part A's two 12.5-point halves.
  assert.equal(rows[0].pointsEarned, 9.38);
});

test("the part table totals 100 even when questions were never attempted", () => {
  // The regression this guards: dropping unattempted questions from the table
  // made a skipped Part C look like an exam marked out of 50, so a student who
  // answered nothing after Part B appeared to have passed.
  const rows = buildPartScores(examResultFixture());
  const possible = rows.reduce((s, r) => s + r.pointsPossible, 0);
  assert.equal(possible, 100);

  const unanswered = rows.filter((r) => r.pointsEarned === 0);
  assert.equal(unanswered.length, 3, "B, C1 and C2 were never attempted in the fixture");
});

test("Part B with two questions still collapses to a single 25-point row", () => {
  // 2023-format lessons split Part B into 2a and 2b. The row must not double.
  const result = examResultFixture({
    exam_layout: [
      { question_id: "2a", part: "B", points: 12.5, description: "Part B (a)" },
      { question_id: "2b", part: "B", points: 12.5, description: "Part B (b)" },
    ],
    question_results: [],
  });

  const rows = buildPartScores(result);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].part, "B");
  assert.equal(rows[0].pointsPossible, 25);
  assert.deepEqual(rows[0].questionIds, ["2a", "2b"]);
});

test("a question zeroed before rubric evaluation produces an empty breakdown, not a crash", () => {
  const result = examResultFixture();
  result.question_results[0].criterion_breakdown = [];
  result.question_results[0].raw_score = 0;
  result.question_results[0].final_question_score = 0;

  const report = buildReportObject(result, "");
  assert.deepEqual(report.questions[0].criterionBreakdown, []);
  assert.equal(report.questions[0].finalQuestionScore, 0);
});

test("suppressed flags and unattempted questions are carried in camelCase", () => {
  const result = examResultFixture({
    unattempted_questions: [
      { question_id: "4", description: "Part C (Q2)", points_forfeited: 25 },
    ],
  });
  result.question_results[0].suppressed_flags = [{ flag: "unintelligible", reason: "rubric disagreed" }];

  const report = buildReportObject(result, "");

  assert.deepEqual(report.unattemptedQuestions, [
    { questionId: "4", questionNumber: "4", description: "Part C (Q2)", pointsForfeited: 25 },
  ]);
  assert.equal(report.suppressedFlags[0].questionId, "1a");
  assert.equal(report.suppressedFlags[0].flag, "unintelligible");
});

test("the top-level score fields survive unchanged", () => {
  const report = buildReportObject(examResultFixture(), "Focus on developing answers.");
  assert.equal(report.overallScore, 61.5);
  assert.equal(report.pointsEarned, 61.5);
  assert.equal(report.pointsPossible, 100);
  assert.equal(report.teacherRecommendations, "Focus on developing answers.");
});

test("the Report Object matches the client's schema sheet field for field", () => {
  // The contract Speak2Go reads. Named keys, asserted explicitly, because the
  // failure mode is not an exception — it is a consumer quietly reading
  // undefined and rendering a blank report.
  const report = buildReportObject(examResultFixture(), "notes", { reportId: "exam_x" });

  assert.deepEqual(
    Object.keys(report).sort(),
    [
      "deductionsTable",
      "overallScore",
      "partScores",
      "pointsEarned",
      "pointsPossible",
      "questions",
      "suppressedFlags",
      "teacherRecommendations",
      "unattemptedQuestions",
    ],
    "top-level keys drifted from the schema sheet"
  );

  const q = report.questions[0];
  for (const key of [
    "questionId",
    "questionType",
    "typeDescription",
    "questionText",
    "videoTranscription",
    "weight",
    "rawScore",
    "deduction",
    "finalQuestionScore",
  ]) {
    assert.ok(key in q, `Question is missing the schema field "${key}"`);
  }

  // The deductions table uses the sheet's spelling too.
  const result = examResultFixture();
  result.question_results[0].deductions = [{ reason: "coverage", deductionPct: 20 }];
  const withDeduction = buildReportObject(result, "", { reportId: "exam_x" });
  assert.equal(withDeduction.deductionsTable[0].deduction, 20);
  assert.equal("deductionPct" in withDeduction.deductionsTable[0], false);
});
