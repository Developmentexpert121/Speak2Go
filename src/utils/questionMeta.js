const { getBlueprint, getBlueprintEntry } = require("../config/examBlueprint");
const { partFromQuestionType, groupIdFromQuestionType } = require("./questionType");

/**
 * Derives structural metadata from a Question Object:
 *  - group_id: which question "set" this belongs to (1a & 1b -> group "1")
 *  - sub_id: the letter suffix, if any ("a", "b", or null)
 *  - part: A / B / C
 *
 * `part` is resolved in priority order:
 *   1. Speak2Go's `questionType` ("a1", "b", "c2"...), which is the only one
 *      of these that survives a randomly-generated questionId.
 *   2. An explicit `part` field (what mapLessonToExamQuestions supplies).
 *   3. Parsing the `description` string — the original behaviour.
 *   4. The exam blueprint, looked up by question_id.
 *
 * questionType leads because the client confirmed on 13 Aug 2026 that
 * questionId is a hash carrying no structure. Steps 2-4 remain for the
 * operator UI and the lesson-record adapter, which both work from our own ids.
 */
function parseQuestionMeta(question, level) {
  const questionType = question.questionType ?? question.question_type ?? null;
  const typedPart = partFromQuestionType(questionType);
  const typedGroup = groupIdFromQuestionType(questionType);

  const idMatch = String(question.question_id).match(/^(\d+)([a-z]?)$/i);
  const group_id = typedGroup || (idMatch ? idMatch[1] : String(question.question_id));
  const sub_id = idMatch && idMatch[2] ? idMatch[2].toLowerCase() : null;

  let part = typedPart || question.part || null;

  if (!part) {
    const desc = (question.description || "").toUpperCase();
    if (desc.includes("PART A")) part = "A";
    else if (desc.includes("PART B")) part = "B";
    else if (desc.includes("PART C")) part = "C";
  }

  if (!part && level) {
    const bp = getBlueprintEntry(level, question.question_id);
    if (bp) part = bp.part;
  }

  return { group_id, sub_id, part };
}

/**
 * Groups a flat list of questions by group_id, preserving submission order
 * within each group (sub_id alphabetical, or array order if no sub_id).
 */
function groupQuestions(questions, level) {
  const withMeta = questions.map((q) => ({ ...q, ...parseQuestionMeta(q, level) }));

  const groups = {};
  for (const q of withMeta) {
    if (!groups[q.group_id]) groups[q.group_id] = [];
    groups[q.group_id].push(q);
  }

  Object.values(groups).forEach((group) => {
    group.sort((a, b) => (a.sub_id || "").localeCompare(b.sub_id || ""));
  });

  return groups; // { "1": [q1a, q1b], "2": [q2], "3": [q3], ... }
}

/**
 * Whether this question is subject to the Part B/Project time-based
 * deduction table (spec section 4.C): EXCLUSIVELY the Part B project
 * question, in COBE 4 & 5 point levels.
 *
 * The question is checked against the blueprint's Part B GROUP rather than a
 * hardcoded id "2". Group is the right granularity because Part B has two
 * shapes in production: a single question with id "2" (2019-2022 lessons) and
 * a two-question set with ids "2a"/"2b" (2023 lessons). Both parse to
 * group_id "2", so one check covers both; matching on the full id would have
 * silently skipped the time deduction on every 2023-format exam.
 */
function isTimeBasedDeductionQuestion(question, level) {
  const isEligibleLevel = level === "5_UNITS_B2" || level === "4_UNITS_B1";
  if (!isEligibleLevel) return false;

  const { part, group_id } = parseQuestionMeta(question, level);
  if (part !== "B") return false;

  // When Speak2Go supplied a questionType, part === "B" already settles it:
  // the type IS the authority on which part a question belongs to, and the
  // blueprint cross-check below would compare "B" against our own ids ("2")
  // and never match — silently disabling this deduction on every live exam.
  if (question.questionType ?? question.question_type) return true;

  const partBGroups = new Set(
    getBlueprint(level)
      .filter((q) => q.part === "B")
      .map((q) => parseQuestionMeta({ question_id: q.question_id }).group_id)
  );

  return partBGroups.has(group_id);
}

module.exports = { parseQuestionMeta, groupQuestions, isTimeBasedDeductionQuestion };
