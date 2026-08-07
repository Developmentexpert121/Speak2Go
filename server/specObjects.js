/**
 * The Exam and Student objects from spec section 3, built from the REAL
 * Speak2Go schema rather than from the spec's field names.
 *
 * The spec names fields that don't exist under those names in Mongo. A
 * read-only survey of `ezspeak-net` found every one of them already present,
 * just spelled differently and spread across three collections:
 *
 *   spec 3.2 field   real location
 *   --------------   ----------------------------------------------------
 *   student_id       users.IDNumber        (Israeli ID — indexed, real PII)
 *   full_name        users.FirstName + users.LastName
 *   grade_class      users.StudentGrade + users.StudentMakbila,
 *                    or users.ClassID[] -> classes.grade / classes.name
 *   school_id        users.SemelMosad     (also on clients.SemelMosad)
 *   school_name      clients.Name, joined on SemelMosad
 *
 * So section 3.2 is a join, not a new data model. This module encodes that
 * mapping in one place so the rest of the app never touches raw Mongo names.
 *
 * ON HASHING: the spec asks for student_id to be "anonymized/hashed for
 * privacy while maintaining 1:1 uniqueness". IDNumber is a national ID
 * number, so it must never reach a log, a report, or the LLM prompt. We
 * hash it with a salted SHA-256: deterministic (so the 1:1 mapping holds
 * across runs) but not reversible. The salt lives in the environment — if
 * it changes, previously-issued ids stop matching, which is why it is read
 * once at module load and warned about when missing.
 */

const crypto = require("crypto");

/** Spec section 1: targeted CEFR proficiency levels. */
const CEFR_BY_LEVEL = {
  "5_UNITS_B2": "B2",
  "4_UNITS_B1": "B1",
  "3_UNITS_BOOST": "A2",
};

const LEVEL_LABEL = {
  "5_UNITS_B2": "5 Points (COBE)",
  "4_UNITS_B1": "4 Points (COBE)",
  "3_UNITS_BOOST": "3 Points (Boost)",
};

const ID_SALT = process.env.STUDENT_ID_SALT || "";
let warnedAboutSalt = false;

/**
 * Anonymize a student's national ID into a stable, non-reversible handle.
 *
 * Returns null for empty input rather than hashing the empty string, so a
 * missing ID stays visibly missing instead of becoming a plausible-looking
 * hash that silently collides with every other missing ID.
 */
function hashStudentId(idNumber) {
  const raw = String(idNumber ?? "").trim();
  if (!raw) return null;

  if (!ID_SALT && !warnedAboutSalt) {
    warnedAboutSalt = true;
    console.warn(
      "  WARNING: STUDENT_ID_SALT is not set. Student ids are being hashed " +
        "unsalted, which is brute-forceable for a 9-digit national ID. Set it in .env."
    );
  }
  return crypto.createHash("sha256").update(ID_SALT + raw).digest("hex").slice(0, 32);
}

/**
 * Spec section 3.2 Student Object.
 *
 * @param {object} src - a `users` document (or the subset of it the UI collected),
 *   optionally with `schoolName` resolved from `clients` and `className` from `classes`.
 */
function buildStudentObject(src = {}) {
  const first = (src.FirstName ?? src.firstName ?? "").trim();
  const last = (src.LastName ?? src.lastName ?? "").trim();
  const fullName = [first, last].filter(Boolean).join(" ") || (src.fullName ?? "").trim() || null;

  // StudentGrade is the year ("10"), StudentMakbila the parallel class ("3"),
  // giving the familiar "10/3". classes.grade ("Y10") is the fallback when the
  // student record carries a ClassID instead.
  const grade = (src.StudentGrade ?? "").toString().trim();
  const makbila = (src.StudentMakbila ?? "").toString().trim();
  const gradeClass =
    grade && makbila ? `${grade}/${makbila}` : grade || src.className || src.grade_class || null;

  return {
    student_id: hashStudentId(src.IDNumber ?? src.student_id_raw),
    full_name: fullName,
    grade_class: gradeClass,
    school_name: src.schoolName ?? src.school_name ?? null,
    school_id: (src.SemelMosad ?? src.school_id ?? null) || null,
  };
}

/**
 * Spec section 3.1 Exam Object.
 *
 * `exam_lesson` deserves a note. The spec (section 2) says lessons "flagged
 * with the 'Exam' parameter are routed to the module", and 3.1 defines
 * exam_lesson as a boolean on the lesson. That flag does not exist in
 * production: `exam`, `isExam`, `exam_lesson` and `examLesson` all match zero
 * documents in `lessonDefinitions`. Until Speak2Go adds it, anything reaching
 * this module was routed here deliberately, so we record `1` and mark the
 * source as "assumed" rather than inventing a value that looks authoritative.
 */
function buildExamObject({
  examId,
  name,
  description,
  level,
  dateExecuted,
  finalScore = null,
  reportHtmlUrl = null,
  reportPdfUrl = null,
  examLessonFlag,
  examLessonSource,
}) {
  return {
    exam_lesson: examLessonFlag === undefined ? 1 : examLessonFlag,
    exam_lesson_source:
      examLessonSource || "assumed (flag absent in lessonDefinitions)",
    exam_id: examId,
    name: name || null,
    description: description || null,
    level,
    level_label: LEVEL_LABEL[level] || level,
    cefr_level: CEFR_BY_LEVEL[level] || null,
    date_executed: dateExecuted || new Date().toISOString(),
    final_score: finalScore,
    report_html_url: reportHtmlUrl,
    report_pdf_url: reportPdfUrl,
  };
}

module.exports = {
  CEFR_BY_LEVEL,
  LEVEL_LABEL,
  hashStudentId,
  buildStudentObject,
  buildExamObject,
};
