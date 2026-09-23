const { getReferenceMaterial } = require("../db/referenceMaterialRepository");

/**
 * The canonical shape of a COBE exam, and the adapter that recovers it from a
 * raw Speak2Go lesson record.
 *
 * Two things depend on this file: that an exam is always marked out of 100,
 * and that parts are recovered from the autoplay separator clips rather than
 * from question counts or hardcoded order values — both earlier approaches
 * silently dropped questions. See docs/scoring-rules.md.
 */

/** Ministry point allocation per part. Always totals 100. */
const PART_POINTS = { A: 25, B: 25, C: 50 };

/**
 * Parts where the student answers ONE of the questions offered. Each carries
 * the full part points, and the coverage deduction must not fire on them.
 * Both rules silently change grades if broken — docs/scoring-rules.md.
 */
const CHOICE_PARTS = new Set(["A"]);

/**
 * Total points a layout is marked out of, counting each choice group once.
 * Use this rather than summing `points`, which double-counts Part A.
 */
function sumBlueprintPoints(layout) {
  const seenGroups = new Set();
  return (layout || []).reduce((sum, bp) => {
    if (bp.choice_group) {
      if (seenGroups.has(bp.choice_group)) return sum;
      seenGroups.add(bp.choice_group);
    }
    return sum + bp.points;
  }, 0);
}

/**
 * The common layout: 2 + 1 + 2 questions. Kept as the default blueprint for
 * callers that aren't working from a lesson record (tests, manual runs, the
 * unattempted-question list when no layout is supplied).
 */

const COBE_BLUEPRINT = [
  // 25 each, not 12.5: the student answers one of the two and it is worth the
  // whole of Part A. choice_group keeps them from being added together.
  { question_id: "1a", part: "A", points: 25, choice_group: "A", description: "Part A - Spoken Production, Personal Response (Q1)" },
  { question_id: "1b", part: "A", points: 25, choice_group: "A", description: "Part A - Spoken Production, Personal Response (Q2)" },
  { question_id: "2",  part: "B", points: 25,   description: "Part B - Project Presentation" },
  { question_id: "3",  part: "C", points: 25,   description: "Part C - Audio-Visual Response (Q1)" },
  { question_id: "4",  part: "C", points: 25,   description: "Part C - Audio-Visual Response (Q2)" },
];

const BLUEPRINTS = {
  "5_UNITS_B2": COBE_BLUEPRINT,
  "4_UNITS_B1": COBE_BLUEPRINT,
};

/**
 * Slots per part, keyed by how many questions that part contains. The ids are
 * not cosmetic — the letter suffix groups a question set. Part C's two are
 * independent and get plain ids.
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
 * Splits a lesson into Parts A / B / C by the position of the autoplay
 * separator clips. Matching hardcoded `order` values or counting questions
 * both silently dropped questions on real lessons — docs/scoring-rules.md.
 *
 * @returns {{ A: Array, B: Array, C: Array } | null} null when the lesson has
 *   no part separators, i.e. it is not an exam.
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
    // On a choose-one part every question carries the full part points,
    // because whichever the student answers is worth all of them.
    const isChoice = CHOICE_PARTS.has(part);
    const points = isChoice ? PART_POINTS[part] : PART_POINTS[part] / found.length;
    slots.forEach(([question_id, description], i) => {
      layout.push({
        question_id,
        part,
        points,
        description,
        source: found[i],
        ...(isChoice ? { choice_group: part } : {}),
      });
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
 * Adapts a raw Speak2Go lesson questionList into the question array the
 * evaluation service expects.
 *
 * A question with no recording is kept with audioFilePath = null so it counts
 * as unanswered rather than vanishing. Throws when the lesson is not a
 * gradeable exam — mapping a practice lesson onto 5 slots would discard
 * answers and mislabel the rest.
 *
 * @param {Array} questionList - raw questions from the lesson document
 * @param {object} audioByIdDetection - { [ID_detection]: "<path or URL>" }
 * @param {string} level
 * @param {object} [options]
 * @param {string} [options.lessonName] - improves the error message only
 * @param {object} [options.referenceMaterialByIdDetection] - pre-fetched Part C
 *   transcripts; otherwise use mapLessonToExamQuestionsAsync
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
    // Carried through so the scorer knows Part A is a choose-one group; without
    // it the two 25-point questions are added together and Part A is marked
    // out of 50.
    choice_group: slot.choice_group || null,
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
    // Carried through so the scorer knows Part A is a choose-one group; without
    // it the two 25-point questions are added together and Part A is marked
    // out of 50.
    choice_group: slot.choice_group || null,
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
  CHOICE_PARTS,
  sumBlueprintPoints,
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
