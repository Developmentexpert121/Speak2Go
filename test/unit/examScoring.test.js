const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");

// Stub the two paid services before evaluateFullExam pulls them in, so this
// suite exercises the scoring maths with zero API calls.
function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const ALL_SUB_CRITERIA = [
  "sc1_relevancy", "sc2_prompt_understanding", "sc3_answer_logic", "sc4_answer_development",
  "sc5_speech_quality", "sc6_fluency", "sc7_vocabulary_range", "sc8_correct_grammar", "sc9_english_only",
];

function words(count, durationSeconds) {
  const step = durationSeconds / count;
  return Array.from({ length: count }, (_, i) => ({
    word: "word", punctuated_word: "word", start: i * step, end: i * step + step * 0.8,
  }));
}

const AUDIO = {
  "perfect.wav": { transcript: "a ".repeat(150), words: words(150, 90), durationSeconds: 90, confidence: 0.95 },
  "empty.wav": { transcript: "", words: [], durationSeconds: 0, confidence: 0 },
};

stub(path.join(SRC, "services", "sttService.js"), {
  transcribeAudioFile: async (p) => AUDIO[p],
});
stub(path.join(SRC, "services", "llmScoring.js"), {
  scoreQuestionAgainstRubric: async () => ({
    subCriteriaScores: ALL_SUB_CRITERIA.map((id) => ({ id, selected_level: 100, justification: "stub" })),
    contentFlags: { foul_language: false, non_english: false, unintelligible: false, flag_reasoning: "" },
  }),
});

const { evaluateFullExam } = require(path.join(SRC, "pipeline", "evaluateFullExam.js"));
const {
  getExamTotalPoints,
  mapLessonToExamQuestions,
  isFullExamLesson,
  sumBlueprintPoints,
} = require(path.join(SRC, "config", "examBlueprint.js"));

/**
 * A lesson `questionList` in the shape the dev database actually stores: no
 * question_id, no description, no weight — just `order` and `answerType`, with
 * Alfie's narration clips (`autoplay`) interleaved among the student-answered
 * questions. The "Let's move on to Part B" and "Part C Introduction" clips are
 * the separators the parser segments on, so they have to be here.
 *
 * `orders` sets the order values of the free-speech questions per part, so a
 * test can reproduce the variants seen across real exams. Separators are
 * placed automatically in the gaps between parts.
 */
function lessonQuestionList({ a = [7, 8], b = [20], c = [70, 85] } = {}) {
  const TEXTS = {
    a: [
      "This is Q1 where you can select an answer by free speech",
      "intro to Q2 to choose to answer in free speech?",
    ],
    b: [
      "Tell me briefly about your project. What you were hoping to learn from it.",
      "What new information did you learn from doing your project?",
    ],
    c: ["First quesiton in Part C.", "This is second question for part C."],
  };
  // A single-question Part B is the 25-point project question outright
  const bTexts = b.length === 1 ? ["The 25 point question about your project."] : TEXTS.b;

  const free = (orders, texts, prefix) =>
    orders.map((order, i) => ({
      order,
      answerType: "free",
      ID_detection: `det-${prefix}${i}`,
      text: texts[i],
    }));

  return [
    { order: Math.min(...a) - 1, answerType: "autoplay", ID_detection: "intro", text: "I'm going to ask you questions" },
    ...free(a, TEXTS.a, "a"),
    { order: (Math.max(...a) + Math.min(...b)) / 2, answerType: "autoplay", ID_detection: "sep-b", text: "Let's move on to Part B o.f the exam" },
    ...free(b, bTexts, "b"),
    { order: (Math.max(...b) + Math.min(...c)) / 2, answerType: "autoplay", ID_detection: "sep-c", text: "The intro video to Part C of the test" },
    { order: Math.min(...c) - 0.5, answerType: "autoplay", ID_detection: "clip", text: "The full length video for part C" },
    ...free(c, TEXTS.c, "c"),
    { order: Math.max(...c) + 1, answerType: "autoplay", ID_detection: "outro", text: "Closing sentence from Alfie." },
  ];
}

const PART_A_ONLY = [
  { question_id: "1a", part: "A", description: "Part A", question_text: "q", weight: 25, audioFilePath: "perfect.wav" },
  { question_id: "1b", part: "A", description: "Part A", question_text: "q", weight: 25, audioFilePath: "perfect.wav" },
];

test("the exam is marked out of 100, not out of what was submitted", async () => {
  // A perfect Part A and nothing else is 25 of the 100 available points.
  // The old code renormalized over submitted weights and returned 100.
  const result = await evaluateFullExam({ questions: PART_A_ONLY, level: "5_UNITS_CEFR_B2" });
  assert.equal(result.overall_score, 25);
  assert.equal(result.points_earned, 25);
  assert.equal(result.points_possible, 100);
});

test("skipping a question scores the same as submitting it empty", async () => {
  const submittedEmpty = [
    ...PART_A_ONLY,
    { question_id: "2", part: "B", description: "Part B", question_text: "q", weight: 25, audioFilePath: "empty.wav" },
    { question_id: "3", part: "C", description: "Part C", question_text: "q", weight: 25, audioFilePath: "empty.wav" },
    { question_id: "4", part: "C", description: "Part C", question_text: "q", weight: 25, audioFilePath: "empty.wav" },
  ];

  const skipped = await evaluateFullExam({ questions: PART_A_ONLY, level: "5_UNITS_CEFR_B2" });
  const empty = await evaluateFullExam({ questions: submittedEmpty, level: "5_UNITS_CEFR_B2" });

  assert.equal(skipped.overall_score, empty.overall_score);
});

test("unattempted questions are reported with the points they forfeited", async () => {
  const result = await evaluateFullExam({ questions: PART_A_ONLY, level: "5_UNITS_CEFR_B2" });
  assert.deepEqual(
    result.unattempted_questions.map((q) => [q.question_id, q.points_forfeited]),
    [["2", 25], ["3", 25], ["4", 25]]
  );
});

test("a full perfect exam scores exactly 100", async () => {
  const questions = [
    ...PART_A_ONLY,
    { question_id: "2", part: "B", description: "Part B", question_text: "q", weight: 25, audioFilePath: "perfect.wav" },
    { question_id: "3", part: "C", description: "Part C", question_text: "q", weight: 25, audioFilePath: "perfect.wav" },
    { question_id: "4", part: "C", description: "Part C", question_text: "q", weight: 25, audioFilePath: "perfect.wav" },
  ];
  const result = await evaluateFullExam({ questions, level: "5_UNITS_CEFR_B2" });
  assert.equal(result.overall_score, 100);
});

test("overall_score can never exceed 100 — a missing weight throws instead", async () => {
  const questions = [
    { question_id: "1a", part: "A", description: "Part A", question_text: "q", weight: 25, audioFilePath: "perfect.wav" },
    { question_id: "2", part: "B", description: "Part B", question_text: "q", audioFilePath: "perfect.wav" }, // no weight
  ];
  await assert.rejects(
    () => evaluateFullExam({ questions, level: "5_UNITS_CEFR_B2" }),
    /every question needs a numeric `weight`/
  );
});

test("weights totalling more than the exam total are rejected", async () => {
  const questions = [
    { question_id: "1a", part: "A", description: "Part A", question_text: "q", weight: 60, audioFilePath: "perfect.wav" },
    { question_id: "2", part: "B", description: "Part B", question_text: "q", weight: 60, audioFilePath: "perfect.wav" },
  ];
  await assert.rejects(
    () => evaluateFullExam({ questions, level: "5_UNITS_CEFR_B2" }),
    /exceeds the 100-point exam total/
  );
});

test("duplicate question ids are rejected", async () => {
  const questions = [
    { question_id: "1a", part: "A", description: "Part A", question_text: "q", weight: 25, audioFilePath: "perfect.wav" },
    { question_id: "1a", part: "A", description: "Part A", question_text: "q", weight: 25, audioFilePath: "perfect.wav" },
  ];
  await assert.rejects(() => evaluateFullExam({ questions, level: "5_UNITS_CEFR_B2" }), /duplicate question_id/);
});

test("blueprint totals 100 points for both COBE levels", () => {
  assert.equal(getExamTotalPoints("5_UNITS_CEFR_B2"), 100);
  assert.equal(getExamTotalPoints("4_UNITS_CEFR_B1"), 100);
});

test("maps a real Speak2Go lesson questionList onto the exam blueprint", () => {
  // questionList of "Simulation 1, 2019, COBE FP" verbatim from the dev
  // database — note there is no question_id, description or weight, and the
  // free-speech questions are outnumbered by Alfie's narration clips.
  const lessonQuestions = [
    { order: 2,   answerType: "autoplay", ID_detection: "a2",  text: "Part A what is this about" },
    { order: 3,   answerType: "autoplay", ID_detection: "a3",  text: "I'm going to ask you questions" },
    { order: 7,   answerType: "free",     ID_detection: "f7",  text: "This is Q1 where you can select an answer by free speech" },
    { order: 8,   answerType: "free",     ID_detection: "f8",  text: "intro to Q2 to choose to answer in free speech?" },
    { order: 10,  answerType: "autoplay", ID_detection: "a10", text: "Let's move on to Part B o.f the exam" },
    { order: 15,  answerType: "autoplay", ID_detection: "a15", text: "And now, Part B intro" },
    { order: 20,  answerType: "free",     ID_detection: "f20", text: "The 25 point question about your project." },
    { order: 50,  answerType: "autoplay", ID_detection: "a50", text: "The intro video to Part C of the test" },
    { order: 55,  answerType: "autoplay", ID_detection: "a55", text: "Part C Introduction" },
    { order: 65,  answerType: "autoplay", ID_detection: "a65", text: "The full length video for part C" },
    { order: 67,  answerType: "autoplay", ID_detection: "a67", text: "intro Q1" },
    { order: 70,  answerType: "free",     ID_detection: "f70", text: "First quesiton in Part C." },
    { order: 80,  answerType: "autoplay", ID_detection: "a80", text: "This is the introduction to Q2 from the audio visual section" },
    { order: 85,  answerType: "free",     ID_detection: "f85", text: "This is second question for part C." },
    { order: 100, answerType: "autoplay", ID_detection: "a100", text: "Closing sentence from Alfie." },
  ];

  const mapped = mapLessonToExamQuestions(lessonQuestions, { f20: "/tmp/partB.mp3" }, "5_UNITS_CEFR_B2");

  assert.deepEqual(mapped.map((q) => q.question_id), ["1a", "1b", "2", "3", "4"]);
  assert.deepEqual(mapped.map((q) => q.part), ["A", "A", "B", "C", "C"]);
  // Part A's two questions carry 25 each, not 12.5: the student answers one
  // of them and it is worth the whole of Part A.
  assert.deepEqual(mapped.map((q) => q.weight), [25, 25, 25, 25, 25]);
  // Which is why the total is taken through sumBlueprintPoints — a plain sum
  // of the weights is 125 and would mark the exam out of the wrong number.
  assert.equal(sumBlueprintPoints(mapped.map((q) => ({ points: q.weight, choice_group: q.choice_group }))), 100);

  const partB = mapped.find((q) => q.question_id === "2");
  assert.equal(partB.audioFilePath, "/tmp/partB.mp3");
  assert.equal(partB.question_text, "The 25 point question about your project.");

  // Questions with no recording survive as unattempted rather than vanishing
  assert.equal(mapped.find((q) => q.question_id === "1a").audioFilePath, null);
});

test("the Part B time deduction fires on mapped live data (no description field)", () => {
  const { isTimeBasedDeductionQuestion } = require(path.join(SRC, "utils", "questionMeta.js"));
  const [partB] = mapLessonToExamQuestions(lessonQuestionList(), {}, "5_UNITS_CEFR_B2")
    .filter((q) => q.part === "B");

  assert.equal(partB.description.includes("Part B"), true);
  assert.equal(isTimeBasedDeductionQuestion(partB, "5_UNITS_CEFR_B2"), true);
});

// The `order` values are NOT the same in every real exam. Of the 29 lessons in
// the dev database using this layout, 26 are [7,8,20,70,85], two are
// [7,9,20,70,85] and one ("MATKONET 3: Tuesday 2020 COBE") is [7,9,20,90,97].
// Matching on literal order numbers dropped Q2 from three exams and both Part
// C questions (50 points) from MATKONET 3, scoring them as unattempted.
test("maps exams whose order values differ from the common signature", () => {
  const variants = [
    { a: [7, 9], b: [20], c: [70, 85] },
    { a: [7, 9], b: [20], c: [90, 97] },
    { a: [1, 2], b: [3], c: [4, 5] },
  ];

  for (const orders of variants) {
    const mapped = mapLessonToExamQuestions(lessonQuestionList(orders), {}, "5_UNITS_CEFR_B2");
    const label = JSON.stringify(orders);

    assert.deepEqual(mapped.map((q) => q.question_id), ["1a", "1b", "2", "3", "4"], label);
    assert.equal(
      sumBlueprintPoints(mapped.map((q) => ({ points: q.weight, choice_group: q.choice_group }))),
      100,
      label
    );
    // every slot resolved to a real question, none left blank
    assert.equal(mapped.every((q) => q.id_detection && q.question_text), true, label);
  }
});

// The 2023 simulations use a two-question Part B ("Tell me briefly about your
// project" + "What new information did you learn from doing your project?").
// A fixed 5-slot blueprint cannot express this and rejected these exams
// outright.
test("maps the 2023 layout, where Part B is a two-question set", () => {
  const mapped = mapLessonToExamQuestions(
    lessonQuestionList({ a: [1, 3], b: [6, 7], c: [10, 11] }),
    {},
    "5_UNITS_CEFR_B2",
    { lessonName: "Simulation A 2023 COBE FP" }
  );

  assert.deepEqual(mapped.map((q) => q.question_id), ["1a", "1b", "2a", "2b", "3", "4"]);
  assert.deepEqual(mapped.map((q) => q.part), ["A", "A", "B", "B", "C", "C"]);
  // Part B is still worth 25 in total, split between its two questions —
  // unlike Part A, both of Part B's questions must be answered. Part A's two
  // carry 25 each because only one of them counts.
  assert.deepEqual(mapped.map((q) => q.weight), [25, 25, 12.5, 12.5, 25, 25]);
  assert.equal(sumBlueprintPoints(mapped.map((q) => ({ points: q.weight, choice_group: q.choice_group }))), 100);
});

test("2023 Part B questions form one group and keep the time deduction", () => {
  const { groupQuestions, isTimeBasedDeductionQuestion } = require(path.join(SRC, "utils", "questionMeta.js"));
  const mapped = mapLessonToExamQuestions(
    lessonQuestionList({ a: [1, 3], b: [6, 7], c: [10, 11] }),
    {},
    "5_UNITS_CEFR_B2"
  );

  // 2a and 2b must land in the same group, or the partial-coverage deduction
  // never fires for a student who answers only one of them
  const groups = groupQuestions(mapped, "5_UNITS_CEFR_B2");
  assert.deepEqual(groups["2"].map((q) => q.question_id), ["2a", "2b"]);

  for (const q of mapped.filter((x) => x.part === "B")) {
    assert.equal(isTimeBasedDeductionQuestion(q, "5_UNITS_CEFR_B2"), true, q.question_id);
  }
});

// Topic/practice lessons share the exam's data shape — 17 of them in the dev
// database even have exactly 5 free-speech questions. What they lack is the
// Part B / Part C separator clips. Mapping one would produce an
// official-looking 100-point exam report for a practice session.
test("refuses to map a practice lesson that merely looks like an exam", () => {
  const practice = lessonQuestionList().filter((q) => !String(q.ID_detection).startsWith("sep-"));

  assert.throws(
    () => mapLessonToExamQuestions(practice, {}, "5_UNITS_CEFR_B2", { lessonName: "Pets & Animals, COBE" }),
    /not a gradeable .* exam.*practice lesson/s
  );
  assert.equal(isFullExamLesson(practice, "Pets & Animals, COBE"), false);
  assert.equal(isFullExamLesson(lessonQuestionList(), "Simulation 1, 2019, COBE FP"), true);
});

// "Simulation G 2023 COBE FP" is a half-built lesson: one Part C question, and
// its text is "abafs?". It must not be graded out of 100.
test("refuses to map an exam missing a Part C question", () => {
  const incomplete = lessonQuestionList({ a: [1, 3], b: [6], c: [10, 11] })
    .filter((q) => q.ID_detection !== "det-c1");

  assert.throws(
    () => mapLessonToExamQuestions(incomplete, {}, "5_UNITS_CEFR_B2", { lessonName: "Simulation G 2023 COBE FP" }),
    /Part C has 1 question\(s\); supported: 2/
  );
});

test("a 2023-format exam scores out of 100 end to end", async () => {
  const { inspectLesson } = require(path.join(SRC, "config", "examBlueprint.js"));
  const lesson = lessonQuestionList({ a: [1, 3], b: [6, 7], c: [10, 11] });
  const audio = Object.fromEntries(
    ["det-a0", "det-a1", "det-b0", "det-b1", "det-c0", "det-c1"].map((d) => [d, "perfect.wav"])
  );

  const questions = mapLessonToExamQuestions(lesson, audio, "5_UNITS_CEFR_B2");
  const { layout } = inspectLesson(lesson, "Simulation A 2023 COBE FP");
  const result = await evaluateFullExam({ questions, level: "5_UNITS_CEFR_B2", examLayout: layout });

  assert.equal(result.overall_score, 100);
  assert.equal(result.points_possible, 100);
  assert.deepEqual(result.unattempted_questions, []);
  assert.equal(result.question_results.length, 6);
});

// Regression: unattempted questions used to be derived from the default
// 2+1+2 blueprint, so a 2023 exam reported the nonexistent question "2" as
// unattempted while the two questions the student really skipped went unlisted.
test("unattempted questions on a 2023 exam name the real missing slots", async () => {
  const { inspectLesson } = require(path.join(SRC, "config", "examBlueprint.js"));
  const lesson = lessonQuestionList({ a: [1, 3], b: [6, 7], c: [10, 11] });
  const { layout } = inspectLesson(lesson, "Simulation A 2023 COBE FP");

  // Student answered Part A and Part B, then walked out before Part C
  const questions = mapLessonToExamQuestions(
    lesson,
    { "det-a0": "perfect.wav", "det-a1": "perfect.wav", "det-b0": "perfect.wav", "det-b1": "perfect.wav" },
    "5_UNITS_CEFR_B2"
  ).filter((q) => q.part !== "C");

  const result = await evaluateFullExam({ questions, level: "5_UNITS_CEFR_B2", examLayout: layout });

  assert.deepEqual(result.unattempted_questions.map((q) => q.question_id), ["3", "4"]);
  assert.equal(result.unattempted_questions.reduce((s, q) => s + q.points_forfeited, 0), 50);
  // Part A + Part B answered perfectly is worth exactly half the exam
  assert.equal(result.overall_score, 50);
});
