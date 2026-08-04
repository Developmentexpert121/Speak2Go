const rubrics = require("../config/rubrics.json");
const { transcribeAudioFile } = require("../services/sttService");
const { computeAudioMetrics } = require("../services/audioMetrics");
const { scoreQuestionAgainstRubric } = require("../services/llmScoring");
const { aggregateQuestionScore } = require("../utils/aggregateScores");
const { applyPenalties } = require("../utils/applyPenalties");

/**
 * Evaluates a single exam question end-to-end:
 * audio -> transcript + metrics -> LLM rubric scoring -> aggregation -> penalties
 *
 * @param {object} params
 * @param {string} params.audioFilePath - local path to the student's audio answer
 * @param {string} params.questionText - the question text asked
 * @param {"5_UNITS_B2"|"4_UNITS_B1"} params.level - which rubric to use
 */
async function evaluateQuestion({ audioFilePath, questionText, level, priorContext }) {
  const rubric = rubrics[level];
  if (!rubric) {
    throw new Error(`Unknown level "${level}". Available: ${Object.keys(rubrics).join(", ")}`);
  }

  // 1. Speech-to-text. A null/empty path means the student never submitted
  //    anything for this question — treat it as an empty answer rather than
  //    letting the STT call throw, so the exam can still be scored as a whole.
  const sttResult = audioFilePath
    ? await transcribeAudioFile(audioFilePath)
    : { transcript: "", words: [], durationSeconds: 0, confidence: 0, utterances: [] };

  // 2. Audio metrics (pauses, WPM, fluency level, filler words)
  const audioMetrics = computeAudioMetrics(sttResult);

  // 3. LLM rubric scoring (skip the LLM call entirely for empty/too-short answers —
  //    no point spending tokens on an automatic 0)
  let contentFlags = { foul_language: false, non_english: false, unintelligible: false, flag_reasoning: "" };
  let questionResult;

  if (audioMetrics.isEffectivelyEmpty || audioMetrics.isUnder20Seconds) {
    questionResult = { criterion_breakdown: [], raw_score: 0 };
  } else {
    const llmResult = await scoreQuestionAgainstRubric({
      questionText,
      transcript: sttResult.transcript,
      audioMetrics,
      criteria: rubric.criteria,
      priorContext,
    });
    contentFlags = llmResult.contentFlags;

    // 4. Deterministic aggregation (sub-criteria -> criterion -> raw question score)
    questionResult = aggregateQuestionScore(rubric.criteria, llmResult.subCriteriaScores);
  }

  // 5. Penalty layer (deterministic business rules, separate from the LLM —
  //    content_flags come FROM the LLM's read of the transcript, but the
  //    100%-deduction decision itself stays a deterministic rule here)
  const { finalScore, deductions } = applyPenalties({
    rawScore: questionResult.raw_score,
    audioMetrics,
    transcript: sttResult.transcript,
    contentFlags,
  });

  return {
    level,
    cefr_level: rubric.cefr_level,
    question_text: questionText,
    transcript: sttResult.transcript,
    audio_metrics: audioMetrics,
    criterion_breakdown: questionResult.criterion_breakdown,
    raw_score: questionResult.raw_score,
    deductions,
    final_question_score: finalScore,
  };
}

module.exports = { evaluateQuestion };
