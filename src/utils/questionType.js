/**
 * Speak2Go's `questionType`, and what this pipeline needs to derive from it.
 *
 * WHY THIS EXISTS. Every structural rule here used to be driven by our own
 * question ids ("1a", "1b", "2", "3", "4") — the letter suffix grouped a
 * question set, and the id identified Part B for the time-based deduction.
 * The client confirmed on 13 Aug 2026 that `questionId` is a randomly
 * generated hash and that the semantic label is `questionType`. Against a
 * hash, id parsing yields nothing: every question falls into its own group,
 * Part B is never recognised, and two scoring rules silently stop firing.
 *
 * TOLERANT ON PURPOSE. The type values have been given to us two ways — the
 * schema sheet said "a" | "b" | "c1" | "c2", and the later message said "a1",
 * "a2", "b", "c". Rather than guess which is final, this accepts a letter with
 * an optional index, so every spelling in either list maps correctly. If a
 * third spelling appears it will either work or fail loudly, not quietly
 * mis-group an exam.
 *
 * GROUPING IS NOT JUST "SAME PART". Parts A and B group; Part C does not.
 *   - Part A is a choose-one group: the student answers one of two.
 *   - Part B is a set: 2023-format lessons split it into two questions that
 *     must BOTH be answered, so a missing half earns a coverage deduction.
 *   - Part C's two questions are independent, testing different things. Group
 *     them and the coverage rule fires on a student who answered both, which
 *     is exactly backwards.
 * Hence Part C questions each get their own group id.
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
