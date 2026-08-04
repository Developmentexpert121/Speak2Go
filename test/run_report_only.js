require("dotenv").config();
const path = require("path");
const { buildReportObject } = require("../src/report/buildReportObject");
const { generateRecommendations } = require("../src/report/generateRecommendations");
const { renderReportHtml } = require("../src/report/renderReportHtml");
const { renderReportPdf } = require("../src/report/renderReportPdf");

/**
 * A hand-built stand-in for evaluateFullExam()'s output. Use this to test
 * the report layer (HTML formatting, PDF rendering, deduction display,
 * recommendations) WITHOUT spending Deepgram/OpenAI calls on real audio.
 * Edit these numbers freely to check edge cases — e.g. set a question's
 * criterion_breakdown to [] to confirm the "no rubric score" path renders
 * correctly, or add multiple deductions to one question.
 */
const MOCK_EXAM_RESULT = {
  level: "5_UNITS_B2",
  overall_score: 72.8,
  question_results: [
    {
      question_id: "1a",
      description: "Part A - Spoken Production – Personal Response",
      weight: 0.15,
      raw_score: 84.4,
      final_question_score: 84.4,
      deductions: [],
      criterion_breakdown: [
        { criterion_name: "Topic Development", weight: 0.5, criterion_score: 87.25 },
        { criterion_name: "Delivery", weight: 0.15, criterion_score: 87.5 },
        { criterion_name: "Vocabulary", weight: 0.2, criterion_score: 75 },
        { criterion_name: "Language", weight: 0.15, criterion_score: 87.5 },
      ],
      audio_metrics: { fluencyLabel: "Fluency level is Functional (3 of 4)" },
    },
    {
      question_id: "1b",
      description: "Part A - Spoken Production – Personal Response",
      weight: 0.15,
      raw_score: 74.0,
      final_question_score: 74.0,
      deductions: [],
      criterion_breakdown: [
        { criterion_name: "Topic Development", weight: 0.5, criterion_score: 62.0 },
        { criterion_name: "Delivery", weight: 0.15, criterion_score: 100 },
        { criterion_name: "Vocabulary", weight: 0.2, criterion_score: 75 },
        { criterion_name: "Language", weight: 0.15, criterion_score: 87.5 },
      ],
      audio_metrics: { fluencyLabel: "Fluency level is Fluent (4 of 4)" },
    },
    {
      // Deliberately the "zeroed by penalty" case, to test that path renders
      question_id: "2",
      description: "PART B: Project Presentation",
      weight: 0.30,
      raw_score: 0,
      final_question_score: 0,
      deductions: [
        { reason: "Part B/Project time-based rule: answer length in band below 0:20", deductionPct: 100 },
      ],
      criterion_breakdown: [],
      audio_metrics: { fluencyLabel: "Fluency level is Fragmented (1 of 4)" },
    },
    {
      question_id: "3",
      description: "PART C - Comprehensive Response to a Video Clip",
      weight: 0.20,
      raw_score: 63.2,
      final_question_score: 63.2,
      deductions: [],
      criterion_breakdown: [
        { criterion_name: "Topic Development", weight: 0.5, criterion_score: 62 },
        { criterion_name: "Delivery", weight: 0.15, criterion_score: 64.5 },
        { criterion_name: "Vocabulary", weight: 0.2, criterion_score: 54 },
        { criterion_name: "Language", weight: 0.15, criterion_score: 87.5 },
      ],
      audio_metrics: { fluencyLabel: "Fluency level is Halting (2 of 4)" },
    },
  ],
};

async function main() {
  // 1. Build the Report Object (pure function, no external calls — should
  //    always succeed instantly; if this throws, the bug is in
  //    buildReportObject.js's shape assumptions, not in STT/LLM)
  console.log("Building Report Object...");
  const skipLLM = process.argv.includes("--no-llm");
  const recommendations = skipLLM
    ? "(skipped — run without --no-llm to generate real recommendations)"
    : await generateRecommendations(MOCK_EXAM_RESULT);

  const report = buildReportObject(MOCK_EXAM_RESULT, recommendations);
  console.log(JSON.stringify(report, null, 2));

  // 2. Render HTML (also pure, no external calls)
  console.log("\nRendering HTML...");
  const html = renderReportHtml(report, {
    studentName: "Test Student",
    examLevel: "5 Point COBE (B2)",
    dateExecuted: new Date().toISOString().slice(0, 10),
  });

  const htmlPath = path.join(__dirname, "sample_report.html");
  require("fs").writeFileSync(htmlPath, html);
  console.log(`HTML written to: ${htmlPath}  (open this directly in a browser to eyeball layout)`);

  // 3. Render PDF (the only step with a real external dependency — Chromium
  //    via Puppeteer — so it's the one most likely to fail in a fresh
  //    environment; see troubleshooting notes below)
  console.log("\nRendering PDF...");
  const pdfPath = path.join(__dirname, "sample_report.pdf");
  await renderReportPdf(html, pdfPath);
  console.log(`PDF written to: ${pdfPath}`);
}

main().catch((err) => {
  console.error("Report test failed:", err);
  process.exit(1);
});
