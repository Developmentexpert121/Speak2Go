const { evaluateQuestion } = require("./evaluateExam");
const { groupQuestions, isTimeBasedDeductionQuestion } = require("../utils/questionMeta");
const { computeGroupCoverageDeduction, applyCoverageDeductionToQuestion } = require("../utils/coverageDeduction");
const { computeTimeBasedDeduction } = require("../utils/timeBasedDeduction");
const {
  getBlueprint,
  getExamTotalPoints,
  getBlueprintEntry,
  sumBlueprintPoints,
  CHOICE_PARTS,
} = require("../config/examBlueprint");
const { partFromQuestionType } = require("../utils/questionType");

/**
 * The choice group a question belongs to, or null. Read from the layout when
 * one was supplied, otherwise from the blueprint for the level.
 *
 * Part A is the only one today: the student is shown two questions and answers
 * one, so the two share a single 25-point allocation rather than holding 12.5
 * each. See CHOICE_PARTS in examBlueprint.js.
 */
function choiceGroupFor(question, level, examLayout) {
  // questionType first, for the same reason as everywhere else: against a
  // hashed questionId the layout and blueprint lookups below both miss, and a
  // missed choice group is not a soft failure — both Part A answers would be
  // counted and Part A would be marked out of 50.
  const type = question.questionType ?? question.question_type ?? null;
  const typedPart = partFromQuestionType(type);
  if (typedPart) return CHOICE_PARTS.has(typedPart) ? typedPart : null;

  const questionId = question.question_id;
  const fromLayout = (examLayout || []).find(
    (bp) => String(bp.question_id) === String(questionId)
  );
  if (fromLayout) return fromLayout.choice_group || null;
  return getBlueprintEntry(level, questionId)?.choice_group || null;
}

/**
 * Evaluates an entire exam as a unit, so that cross-question rules — the
 * 1a/1b coverage chart and the Part B time-based deduction — can be applied
 * correctly.
 *
 * SCORING MODEL: `weight` is an absolute point value, and the exam is always
 * marked out of the blueprint total (100), never out of "whatever was
 * submitted". A question the student didn't attempt contributes 0 points
 * rather than being dropped from the denominator.
 *
 * @param {object} params
 * @param {Array} params.questions - [{ question_id, description, part,
 *   question_text, weight, audioFilePath }, ...]
 * @param {"5_UNITS_B2"|"4_UNITS_B1"} params.level
 * @param {number} [params.examTotalPoints] - override the blueprint total;
 *   only for partial/practice exams that are genuinely marked out of less
 * @param {Array} [params.examLayout] - the full slot list this exam should
 *   have had, as returned by examBlueprint.inspectLesson().layout. Needed to
 *   report unattempted questions correctly, because Part B is one question in
 *   the 2019-2022 lessons and two in the 2023 ones — the default blueprint
 *   would otherwise report "2" as unattempted on a 2023 exam where the
 *   student answered 2a and 2b.
 */
async function evaluateFullExam({ questions, level, examTotalPoints, examLayout, onProgress }) {
  assertWeightsAreUsable(questions, level);

  // Optional progress reporting. A full exam is ~5 STT + ~5 LLM calls and can
  // run for several minutes, so any UI driving this needs to know where it is.
  // No-op when the caller supplies nothing, so existing callers are unaffected.
  const emit = typeof onProgress === "function" ? onProgress : () => {};
  let completed = 0;

  const totalPoints = examTotalPoints ?? getExamTotalPoints(level);
  const groups = groupQuestions(questions, level); // { "1": [1a, 1b], "2": [2], ... }
  // Numeric where the ids are our own ("1", "2", "3"), lexicographic where
  // they come from questionType ("A", "B", "C1"). A bare Number() subtraction
  // yields NaN on the latter, and a NaN comparator leaves the order undefined —
  // which would make the prior-answer context a question sees depend on object
  // key order rather than on the exam.
  const orderedGroupIds = Object.keys(groups).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });

  const resultsByQuestionId = {};

  // 1. Evaluate every question, passing prior-in-group answers as context
  for (const groupId of orderedGroupIds) {
    const groupList = groups[groupId];
    const priorContext = [];

    for (const q of groupList) {
      emit({
        stage: "evaluating",
        question_id: q.question_id,
        completed,
        total: questions.length,
      });

      const result = await evaluateQuestion({
        audioFilePath: q.audioFilePath,
        questionText: q.question_text,
        level,
        priorContext: priorContext.length ? [...priorContext] : undefined,
        // For Part C questions this is the transcript of the clip the student
        // just watched; null for Parts A/B (ignored by evaluateQuestion).
        referenceMaterial: q.referenceMaterial ?? null,
      });

      resultsByQuestionId[q.question_id] = {
        ...result,
        question_id: q.question_id,
        group_id: groupId,
        // Speak2Go's semantic label ("a1", "b", "c2"). Carried because
        // questionId is a hash: every structural rule downstream reads this.
        question_type: q.questionType ?? q.question_type ?? null,
        part: q.part ?? null,
        weight: q.weight,
        description: q.description,
        // The S3 object key of the student's recording, as supplied by
        // Speak2Go. A key rather than a URL because the recordings bucket is
        // private: we read it with GetObjectCommand the same way their own app
        // does. Carried through so the report can echo it.
        audio_file_key: q.audioFileKey ?? q.audio_file_key ?? null,
      };

      priorContext.push({
        question_id: q.question_id,
        question_text: q.question_text,
        transcript: result.transcript,
      });

      completed += 1;
      emit({
        stage: "question_done",
        question_id: q.question_id,
        completed,
        total: questions.length,
      });
    }
  }

  // 2. Apply the coverage (partial-answer) deduction per group, to Topic
  //    Development only, on every question in that group
  for (const groupId of orderedGroupIds) {
    const groupList = groups[groupId].map((q) => resultsByQuestionId[q.question_id]);
    if (groupList.length <= 1) continue;

    // A choose-one part is exempt. The coverage rule exists for sets where
    // every sub-question is required; on Part A the student is told to answer
    // one of two, so answering one is compliance. Deducting for it would
    // penalise the student for following the instructions — and because the
    // deduction lands on Topic Development, which is half the grade, it is
    // easily the largest silent scoring error in this file.
    if (groupList.some((r) => choiceGroupFor(r, level, examLayout))) continue;

    const { deductionPct, answeredCount, totalCount } = computeGroupCoverageDeduction(groupList);
    if (deductionPct === 0) continue;

    for (const q of groupList) {
      const adjusted = applyCoverageDeductionToQuestion(q, deductionPct);
      resultsByQuestionId[q.question_id] = {
        ...adjusted,
        coverage_note: `${answeredCount}/${totalCount} sub-questions answered in set ${groupId} — ${deductionPct}% deduction applied to Topic Development`,
      };
    }
  }

  // 3. Apply the Part B time-based deduction where applicable
  for (const q of questions) {
    if (!isTimeBasedDeductionQuestion(q, level)) continue;
    const result = resultsByQuestionId[q.question_id];
    const duration = result.audio_metrics.totalDurationSeconds;
    const { deductionPct, band } = computeTimeBasedDeduction(duration);

    if (deductionPct > 0) {
      result.deductions.push({
        reason: `Part B/Project time-based rule: answer length in band ${band}`,
        deductionPct,
      });
    }
  }

  // 4. Recompute final_question_score from (possibly updated) raw_score +
  //    the full deductions list for every question, taking the worst
  //    applicable deduction (deductions in this spec don't stack additively)
  for (const id of Object.keys(resultsByQuestionId)) {
    const r = resultsByQuestionId[id];
    const worstDeductionPct = r.deductions.length
      ? Math.max(...r.deductions.map((d) => d.deductionPct))
      : 0;
    r.final_question_score = Number((r.raw_score * (1 - worstDeductionPct / 100)).toFixed(2));
  }

  // 5. Exam-level overall score.
  //
  //    Each question converts its 0-100 rubric score into the points it is
  //    worth, and the exam is marked out of the FULL blueprint total. A
  //    question that was never attempted simply earns 0 of its points — it
  //    does not shrink the denominator. (Previously the denominator was the
  //    sum of submitted weights, so skipping Part C entirely produced a
  //    perfect 100 instead of a 50.)
  const allResults = Object.values(resultsByQuestionId);

  // Points for one answer, if it is the one that counts.
  const pointsFor = (r) => (r.final_question_score / 100) * r.weight;

  // On a choose-one part only the BEST answer scores. Both are still returned
  // and still carry a full breakdown — the client asked for feedback on both —
  // but the loser contributes nothing to the grade, so they are marked rather
  // than quietly added in. Ties keep the first, which is arbitrary but stable.
  const bestByChoiceGroup = {};
  for (const r of allResults) {
    const group = choiceGroupFor(r, level, examLayout);
    r.choice_group = group;
    if (!group) {
      r.counts_toward_final = true;
      continue;
    }
    const current = bestByChoiceGroup[group];
    if (!current || pointsFor(r) > pointsFor(current)) bestByChoiceGroup[group] = r;
  }
  for (const r of allResults) {
    if (r.choice_group) r.counts_toward_final = bestByChoiceGroup[r.choice_group] === r;
  }

  const pointsEarned = allResults
    .filter((r) => r.counts_toward_final)
    .reduce((sum, r) => sum + pointsFor(r), 0);
  const overallScore = totalPoints > 0 ? (pointsEarned / totalPoints) * 100 : 0;

  const layout = (examLayout || getBlueprint(level)).map((bp) => ({
    question_id: bp.question_id,
    part: bp.part,
    points: bp.points,
    choice_group: bp.choice_group || null,
    description: bp.description,
  }));

  const attemptedIds = new Set(allResults.map((r) => String(r.question_id)));

  // A choose-one group forfeits its points only when NOTHING in it was
  // answered. Listing the unchosen Part A question as "not attempted, 25
  // points forfeited" would be wrong twice over: the student was never meant
  // to answer it, and the 25 points were not lost — they were earned on the
  // other one.
  const answeredChoiceGroups = new Set(
    allResults.map((r) => r.choice_group).filter(Boolean)
  );
  const seenForfeitedGroups = new Set();

  const unattempted = layout
    .filter((bp) => !attemptedIds.has(String(bp.question_id)))
    .filter((bp) => {
      if (!bp.choice_group) return true;
      if (answeredChoiceGroups.has(bp.choice_group)) return false;
      // Whole group missing: report it once, not once per offered question.
      if (seenForfeitedGroups.has(bp.choice_group)) return false;
      seenForfeitedGroups.add(bp.choice_group);
      return true;
    })
    .map((bp) => ({
      question_id: bp.question_id,
      description: bp.choice_group
        ? `${bp.description} (no Part ${bp.part} question answered)`
        : bp.description,
      points_forfeited: bp.points,
    }));

  return {
    level,
    overall_score: Number(overallScore.toFixed(2)),
    points_earned: Number(pointsEarned.toFixed(2)),
    points_possible: totalPoints,
    // The slot list this exam was marked against — the report renderer needs
    // it to lay out a 2023-format exam, whose Part B has two questions
    exam_layout: layout,
    unattempted_questions: unattempted,
    question_results: allResults.sort((a, b) => String(a.question_id).localeCompare(String(b.question_id))),
  };
}

/**
 * Fails loudly on weight configurations that used to produce silently wrong
 * totals — most notably a missing `weight`, which the old code substituted
 * with 1 in the numerator while omitting it from the denominator, allowing
 * overall_score to exceed 100.
 */
function assertWeightsAreUsable(questions, level) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("evaluateFullExam: `questions` must be a non-empty array");
  }

  const missing = questions.filter(
    (q) => typeof q.weight !== "number" || !Number.isFinite(q.weight) || q.weight < 0
  );
  if (missing.length) {
    throw new Error(
      `evaluateFullExam: every question needs a numeric \`weight\` (points). Missing or invalid on: ` +
        missing.map((q) => q.question_id).join(", ")
    );
  }

  const ids = questions.map((q) => String(q.question_id));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    throw new Error(`evaluateFullExam: duplicate question_id(s): ${[...new Set(dupes)].join(", ")}`);
  }

  // Counted through sumBlueprintPoints so a choose-one group counts once.
  // Summing raw weights would total 125 for a full exam — both Part A
  // questions carry 25 — and reject a perfectly valid submission.
  const submitted = sumBlueprintPoints(
    questions.map((q) => ({
      points: q.weight,
      choice_group: choiceGroupFor(q, level, null),
    }))
  );
  const blueprintTotal = getExamTotalPoints(level);
  if (submitted > blueprintTotal + 1e-9) {
    throw new Error(
      `evaluateFullExam: submitted question weights total ${submitted}, which exceeds the ` +
        `${blueprintTotal}-point exam total for ${level}. Weights are absolute points, not fractions.`
    );
  }
}

module.exports = { evaluateFullExam };
