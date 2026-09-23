const fs = require("fs");
const path = require("path");

const config = require("../config");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");

const MAIN = read("rubricScoring.txt");
const CONTEXT = read("rubricScoringContext.txt");
const REFERENCE = read("rubricScoringReference.txt");

const SCORING_SYSTEM =
  "You are a strict, consistent rubric-based exam evaluator. Always return valid JSON only.";

const fill = (template, values) =>
  Object.entries(values).reduce(
    (out, [key, value]) => out.split(`{{${key}}}`).join(value),
    template
  );

/**
 * Builds the rubric-scoring prompt.
 *
 * Prior answers in the same question set are supplied as read-only context and
 * the reference clip transcript only for Part C; both blocks are omitted
 * entirely when absent, rather than rendered as an empty heading the model
 * might try to fill.
 */
function buildRubricPrompt({
  questionText,
  transcript,
  audioMetrics,
  criteria,
  priorContext,
  referenceMaterial,
}) {
  const rubric = criteria.map((c) => ({
    criterion_name: c.criterion_name,
    sub_criteria: c.sub_criteria.map((sc) => ({
      id: sc.id,
      name: sc.name,
      levels: sc.levels,
    })),
  }));

  const contextBlock =
    priorContext && priorContext.length
      ? fill(CONTEXT, {
          PRIOR_ANSWERS: priorContext
            .map((p) => `Q${p.question_id} ("${p.question_text}"): """${p.transcript}"""`)
            .join("\n"),
        })
      : "";

  const referenceBlock = referenceMaterial
    ? fill(REFERENCE, { REFERENCE_MATERIAL: referenceMaterial })
    : "";

  return fill(MAIN, {
    QUESTION_TEXT: questionText,
    CONTEXT_BLOCK: contextBlock,
    REFERENCE_BLOCK: referenceBlock,
    TRANSCRIPT: transcript,
    WPM: audioMetrics.wpm,
    PAUSE_THRESHOLD: config.scoring.pauseThresholdSeconds,
    PAUSE_COUNT: audioMetrics.pauseCount,
    LONGEST_PAUSE: audioMetrics.longestPauseSeconds,
    FILLER_COUNT: audioMetrics.fillerWordCount,
    WORD_COUNT: audioMetrics.wordCount,
    FLUENCY_LABEL: audioMetrics.fluencyLabel,
    RUBRIC: JSON.stringify(rubric, null, 2),
  });
}

module.exports = { buildRubricPrompt, SCORING_SYSTEM };
