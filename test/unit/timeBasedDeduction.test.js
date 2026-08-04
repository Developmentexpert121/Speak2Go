const test = require("node:test");
const assert = require("node:assert/strict");
const { computeTimeBasedDeduction } = require("../../src/utils/timeBasedDeduction");

test("1:00-2:00 -> full credit", () => {
  assert.equal(computeTimeBasedDeduction(60).deductionPct, 0);
  assert.equal(computeTimeBasedDeduction(90).deductionPct, 0);
  assert.equal(computeTimeBasedDeduction(120).deductionPct, 0);
});

test("0:40-0:59 -> 20% deduction", () => {
  assert.equal(computeTimeBasedDeduction(40).deductionPct, 20);
  assert.equal(computeTimeBasedDeduction(59).deductionPct, 20);
});

test("0:20-0:39 -> 50% deduction", () => {
  assert.equal(computeTimeBasedDeduction(20).deductionPct, 50);
  assert.equal(computeTimeBasedDeduction(39).deductionPct, 50);
});

test("below 0:20 -> 100% deduction", () => {
  assert.equal(computeTimeBasedDeduction(0).deductionPct, 100);
  assert.equal(computeTimeBasedDeduction(19).deductionPct, 100);
});

test("over 2:00 does NOT get zeroed (regression test for a fixed bug)", () => {
  // Originally fell through to the 100%-deduction catch-all branch, which
  // would have zeroed a long, complete answer. Fixed to treat >2:00 as
  // full credit, since the spec only defines a lower time bound. Flag to
  // client if an upper-bound penalty should actually exist.
  const result = computeTimeBasedDeduction(150);
  assert.equal(result.deductionPct, 0);
});
