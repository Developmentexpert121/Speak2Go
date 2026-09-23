/**
 * Penalties derivable from one question's own audio and transcript.
 * Cross-question rules need the full exam and live in the evaluation service.
 */

/**
 * Ceiling above which an `unintelligible` flag is not honoured.
 *
 * 39.5 is the midpoint between the rubric's bottom two levels (25 and 54), so
 * a raw score at or above it means the rubric placed the answer nearer
 * "partially adequate" than "bottom band" — which contradicts a claim that it
 * could not be understood at all. The rubric wins: it is a weighted average
 * of a dozen judgements, the flag is one boolean.
 *
 * See docs/scoring-rules.md for the bug this fixed.
 */
const UNINTELLIGIBLE_RAW_SCORE_CEILING = 39.5;

function applyPenalties({ rawScore, audioMetrics, transcript, contentFlags }) {
  const deductions = [];
  const suppressed = [];

  if (audioMetrics.isEffectivelyEmpty) {
    deductions.push({ reason: "Empty file", deductionPct: 100 });
  } else if (audioMetrics.isUnder20Seconds) {
    deductions.push({ reason: "Answer under 20 seconds of speech", deductionPct: 100 });
  }

  // Content flags come from the LLM's read of the transcript (see
  // llmScoring.js's content_flags output) — the scoring model already reads
  // every transcript, so it's a more reliable detector than a keyword list,
  // especially for "unintelligible" and "non-English" which aren't
  // reasonably catchable with regex at all.
  //
  // foul_language and non_english are OBSERVATIONS, independent of answer
  // quality: an excellent answer containing a slur is still disqualified, and
  // a fluent answer given in Hebrew is still not an English exam. They are
  // honoured at any score. `unintelligible` is a JUDGEMENT that overlaps what
  // the rubric already measures, so it alone is cross-checked below.
  if (contentFlags?.foul_language) {
    deductions.push({ reason: `Foul language detected — ${contentFlags.flag_reasoning || "flagged by evaluator"}`, deductionPct: 100 });
  }
  if (contentFlags?.non_english) {
    deductions.push({ reason: `Answer not in English — ${contentFlags.flag_reasoning || "flagged by evaluator"}`, deductionPct: 100 });
  }
  if (contentFlags?.unintelligible) {
    if (rawScore < UNINTELLIGIBLE_RAW_SCORE_CEILING) {
      deductions.push({ reason: `Unintelligible language — ${contentFlags.flag_reasoning || "flagged by evaluator"}`, deductionPct: 100 });
    } else {
      // Not silently dropped. A grade that was nearly zeroed is exactly the
      // kind of thing a teacher appealing a result needs to see, so the
      // disagreement is recorded on the result and surfaced in the report.
      suppressed.push({
        flag: "unintelligible",
        reason: contentFlags.flag_reasoning || "flagged by evaluator",
        rawScore,
        ceiling: UNINTELLIGIBLE_RAW_SCORE_CEILING,
        explanation:
          `The evaluator flagged this answer as unintelligible, but the rubric scored it ` +
          `${rawScore}, at or above the ${UNINTELLIGIBLE_RAW_SCORE_CEILING} bottom-band ceiling. ` +
          `The flag was not applied; the rubric score stands.`,
      });
    }
  }

  const totalDeductionPct = deductions.length
    ? Math.max(...deductions.map((d) => d.deductionPct)) // deductions are "0% for entire section", not additive
    : 0;

  const finalScore = Number((rawScore * (1 - totalDeductionPct / 100)).toFixed(2));

  return { finalScore, deductions, suppressedFlags: suppressed };
}

module.exports = { applyPenalties, UNINTELLIGIBLE_RAW_SCORE_CEILING };
