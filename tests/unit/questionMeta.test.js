const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseQuestionMeta,
  groupQuestions,
  isTimeBasedDeductionQuestion,
} = require("../../src/utils/questionMeta");

test("parses group_id and sub_id from lettered question IDs", () => {
  assert.deepEqual(parseQuestionMeta({ question_id: "1a", description: "" }), { group_id: "1", sub_id: "a", part: null });
  assert.deepEqual(parseQuestionMeta({ question_id: "1b", description: "" }), { group_id: "1", sub_id: "b", part: null });
});

test("questions without a letter suffix have no sub_id and are their own group", () => {
  const meta = parseQuestionMeta({ question_id: "2", description: "" });
  assert.equal(meta.group_id, "2");
  assert.equal(meta.sub_id, null);
});

test("parses part (A/B/C) from the description field", () => {
  assert.equal(parseQuestionMeta({ question_id: "1a", description: "Part A - Spoken Production" }).part, "A");
  assert.equal(parseQuestionMeta({ question_id: "2", description: "PART B: Project Presentation" }).part, "B");
  assert.equal(parseQuestionMeta({ question_id: "4", description: "PART C - Comprehensive Response to a Video Clip" }).part, "C");
});

test("groups questions by group_id, preserving sub_id order", () => {
  const questions = [
    { question_id: "1b", description: "Part A" },
    { question_id: "2", description: "Part B" },
    { question_id: "1a", description: "Part A" },
  ];
  const groups = groupQuestions(questions);

  assert.equal(Object.keys(groups).length, 2);
  assert.equal(groups["1"].length, 2);
  assert.equal(groups["1"][0].question_id, "1a"); // sorted, even though input was 1b then 1a
  assert.equal(groups["1"][1].question_id, "1b");
  assert.equal(groups["2"].length, 1);
});

test("time-based deduction applies ONLY to Part B, question 2, COBE 4/5", () => {
  const q2PartB = { question_id: "2", description: "PART B: Project Presentation" };
  assert.equal(isTimeBasedDeductionQuestion(q2PartB, "5_UNITS_B2"), true);
  assert.equal(isTimeBasedDeductionQuestion(q2PartB, "4_UNITS_B1"), true);

  // Wrong part
  const q2PartA = { question_id: "2", description: "Part A - Spoken Production" };
  assert.equal(isTimeBasedDeductionQuestion(q2PartA, "5_UNITS_B2"), false);

  // Wrong question number
  const q3PartB = { question_id: "3", description: "PART B: Project Presentation" };
  assert.equal(isTimeBasedDeductionQuestion(q3PartB, "5_UNITS_B2"), false);

  // Unknown level — the time-based rule is COBE 4/5 point only
  assert.equal(isTimeBasedDeductionQuestion(q2PartB, "SOME_OTHER_LEVEL"), false);
});
