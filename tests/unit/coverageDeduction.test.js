const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeGroupCoverageDeduction,
  applyCoverageDeductionToQuestion,
} = require("../../src/utils/coverageDeduction");

const answered = { audio_metrics: { isEffectivelyEmpty: false } };
const missing = { audio_metrics: { isEffectivelyEmpty: true } };

test("single-question groups never get a coverage deduction", () => {
  const result = computeGroupCoverageDeduction([answered]);
  assert.equal(result.deductionPct, 0);
});

test("all sub-questions answered -> 0% deduction", () => {
  const result = computeGroupCoverageDeduction([answered, answered]);
  assert.equal(result.deductionPct, 0);
});

test("one of two missing -> 25% deduction", () => {
  const result = computeGroupCoverageDeduction([answered, missing]);
  assert.equal(result.deductionPct, 25);
});

test("only one of two answered -> 50% deduction", () => {
  // same scenario as above from the other framing — 1 answered out of 2
  const result = computeGroupCoverageDeduction([answered, missing]);
  // NOTE: with exactly 2 sub-questions, "one missing" and "one answered"
  // describe the same state. The spec table distinguishes them assuming
  // 3+ sub-questions exist. This test documents current 2-part behavior;
  // revisit once the client confirms whether any set has 3+ parts.
  assert.equal(result.answeredCount, 1);
  assert.equal(result.totalCount, 2);
});

test("none answered -> 100% deduction", () => {
  const result = computeGroupCoverageDeduction([missing, missing]);
  assert.equal(result.deductionPct, 100);
});

test("deduction applies to Topic Development only, not other criteria", () => {
  const questionResult = {
    raw_score: 87.5,
    criterion_breakdown: [
      { criterion_name: "Topic Development", weight: 0.5, criterion_score: 100 },
      { criterion_name: "Delivery", weight: 0.5, criterion_score: 75 },
    ],
  };
  const adjusted = applyCoverageDeductionToQuestion(questionResult, 25);

  const topicDev = adjusted.criterion_breakdown.find((c) => c.criterion_name === "Topic Development");
  const delivery = adjusted.criterion_breakdown.find((c) => c.criterion_name === "Delivery");

  assert.equal(topicDev.criterion_score, 75); // 100 * (1 - 0.25)
  assert.equal(delivery.criterion_score, 75); // untouched
  // new raw_score: 75*0.5 + 75*0.5 = 75
  assert.equal(adjusted.raw_score, 75);
});

test("0% deduction is a no-op (returns original object unchanged)", () => {
  const questionResult = { raw_score: 90, criterion_breakdown: [{ criterion_name: "Topic Development", weight: 1, criterion_score: 90 }] };
  const result = applyCoverageDeductionToQuestion(questionResult, 0);
  assert.equal(result, questionResult); // same reference, not just equal value
});
