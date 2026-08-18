const test = require("node:test");
const assert = require("node:assert/strict");

const { buildStudentObject, buildExamObject, normalizeLevel } = require("../../server/specObjects");

/**
 * The Student and Exam objects are wire contracts: Speak2Go reads these keys
 * by name, so a rename is a breaking change even though nothing in this repo
 * would fail. These tests pin the field names for that reason.
 */

test("the student object uses the client's field names exactly", () => {
  const student = buildStudentObject({
    IDNumber: "123456789",
    FirstName: "Dana",
    LastName: "Levi",
    StudentGrade: "10",
    StudentMakbila: "3",
    SemelMosad: "440123",
    schoolName: "Sample High School",
  });

  assert.deepEqual(Object.keys(student).sort(), [
    "className",
    "fullName",
    "schoolId",
    "schoolName",
    "studentId",
  ]);

  // Renamed from gradeClass by the client on 13 Aug 2026.
  assert.equal(student.className, "10/3");
  assert.equal(student.fullName, "Dana Levi");
  assert.equal(student.schoolId, "440123");
});

test("the raw national ID never survives into the student object", () => {
  // The whole point of the hash: IDNumber is real PII and is indexed in the
  // client's database, so it must not travel with the grades.
  const raw = "123456789";
  const student = buildStudentObject({ IDNumber: raw, FirstName: "Dana", LastName: "Levi" });

  assert.equal(JSON.stringify(student).includes(raw), false);
  assert.match(student.studentId, /^[a-f0-9]{32,}$/, "studentId is a hex digest");
});

test("the same student always hashes to the same id", () => {
  // Without this the link between a student and their past reports breaks.
  const a = buildStudentObject({ IDNumber: "123456789" });
  const b = buildStudentObject({ IDNumber: "123456789" });
  const c = buildStudentObject({ IDNumber: "987654321" });

  assert.equal(a.studentId, b.studentId);
  assert.notEqual(a.studentId, c.studentId);
});

test("className falls back sensibly when the parallel class is missing", () => {
  assert.equal(buildStudentObject({ StudentGrade: "10" }).className, "10");
  assert.equal(buildStudentObject({ className: "Y10" }).className, "Y10");
  assert.equal(buildStudentObject({}).className, null);
});

test("the exam object carries the level in all three forms", () => {
  const exam = buildExamObject({ examId: "exam_abc", level: "5_UNITS_B2" });

  assert.equal(exam.level, "5_UNITS_B2");
  assert.equal(exam.cefrLevel, "B2");
  assert.equal(exam.levelLabel, "5 Points (COBE)");
});

test("the interim CEFR level codes are still accepted", () => {
  // The canonical spelling is Speak2Go's own (5_UNITS_B2). A draft of the spec
  // document briefly used a longer _CEFR_ form which this codebase emitted for
  // a day, so it is accepted inbound rather than rejected.
  assert.equal(normalizeLevel("5_UNITS_CEFR_B2"), "5_UNITS_B2");
  assert.equal(normalizeLevel("4_UNITS_CEFR_B1"), "4_UNITS_B1");
  assert.equal(normalizeLevel("5_UNITS_B2"), "5_UNITS_B2");
  // Anything unrecognised passes through untouched, to be rejected later by
  // the blueprint lookup with a message naming the known levels.
  assert.equal(normalizeLevel("3_UNITS_BOOST"), "3_UNITS_BOOST");
});
