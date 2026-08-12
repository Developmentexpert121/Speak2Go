const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { saveExamResult, getExamResult, listExams } = require("../../src/storage/fileStore");

const TEST_EXAM_ID = "test-exam-unit-" + Date.now();

test("save then get returns the same record", async () => {
  await saveExamResult(TEST_EXAM_ID, { studentId: "s1", level: "5_UNITS_CEFR_B2", examResult: { overall_score: 88 } });
  const loaded = await getExamResult(TEST_EXAM_ID);

  assert.equal(loaded.examId, TEST_EXAM_ID);
  assert.equal(loaded.studentId, "s1");
  assert.equal(loaded.examResult.overall_score, 88);
  assert.ok(loaded.savedAt);
});

test("getExamResult returns null for an unknown id", async () => {
  const loaded = await getExamResult("does-not-exist-xyz");
  assert.equal(loaded, null);
});

test("listExams filters by studentId", async () => {
  await saveExamResult(TEST_EXAM_ID + "-b", { studentId: "s2", level: "5_UNITS_CEFR_B2", examResult: {} });
  const forS1 = await listExams({ studentId: "s1" });
  assert.ok(forS1.some((r) => r.examId === TEST_EXAM_ID));
  assert.ok(!forS1.some((r) => r.studentId === "s2"));
});

test.after(() => {
  // cleanup test fixtures so repeated runs don't pile up files
  const dir = path.join(__dirname, "..", "..", "data", "exams");
  [TEST_EXAM_ID, TEST_EXAM_ID + "-b"].forEach((id) => {
    const fp = path.join(dir, `${id}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
});
