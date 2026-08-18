/**
 * The Exam and Student objects from spec section 3, built from the REAL
 * Speak2Go schema rather than from the spec's field names.
 *
 * The spec names fields that don't exist under those names in Mongo. A
 * read-only survey of `ezspeak-net` found every one of them already present,
 * just spelled differently and spread across three collections:
 *
 *   output field     real location
 *   --------------   ----------------------------------------------------
 *   studentId        users.IDNumber        (Israeli ID — indexed, real PII)
 *   fullName         users.FirstName + users.LastName
 *   className        users.StudentGrade + users.StudentMakbila,
 *                    or users.ClassID[] -> classes.grade / classes.name
 *   schoolId         users.SemelMosad     (also on clients.SemelMosad)
 *   schoolName       clients.Name, joined on SemelMosad
 *
 * So section 3.2 is a join, not a new data model. This module encodes that
 * mapping in one place so the rest of the app never touches raw Mongo names.
 *
 * ON CASING: the spec doc writes these fields in snake_case, but the client
 * asked (12 Aug 2026) for camelCase on the wire, so the doc's `full_name`
 * ships as `fullName`. The PascalCase names above are Speak2Go's own Mongo
 * columns and are INPUTS — they keep their original spelling.
 *
 * ON HASHING: the spec asks for the student id to be "anonymized/hashed for
 * privacy while maintaining 1:1 uniqueness". IDNumber is a national ID
 * number, so it must never reach a log, a report, or the LLM prompt. We
 * hash it with a salted SHA-256: deterministic (so the 1:1 mapping holds
 * across runs) but not reversible. The salt lives in the environment — if
 * it changes, previously-issued ids stop matching, which is why it is read
 * once at module load and warned about when missing.
 */

const crypto = require("crypto");

/**
 * Spec section 1: targeted CEFR proficiency levels.
 *
 * 3-point Boost (CEFR A2) is deliberately absent. The client confirmed on
 * 12 Aug 2026 that Boost is a different exam with different rubrics and is a
 * separate project, so it is out of scope here. An unknown level now falls
 * through to a null cefr_level rather than silently grading against a rubric
 * that was never written for it.
 */
const CEFR_BY_LEVEL = {
  "5_UNITS_B2": "B2",
  "4_UNITS_B1": "B1",
};

const LEVEL_LABEL = {
  "5_UNITS_B2": "5 Points (COBE)",
  "4_UNITS_B1": "4 Points (COBE)",
};

/**
 * Inbound level codes we accept besides the canonical ones.
 *
 * The canonical spelling is Speak2Go's: `5_UNITS_B2` / `4_UNITS_B1`, confirmed
 * by the client on 13 Aug 2026 and matching their schema sheet. An interim
 * draft of the spec document used a longer `..._CEFR_...` form and this
 * codebase followed it for a day, so those strings may still be baked into a
 * config somewhere on either side.
 *
 * Kept as a tolerant front door rather than a hard cut: rejecting an otherwise
 * valid exam over a spelling we ourselves once emitted would be a bad trade.
 * Everything downstream of normalizeLevel() sees only the canonical form.
 */
const LEVEL_ALIASES = {
  "5_UNITS_CEFR_B2": "5_UNITS_B2",
  "4_UNITS_CEFR_B1": "4_UNITS_B1",
};

function normalizeLevel(level) {
  const raw = String(level ?? "").trim();
  return LEVEL_ALIASES[raw] || raw;
}

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
  //
  // Named `className` on the way out: the client renamed the field on 13 Aug
  // 2026. The local variable keeps the old name to avoid shadowing anything
  // that reads like a DOM property.
  const grade = (src.StudentGrade ?? "").toString().trim();
  const makbila = (src.StudentMakbila ?? "").toString().trim();
  const gradeClass =
    grade && makbila ? `${grade}/${makbila}` : grade || src.className || src.grade_class || null;

  return {
    studentId: hashStudentId(src.IDNumber ?? src.studentIdRaw ?? src.student_id_raw),
    fullName,
    className: gradeClass,
    schoolName: src.schoolName ?? src.school_name ?? null,
    schoolId: (src.SemelMosad ?? src.schoolId ?? src.school_id ?? null) || null,
  };
}

/**
 * Spec section 3.1 Exam Object.
 *
 * `examLesson` deserves a note. The spec (section 2) says lessons "flagged
 * with the 'Exam' parameter are routed to the module", and 3.1 defines it
 * as a boolean on the lesson. That flag does not exist in
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
  const canonicalLevel = normalizeLevel(level);

  return {
    examLesson: examLessonFlag === undefined ? 1 : examLessonFlag,
    examLessonSource:
      examLessonSource || "assumed (flag absent in lessonDefinitions)",
    examId,
    name: name || null,
    description: description || null,
    level: canonicalLevel,
    levelLabel: LEVEL_LABEL[canonicalLevel] || canonicalLevel,
    cefrLevel: CEFR_BY_LEVEL[canonicalLevel] || null,
    dateExecuted: dateExecuted || new Date().toISOString(),
    finalScore,
    reportHtmlUrl,
    reportPdfUrl,
  };
}

module.exports = {
  CEFR_BY_LEVEL,
  LEVEL_LABEL,
  LEVEL_ALIASES,
  normalizeLevel,
  hashStudentId,
  buildStudentObject,
  buildExamObject,
};
