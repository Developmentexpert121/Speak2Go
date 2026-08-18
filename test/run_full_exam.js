require("dotenv").config();
const path = require("path");
const { evaluateFullExam } = require("../src/pipeline/evaluateFullExam");
const { buildReportObject } = require("../src/report/buildReportObject");
const { generateRecommendations } = require("../src/report/generateRecommendations");
const { renderReportHtml } = require("../src/report/renderReportHtml");
const { renderReportPdf } = require("../src/report/renderReportPdf");
const { saveReferenceMaterial } = require("../src/storage/referenceMaterialStore");

const { COBE_BLUEPRINT } = require("../src/config/examBlueprint");

// ---------------------------------------------------------------------------
// MANUAL TEST FIXTURE
//
// This file is a MANUAL testing script only.  It exists to let you run a
// real grading pipeline with actual audio files, without needing the platform
// database.
//
// QUESTION TEXTS below are hardcoded to match the Simulation 2024 / COBE FP
// exam as distributed by the teacher.  In production, question_text is never
// hardcoded here — it is pulled from the live lesson record by
// mapLessonToExamQuestionsAsync() in examBlueprint.js, which reads each
// question's `.text` field directly from the Speak2Go lesson document.
//
// REFERENCE MATERIAL (Part C clip transcript) is seeded below into
// referenceMaterialStore.js so the production lookup pattern works the same
// way here as in a live run.  In production that seeding happens when the
// teacher uploads or records the Part C clip; the store is then queried
// automatically per-clip by mapLessonToExamQuestionsAsync().
//
// PART C CLIP ID — in production this comes from the lesson's ID_detection
// field on the clip question.  For this test fixture we define it as a
// constant so the seed + lookup use the same value.
// ---------------------------------------------------------------------------

// Fake clip ID used for this test run.  Production uses the real ID_detection
// value from the lesson document (a UUID or platform-assigned string).
const PART_C_CLIP_ID = "sim_2024_cobe_fp_books_clip";

// Transcript of the Part C clip — "Books" (Simulation 2024, COBE FP).
// In production this is stored once when the lesson is set up, then retrieved
// per question by referenceMaterialStore.getReferenceMaterial(ID_detection).
const PART_C_TRANSCRIPT = `I will lend books to people, but of course the rule is, don't do that unless you never intend to see that book again.
The physical object of a book is almost like a person. I mean, it has a spine, it has a backbone, it has a face. Actually, it can sort of be your friend.
Books record the basic human experience like no other medium can. Before there were books, ancient civilizations would record things by notches on bones, or rocks, or what have you.
The first books as we know them originated in ancient Rome. We go by a term called the codex, where they would have two heavy pieces of wood which would become the cover, and then the pages in between would then be stitched along one side to make something that was relatively easily transportable.
They all had to completely be done by hand, which became the work of what we know as a scribe. And frankly, they were luxury items.
And then a printer named Johannes Gutenberg, in the mid-15th century, created the means to mass-produce a book: the modern printing press. It wasn't until then that there was any kind of consumption of books by a large audience.
Book covers started to come into use in the early 19th century, and they were called dust wrappers. Usually had advertising on them, so people would take them off and throw them away. It wasn't until the turn of the 19th into the 20th century that book jackets could be seen as interesting design in and of themselves, such that I look at that, and I think, "I want to read that. That interests me."
The physical book itself represents both a technological advance, but also a piece of technology in and of itself. It delivered a user interface that was unlike anything that people had before. And you could argue that it's still the best way to deliver that to an audience.
I believe that the core purpose of a physical book is to record our existence, and to leave it behind on a shelf, in a library, in a home, for generations down the road to understand where they came from, that people went through some of the same things that they're going through. And it's like a dialogue that you have with the author.
I think you have a much more human relationship to a printed book than you do to one that's on a screen.
People want the experience of holding it, of turning the page, of marking their progress in a story. And then you have, of all things, the smell of a book: fresh ink on paper, or the aging paper smell. You don't really get that from anything else.
The book itself, you know, can't be turned off with a switch. It's a story that you can hold in your hand and carry around with you, and that's part of what makes them so valuable, and I think will make them valuable for the duration. A shelf of books, frankly, is made to outlast you, no matter who you are.`;

// ---------------------------------------------------------------------------
// QUESTION TEXTS — real question texts from this exam fixture.
//
// In production these come from slot.source.text inside the lesson document
// (pulled by mapLessonToExamQuestionsAsync), NOT from any map here.
// For Part C both questions belong to the same clip, so they share the same
// PART_C_CLIP_ID as their reference material key.
// ---------------------------------------------------------------------------
const QUESTION_TEXTS = {
  "1a": "This is Q1 where you can select an answer by free speech - hometown. Today, I'm going to ask you about your hometown. Tell me where you live and a little bit about the place. What is your favorite place in your hometown? Why? Would you recommend your hometown to others? Explain why.",
  "1b": "Intro to Q2 to choose to answer in free speech? volunteering. Today, I'm going to ask you about volunteering. Tell me about your volunteering experience in high school. Explain what you did there. Do you think you will continue volunteering in the future?",
  "2":  "Question about your project Simulation 3, 2019, COBE FP new. To begin with, tell me what your topic was and what you were hoping to learn from it. In addition, what two interesting facts did you learn from your project? Why do you think so? Also, what else would you like to know about the topic? Explain.",
  "3":  "First question in Part C Simulation 2024, COBE FP Books. After watching the clip, what have you learned about the history of books? How did people record history in ancient times before the invention of books?",
  "4":  "Second question in Part C Simulation 2024, COBE FP Books. What is the purpose of books? What was most interesting for you in the clip? Explain.",
};

// Part C questions share the same clip (the Books video) so both get the clip ID.
const PART_C_CLIP_ID_BY_QUESTION = {
  "3": PART_C_CLIP_ID,
  "4": PART_C_CLIP_ID,
};

const audioArgs = process.argv.slice(2);

const EXAM_QUESTIONS = COBE_BLUEPRINT.map((bp, i) => ({
  question_id: bp.question_id,
  description: bp.description,
  part: bp.part,
  weight: bp.points,
  question_text: QUESTION_TEXTS[bp.question_id],
  // Pass one file per question, in blueprint order. Anything you leave off
  // is treated as unattempted and forfeits its points.
  audioFilePath: audioArgs[i] || null,
  // Reference material: populated for Part C questions via the store (see
  // production path), or the pre-seeded fixture value for this manual test.
  // null for Parts A and B — evaluateQuestion ignores it when absent.
  referenceMaterial: PART_C_CLIP_ID_BY_QUESTION[bp.question_id]
    ? PART_C_TRANSCRIPT   // test fixture — in production: getReferenceMaterial(ID_detection)
    : null,
}));

async function main() {
  if (!audioArgs.length) {
    console.error("Usage: node test/run_full_exam.js <audio-1a> [audio-1b] [audio-2] [audio-3] [audio-4]");
    console.error("Questions with no audio file are scored as unattempted (0 points).");
    process.exit(1);
  }

  // Seed the Part C reference material into the store so the production lookup
  // path (getReferenceMaterial) finds it if called during this run.
  // In a live exam this happens once when the teacher uploads the clip;
  // no seeding is needed for subsequent student attempts.
  await saveReferenceMaterial(PART_C_CLIP_ID, PART_C_TRANSCRIPT);
  console.log(`[fixture] Part C reference material seeded for clip ID: ${PART_C_CLIP_ID}`);

  const examResult = await evaluateFullExam({ questions: EXAM_QUESTIONS, level: "5_UNITS_B2" });
  console.log("--- EXAM RESULT ---");
  console.log(JSON.stringify(examResult, null, 2));

  const recommendations = await generateRecommendations(examResult);
  const report = buildReportObject(examResult, recommendations);

  const html = renderReportHtml(report, {
    studentName: "Test Student",
    examLevel: "5 Point COBE (B2)",
    dateExecuted: new Date().toISOString().slice(0, 10),
  });

  const outPath = path.join(__dirname, "sample_report.pdf");
  await renderReportPdf(html, outPath);

  console.log("\n--- REPORT OBJECT ---");
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nPDF written to: ${outPath}`);
}

main().catch((err) => {
  console.error("Full exam pipeline error:", err);
  process.exit(1);
});
