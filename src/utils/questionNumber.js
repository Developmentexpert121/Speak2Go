/**
 * The number a question is shown under in the report.
 *
 * The client asked on 19 Aug 2026 for "Q1.1" rather than "Q1a" — teachers read
 * the parts as numbered sections, and a letter suffix looks like a variant of
 * the same question rather than the second of two choices.
 *
 * Derived from questionType where present, because questionId is a hash and
 * carries nothing. Falls back to our own ids for the operator UI and the
 * lesson adapter, which still work from "1a" / "2" / "3".
 *
 *   a1 | 1a -> 1.1        b  | 2  -> 2
 *   a2 | 1b -> 1.2        b1 | 2a -> 2.1
 *   c1 | 3  -> 3          c2 | 4  -> 4
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
