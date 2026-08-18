const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");

const {
  parseQuestionType,
  partFromQuestionType,
  groupIdFromQuestionType,
} = require(path.join(SRC, "utils", "questionType.js"));

/**
 * Speak2Go's questionId is a randomly generated hash (client, 13 Aug 2026),
 * so `questionType` is the only thing carrying structure. These tests exist
 * because the failure mode is invisible: against a hash the old id-parsing
 * silently put every question in its own group, which switches off the Part B
 * time rule and turns Part A into two separately-counted 25-point questions.
 *
 * The type values have been supplied two ways — the schema sheet said
 * "a" | "b" | "c1" | "c2", the later message said "a1", "a2", "b", "c" — so
 * both spellings are covered until the client settles on one.
 */

test("both spellings of the type list map to the right part", () => {
  for (const t of ["a", "a1", "a2", "A1"]) {
    assert.equal(partFromQuestionType(t), "A", t);
  }
  for (const t of ["b", "b1", "b2", "B"]) {
    assert.equal(partFromQuestionType(t), "B", t);
  }
  for (const t of ["c", "c1", "c2", "C2"]) {
    assert.equal(partFromQuestionType(t), "C", t);
  }
});

test("an unrecognised type yields null rather than a wrong guess", () => {
  for (const t of ["", null, undefined, "d1", "part a", "1a", "xyz"]) {
    assert.equal(partFromQuestionType(t), null, String(t));
    assert.equal(groupIdFromQuestionType(t), null, String(t));
  }
  assert.equal(parseQuestionType("a1").index, 1);
  assert.equal(parseQuestionType("b").index, null);
});

test("Parts A and B group together; Part C questions do not", () => {
  // Part A: one choose-one group. Part B: one set, both halves required.
  assert.equal(groupIdFromQuestionType("a1"), groupIdFromQuestionType("a2"));
  assert.equal(groupIdFromQuestionType("b1"), groupIdFromQuestionType("b2"));

  // Part C's two questions are independent and test different things.
  // Grouping them would fire the coverage rule on a student who answered
  // BOTH — exactly backwards.
  assert.notEqual(groupIdFromQuestionType("c1"), groupIdFromQuestionType("c2"));
});
