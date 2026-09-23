/**
 * The number a question is shown under: "1.1", not "1a" and not a hash.
 * A letter suffix reads as a variant of one question rather than the first
 * of two choices.
 */

const { parseQuestionType } = require("../utils/questionType");

/** Part letter -> the section number a teacher sees. */
const SECTION_BY_PART = { A: 1, B: 2, C: 3 };

function questionNumber({ questionType, questionId }) {
  const parsed = parseQuestionType(questionType);

  if (parsed) {
    const section = SECTION_BY_PART[parsed.part];
    // Part C's two questions are numbered 3 and 4 — they are separate
    // sections to a teacher, not two halves of one.
    if (parsed.part === "C") return String(section + (parsed.index ?? 1) - 1);
    return parsed.index ? `${section}.${parsed.index}` : String(section);
  }

  // Our own ids: "1a" -> "1.1", "2b" -> "2.2", "3" -> "3".
  const m = String(questionId ?? "").match(/^(\d+)([a-z])?$/i);
  if (!m) return String(questionId ?? "");
  if (!m[2]) return m[1];
  const index = m[2].toLowerCase().charCodeAt(0) - 96; // a -> 1
  return `${m[1]}.${index}`;
}

module.exports = { questionNumber };
