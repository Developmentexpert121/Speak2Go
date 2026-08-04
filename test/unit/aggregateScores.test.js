const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregateQuestionScore } = require("../../src/utils/aggregateScores");

const SAMPLE_CRITERIA = [
  {
    criterion_name: "Topic Development",
    weight: 0.5,
    sub_criteria: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
  },
  {
    criterion_name: "Delivery",
    weight: 0.5,
    sub_criteria: [{ id: "c", name: "C" }],
  },
];

test("simple average within a criterion, weighted average across criteria", () => {
  const llmScores = [
    { id: "a", selected_level: 100 },
    { id: "b", selected_level: 50 },
    { id: "c", selected_level: 100 },
  ];
  const result = aggregateQuestionScore(SAMPLE_CRITERIA, llmScores);

  // Topic Development: (100+50)/2 = 75
  assert.equal(result.criterion_breakdown[0].criterion_score, 75);
  // Delivery: 100
  assert.equal(result.criterion_breakdown[1].criterion_score, 100);
  // Raw score: 75*0.5 + 100*0.5 = 87.5
  assert.equal(result.raw_score, 87.5);
});

test("all-zero scores produce a zero raw score, not NaN", () => {
  const llmScores = [
    { id: "a", selected_level: 0 },
    { id: "b", selected_level: 0 },
    { id: "c", selected_level: 0 },
  ];
  const result = aggregateQuestionScore(SAMPLE_CRITERIA, llmScores);
  assert.equal(result.raw_score, 0);
});

test("throws clearly when the LLM omits a sub-criterion (fail loud, not silent)", () => {
  const incompleteScores = [
    { id: "a", selected_level: 100 },
    // "b" missing
    { id: "c", selected_level: 100 },
  ];
  assert.throws(
    () => aggregateQuestionScore(SAMPLE_CRITERIA, incompleteScores),
    /Missing LLM score for sub-criterion b/
  );
});
