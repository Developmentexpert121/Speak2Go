/**
 * Speak2Go's `questionType` ("a1", "b", "c2") and the structure derived from
 * it. questionId is a hash, so nothing may be parsed out of it.
 *
 * Accepts a letter with an optional index, because the type values have been
 * specified two different ways and both must map correctly.
 *
 * Parts A and B group; Part C does not. See docs/scoring-rules.md.
 */

/** "a" / "a1" / "C2" / "b1" -> { part, index } ; anything else -> null */
function parseQuestionType(questionType) {
  const m = String(questionType ?? "").trim().match(/^([abc])\s*(\d*)$/i);
  if (!m) return null;
  return {
    part: m[1].toUpperCase(),
    index: m[2] === "" ? null : Number(m[2]),
  };
}

/** The part letter a questionType belongs to, or null if unrecognised. */
function partFromQuestionType(questionType) {
  return parseQuestionType(questionType)?.part ?? null;
}

/**
 * The group a question belongs to for the coverage rule and the choose-one
 * rule. Parts A and B collapse to one group; each Part C question stands
 * alone. Returns null when the type is unrecognised, so the caller can fall
 * back to id parsing rather than inventing a group.
 */
function groupIdFromQuestionType(questionType) {
  const parsed = parseQuestionType(questionType);
  if (!parsed) return null;
  if (parsed.part === "C") {
    // Distinct per question. Falls back to "C1" when no index is supplied so
    // that a lone untyped Part C question still gets a stable group of its own.
    return `C${parsed.index ?? 1}`;
  }
  return parsed.part;
}

module.exports = { parseQuestionType, partFromQuestionType, groupIdFromQuestionType };
