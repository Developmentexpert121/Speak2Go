/**
 * Phase-1 penalty layer: only the checks that are fully derivable from a
 * single question's audio/transcript. Cross-question rules (partial-answer
 * chart, Part B time-based deduction table) need the full exam context and
 * belong in a later "exam-level" aggregation step, not here.
 */
function applyPenalties({ rawScore, audioMetrics, transcript, contentFlags }) {
  const deductions = [];

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
  if (contentFlags?.foul_language) {
    deductions.push({ reason: `Foul language detected — ${contentFlags.flag_reasoning || "flagged by evaluator"}`, deductionPct: 100 });
  }
  if (contentFlags?.non_english) {
    deductions.push({ reason: `Answer not in English — ${contentFlags.flag_reasoning || "flagged by evaluator"}`, deductionPct: 100 });
  }
  if (contentFlags?.unintelligible) {
    deductions.push({ reason: `Unintelligible language — ${contentFlags.flag_reasoning || "flagged by evaluator"}`, deductionPct: 100 });
  }

  const totalDeductionPct = deductions.length
    ? Math.max(...deductions.map((d) => d.deductionPct)) // deductions are "0% for entire section", not additive
    : 0;

  const finalScore = Number((rawScore * (1 - totalDeductionPct / 100)).toFixed(2));

  return { finalScore, deductions };
}

module.exports = { applyPenalties };
