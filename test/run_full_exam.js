require("dotenv").config();
const path = require("path");
const { evaluateFullExam } = require("../src/pipeline/evaluateFullExam");
const { buildReportObject } = require("../src/report/buildReportObject");
const { generateRecommendations } = require("../src/report/generateRecommendations");
const { renderReportHtml } = require("../src/report/renderReportHtml");
const { renderReportPdf } = require("../src/report/renderReportPdf");

const { COBE_BLUEPRINT } = require("../src/config/examBlueprint");

// Built from the canonical blueprint, so `weight` is always the question's
// real point value and the exam is marked out of the full 100 — including
// any question you don't pass audio for, which now correctly scores 0
// instead of being dropped from the average.
const QUESTION_TEXTS = {
  "1a": "What do you enjoy doing in your free time?",
  "1b": "Why do you enjoy that activity specifically?",
  "2": "Present your personal project and the process behind it.",
  "3": "What is the main idea of the video you just watched?",
  "4": "Do you agree with the speaker's opinion? Explain why.",
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
}));

async function main() {
  if (!audioArgs.length) {
    console.error("Usage: node test/run_full_exam.js <audio-1a> [audio-1b] [audio-2] [audio-3] [audio-4]");
    console.error("Questions with no audio file are scored as unattempted (0 points).");
    process.exit(1);
  }

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
