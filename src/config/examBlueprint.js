const { getReferenceMaterial } = require("../storage/referenceMaterialStore");

/**
 * The canonical shape of a COBE exam, and the adapter that recovers that shape
 * from a raw Speak2Go lesson record.
 *
 * This is the single source of truth for two things the rest of the pipeline
 * previously had to guess at:
 *
 *  1. THE DENOMINATOR. An exam is always out of 100 points, whether or not the
 *     student actually submitted every question. Without this, a skipped
 *     question silently disappears from the weighted average instead of
 *     costing the student its points.
 *
 *  2. THE MAPPING FROM PLATFORM DATA. Speak2Go lesson records carry no
 *     "question_id" and no "Part A/B/C" label — only an `order` number and an
 *     `answerType`. We recover the parts from the AUTOPLAY SEPARATOR VIDEOS
 *     that sit between them. See segmentLesson() for why that beats the two
 *     approaches tried before it.
 *
 * Point split follows the Ministry spec: Part A 25, Part B 25, Part C 50,
 * divided evenly between the questions actually present in each part.
 */

/** Ministry point allocation per part. Always totals 100. */
const PART_POINTS = { A: 25, B: 25, C: 50 };

/**
 * The common layout: 2 + 1 + 2 questions. Kept as the default blueprint for
 * callers that aren't working from a lesson record (tests, manual runs, the
 * unattempted-question list when no layout is supplied).
 */

const COBE_BLUEPRINT = [
  { question_id: "1a", part: "A", points: 12.5, description: "Part A - Spoken Production, Personal Response (Q1)" },
  { question_id: "1b", part: "A", points: 12.5, description: "Part A - Spoken Production, Personal Response (Q2)" },
  { question_id: "2",  part: "B", points: 25,   description: "Part B - Project Presentation" },
  { question_id: "3",  part: "C", points: 25,   description: "Part C - Audio-Visual Response (Q1)" },
  { question_id: "4",  part: "C", points: 25,   description: "Part C - Audio-Visual Response (Q2)" },
];

const BLUEPRINTS = {
  "5_UNITS_B2": COBE_BLUEPRINT,
  "4_UNITS_B1": COBE_BLUEPRINT,
};

/**
 * Question ids and descriptions per part, keyed by how many questions that
 * part contains. Ids are not cosmetic: questionMeta.parseQuestionMeta() reads
 * the "1a"/"1b" letter suffix to group a question SET, which is what triggers
 * the partial-coverage deduction. Part A's two questions and Part B's two
 * questions (2023 layout) are sets; Part C's two are independent questions
 * scored separately, so they get plain ids.
 */
const PART_SLOTS = {
  A: {
    2: [
      ["1a", "Part A - Spoken Production, Personal Response (Q1)"],
      ["1b", "Part A - Spoken Production, Personal Response (Q2)"],
    ],
  },
  B: {
    1: [["2", "Part B - Project Presentation"]],
    2: [
      ["2a", "Part B - Project Presentation (Q1)"],
      ["2b", "Part B - Project Presentation (Q2)"],
    ],
  },
  C: {
    2: [
      ["3", "Part C - Audio-Visual Response (Q1)"],
      ["4", "Part C - Audio-Visual Response (Q2)"],
    ],
  },
};

/**
 * Matched against the text of the NON-free (autoplay) entries, which are
 * Alfie's narration clips. "Let's move on to Part B o.f the exam" and the
 * Part C intro clip are what physically separate the parts in the lesson.
 */
const PART_SEPARATOR_PATTERNS = { B: /\bpart\s*b\b/i, C: /\bpart\s*c\b/i };

function getBlueprint(level) {
  const bp = BLUEPRINTS[level];
  if (!bp) {
    throw new Error(
      `No exam blueprint for level "${level}". Known: ${Object.keys(BLUEPRINTS).join(", ")}`
    );
  }
  return bp;
}

/**
 * Total points an exam is marked out of. Always 100, NOT the total of
 * whatever the student happened to submit.
 */
function getExamTotalPoints(level) {
  getBlueprint(level); // validates the level
  return PART_POINTS.A + PART_POINTS.B + PART_POINTS.C;
}

function getBlueprintEntry(level, questionId) {
  return getBlueprint(level).find((q) => q.question_id === String(questionId)) || null;
}

function getFreeSpeechQuestions(questionList) {
  return (questionList || [])
    .filter((q) => q && q.answerType === "free")
    .slice()
    .sort((a, b) => Number(a.order) - Number(b.order));
}

/**
 * Splits a lesson's free-speech questions into Parts A / B / C using the
 * positions of the autoplay separator clips.
 *
 * WHY THIS AND NOT SOMETHING SIMPLER — two earlier approaches were tried
 * against all 123 COBE lessons in the dev database and both were wrong:
 *
 *   a) Matching hardcoded `order` values (7, 8, 20, 70, 85). Derived from a
 *      sample of 5 lessons. Three real exams use different numbers —
 *      [7,9,20,70,85] and [7,9,20,90,97] ("MATKONET 3: Tuesday 2020 COBE") —
 *      so this dropped Q2 from three exams and both Part C questions (50
 *      points) from MATKONET 3, silently scoring them as unattempted.
 *
 *   b) Mapping the 5 free-speech questions by ordinal position, gated on a
 *      "5 questions AND question 3 mentions your project" check. Correct for
 *      the 29 lessons using the 2+1+2 layout, but it rejected the four 2023
 *      exams outright: those use a 2+2+2 layout with a genuine two-question
 *      Part B, which no fixed count can express.
 *
 * Separator-based segmentation gets both layouts, and additionally excludes
 * the 88 topic/practice lessons ("Pets & Animals", "Music") that have no part
 * structure at all — several of which have exactly 5 free-speech questions and
 * are otherwise indistinguishable from an exam.
 *
 * @returns {{ A: Array, B: Array, C: Array } | null} null if the lesson has no
 *   part separators, i.e. it is not an exam.
 */
function segmentLesson(questionList) {
  const sorted = (questionList || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => Number(a.order) - Number(b.order));

  const narration = sorted.filter((q) => q.answerType !== "free");
  const findSep = (re) => narration.find((q) => re.test(String(q.text || "")));

  const bSep = findSep(PART_SEPARATOR_PATTERNS.B);
  const cSep = findSep(PART_SEPARATOR_PATTERNS.C);
  if (!bSep || !cSep) return null;

  const free = sorted.filter((q) => q.answerType === "free");
  return {
    A: free.filter((q) => Number(q.order) < Number(bSep.order)),
    B: free.filter((q) => Number(q.order) > Number(bSep.order) && Number(q.order) < Number(cSep.order)),
    C: free.filter((q) => Number(q.order) > Number(cSep.order)),
  };
}

/**
 * Decides whether a lesson is a gradeable COBE exam, and says why not when it
 * isn't. Practice lessons share the exam's data shape, so this guard is what
 * stops the pipeline producing an official-looking 100-point report card for
 * someone's "Pets & Animals" practice session.
 *
 * @returns {{ isFullExam: boolean, reasons: string[], layout: Array|null,
 *             segmentation: object|null, shape: string|null }}
 */
function inspectLesson(questionList, lessonName = "", level = "5_UNITS_B2") {
  getBlueprint(level); // validates the level
  const segmentation = segmentLesson(questionList);

  if (!segmentation) {
    return {
      isFullExam: false,
      reasons: ["no Part B / Part C separator clips — this is a practice lesson, not an exam"],
      layout: null,
      segmentation: null,
      shape: null,
    };
  }

  const shape = `A${segmentation.A.length}/B${segmentation.B.length}/C${segmentation.C.length}`;
  const reasons = [];
  const layout = [];

  for (const part of ["A", "B", "C"]) {
    const found = segmentation[part];
    const slots = PART_SLOTS[part][found.length];
    if (!slots) {
      reasons.push(
        `Part ${part} has ${found.length} question(s); supported: ` +
          `${Object.keys(PART_SLOTS[part]).join(" or ")}`
      );
      continue;
    }
    const points = PART_POINTS[part] / found.length;
    slots.forEach(([question_id, description], i) => {
      layout.push({ question_id, part, points, description, source: found[i] });
    });
  }

  return {
    isFullExam: reasons.length === 0,
    reasons,
    layout: reasons.length === 0 ? layout : null,
    segmentation,
    shape,
  };
}

function isFullExamLesson(questionList, lessonName = "", level = "5_UNITS_B2") {
  return inspectLesson(questionList, lessonName, level).isFullExam;
}

/**
 * Adapts a raw Speak2Go lesson `questionList` (from
 * lessonDefinitions.phases.Conversation.questionList) into the question array
 * evaluateFullExam() expects.
 *
 * A question with no matching recording is kept with audioFilePath = null so
 * it still counts as unanswered against the exam total rather than vanishing.
 *
 * Throws if the lesson isn't a gradeable exam: mapping a 7-question practice
 * lesson onto 5 slots would silently discard two answers and mislabel the
 * rest, which is worse than refusing.
 *
 * @param {Array} questionList - raw questions from the lesson document
 * @param {object} audioByIdDetection - { [ID_detection]: "<local path or URL>" }
 * @param {string} level
 * @param {object} [options]
 * @param {string} [options.lessonName] - only used to improve the error message
 * @param {object} [options.referenceMaterialByIdDetection] - pre-fetched map of
 *   { [ID_detection]: transcriptString } for Part C clips.  When supplied the
 *   sync function can attach it directly; otherwise call the async variant
 *   `mapLessonToExamQuestionsAsync` which does the store lookups itself.
 */
function mapLessonToExamQuestions(
  questionList,
  audioByIdDetection = {},
  level = "5_UNITS_B2",
  options = {}
) {
  const lessonName = options.lessonName || "";
  const refMaterialMap = options.referenceMaterialByIdDetection || {};
  const { isFullExam, reasons, layout } = inspectLesson(questionList, lessonName, level);

  if (!isFullExam) {
    throw new Error(
      `Lesson${lessonName ? ` "${lessonName}"` : ""} is not a gradeable ` +
        `${level} exam: ${reasons.join("; ")}`
    );
  }

  return layout.map((slot) => ({
    question_id: slot.question_id,
    description: slot.description,
    part: slot.part,
    weight: slot.points,
    question_text: String(slot.source.text || "").trim(),
    id_detection: slot.source.ID_detection,
    audioFilePath: audioByIdDetection[slot.source.ID_detection] || null,
    // referenceMaterial is only relevant for Part C questions (the clip the
    // student watches before answering).  For other parts it's null / undefined
    // and the evaluator ignores it.
    referenceMaterial: refMaterialMap[slot.source.ID_detection] ?? null,
  }));
}

/**
 * Async variant of mapLessonToExamQuestions that looks up the Part C
 * reference-material transcripts from the store automatically, keyed by
 * each slot's ID_detection.
 *
 * Use this in production where you can await; use the sync form only when
 * you have already pre-fetched the transcripts yourself (e.g. in tests).
 *
 * @param {Array} questionList
 * @param {object} audioByIdDetection
 * @param {string} level
 * @param {object} [options] - same as mapLessonToExamQuestions, minus
 *   referenceMaterialByIdDetection (that is fetched here automatically)
 * @returns {Promise<Array>}
 */
async function mapLessonToExamQuestionsAsync(
  questionList,
  audioByIdDetection = {},
  level = "5_UNITS_B2",
  options = {}
) {
  const lessonName = options.lessonName || "";
  const { isFullExam, reasons, layout } = inspectLesson(questionList, lessonName, level);

  if (!isFullExam) {
    throw new Error(
      `Lesson${lessonName ? ` "${lessonName}"` : ""} is not a gradeable ` +
        `${level} exam: ${reasons.join("; ")}`
    );
  }

  // Look up reference material concurrently for every Part C slot.
  const partCIds = layout
    .filter((s) => s.part === "C")
    .map((s) => s.source.ID_detection)
    .filter(Boolean);

  const refEntries = await Promise.all(
    partCIds.map(async (id) => [id, await getReferenceMaterial(id)])
  );
  const refMaterialMap = Object.fromEntries(refEntries);

  return layout.map((slot) => ({
    question_id: slot.question_id,
    description: slot.description,
    part: slot.part,
    weight: slot.points,
    question_text: String(slot.source.text || "").trim(),
    id_detection: slot.source.ID_detection,
    audioFilePath: audioByIdDetection[slot.source.ID_detection] || null,
    referenceMaterial: refMaterialMap[slot.source.ID_detection] ?? null,
  }));
}

module.exports = {
  COBE_BLUEPRINT,
  PART_POINTS,
  PART_SLOTS,
  getBlueprint,
  getExamTotalPoints,
  getBlueprintEntry,
  getFreeSpeechQuestions,
  segmentLesson,
  inspectLesson,
  isFullExamLesson,
  mapLessonToExamQuestions,
  mapLessonToExamQuestionsAsync,
};
