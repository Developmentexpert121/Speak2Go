require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { buildReportObject } = require("../src/report/buildReportObject");
const { renderDashboardHtml } = require("../src/report/renderDashboardHtml");
const { renderReportPdf } = require("../src/report/renderReportPdf");

/**
 * Renders the dashboard from a realistic mock exam result — no Deepgram or
 * OpenAI calls. Deliberately includes the awkward cases so the layout gets
 * exercised properly: a question zeroed by a penalty, a partially-answered
 * question set with a coverage note, and one question never attempted.
 *
 *   node test/run_dashboard.js          -> HTML + PDF
 *   node test/run_dashboard.js --html   -> HTML only (skips Chromium)
 */
const MOCK_EXAM_RESULT = {
  level: "5_UNITS_B2",
  overall_score: 58.06,
  points_earned: 58.06,
  points_possible: 100,
  unattempted_questions: [
    { question_id: "4", description: "Part C - Audio-Visual Response (Q2)", points_forfeited: 25 },
  ],
  question_results: [
    {
      question_id: "1a",
      description: "Part A - Spoken Production, Personal Response (Q1)",
      weight: 12.5,
      raw_score: 84.38,
      final_question_score: 84.38,
      deductions: [],
      transcript:
        "I really enjoy playing basketball with my friends after school. We usually meet at the court near my house around four o'clock, and we play for maybe two hours. What I like most about it is that it's not just exercise, it's also a way to spend time with people I care about and forget about schoolwork for a while.",
      audio_metrics: {
        totalDurationSeconds: 74.2, wpm: 118, pauseCount: 1, longestPauseSeconds: 3.4,
        fillerWordCount: 3, wordCount: 146, fluencyLevel: 3,
        fluencyLabel: "Fluency level is Functional (3 of 4)",
      },
      criterion_breakdown: [
        { criterion_name: "Topic Development", weight: 0.5, criterion_score: 87.25,
          sub_criteria: [
            { id: "sc1_relevancy", name: "Relevancy", score: 100 },
            { id: "sc2_prompt_understanding", name: "Prompt Understanding", score: 100 },
            { id: "sc3_answer_logic", name: "Answer Logic", score: 75 },
            { id: "sc4_answer_development", name: "Answer Development", score: 75 },
          ] },
        { criterion_name: "Delivery", weight: 0.15, criterion_score: 87.5,
          sub_criteria: [
            { id: "sc5_speech_quality", name: "Speech quality", score: 100 },
            { id: "sc6_fluency", name: "Fluency", score: 75 },
          ] },
        { criterion_name: "Vocabulary", weight: 0.2, criterion_score: 75,
          sub_criteria: [{ id: "sc7_vocabulary_range", name: "Vocabulary range", score: 75 }] },
        { criterion_name: "Language", weight: 0.15, criterion_score: 87.5,
          sub_criteria: [
            { id: "sc8_correct_grammar", name: "Correct Grammar", score: 75 },
            { id: "sc9_english_only", name: "English Only", score: 100 },
          ] },
      ],
    },
    {
      question_id: "1b",
      description: "Part A - Spoken Production, Personal Response (Q2)",
      weight: 12.5,
      raw_score: 62.25,
      final_question_score: 62.25,
      deductions: [],
      coverage_note: "1/2 sub-questions answered in set 1 — 25% deduction applied to Topic Development",
      transcript: "Because it makes me feel good and I like my friends.",
      audio_metrics: {
        totalDurationSeconds: 31.8, wpm: 96, pauseCount: 3, longestPauseSeconds: 5.1,
        fillerWordCount: 7, wordCount: 51, fluencyLevel: 2,
        fluencyLabel: "Fluency level is Halting (2 of 4)",
      },
      criterion_breakdown: [
        { criterion_name: "Topic Development", weight: 0.5, criterion_score: 46.5,
          coverage_deduction_applied_pct: 25,
          sub_criteria: [
            { id: "sc1_relevancy", name: "Relevancy", score: 75 },
            { id: "sc2_prompt_understanding", name: "Prompt Understanding", score: 75 },
            { id: "sc3_answer_logic", name: "Answer Logic", score: 54 },
            { id: "sc4_answer_development", name: "Answer Development", score: 54 },
          ] },
        { criterion_name: "Delivery", weight: 0.15, criterion_score: 64.5,
          sub_criteria: [
            { id: "sc5_speech_quality", name: "Speech quality", score: 75 },
            { id: "sc6_fluency", name: "Fluency", score: 54 },
          ] },
        { criterion_name: "Vocabulary", weight: 0.2, criterion_score: 54,
          sub_criteria: [{ id: "sc7_vocabulary_range", name: "Vocabulary range", score: 54 }] },
        { criterion_name: "Language", weight: 0.15, criterion_score: 87.5,
          sub_criteria: [
            { id: "sc8_correct_grammar", name: "Correct Grammar", score: 75 },
            { id: "sc9_english_only", name: "English Only", score: 100 },
          ] },
      ],
    },
    {
      question_id: "2",
      description: "Part B - Project Presentation",
      weight: 25,
      raw_score: 78.4,
      final_question_score: 62.72,
      deductions: [
        { reason: "Part B/Project time-based rule: answer length in band 0:40-0:59", deductionPct: 20 },
      ],
      transcript:
        "My project was about renewable energy in Israel. I looked at solar panels mostly, because we have a lot of sun. I interviewed my neighbour who installed them last year and he said his electricity bill went down by about half.",
      audio_metrics: {
        totalDurationSeconds: 47.5, wpm: 124, pauseCount: 1, longestPauseSeconds: 3.1,
        fillerWordCount: 2, wordCount: 98, fluencyLevel: 3,
        fluencyLabel: "Fluency level is Functional (3 of 4)",
      },
      criterion_breakdown: [
        { criterion_name: "Topic Development", weight: 0.5, criterion_score: 76,
          sub_criteria: [
            { id: "sc1_relevancy", name: "Relevancy", score: 100 },
            { id: "sc2_prompt_understanding", name: "Prompt Understanding", score: 75 },
            { id: "sc3_answer_logic", name: "Answer Logic", score: 75 },
            { id: "sc4_answer_development", name: "Answer Development", score: 54 },
          ] },
        { criterion_name: "Delivery", weight: 0.15, criterion_score: 87.5,
          sub_criteria: [
            { id: "sc5_speech_quality", name: "Speech quality", score: 100 },
            { id: "sc6_fluency", name: "Fluency", score: 75 },
          ] },
        { criterion_name: "Vocabulary", weight: 0.2, criterion_score: 75,
          sub_criteria: [{ id: "sc7_vocabulary_range", name: "Vocabulary range", score: 75 }] },
        { criterion_name: "Language", weight: 0.15, criterion_score: 87.5,
          sub_criteria: [
            { id: "sc8_correct_grammar", name: "Correct Grammar", score: 75 },
            { id: "sc9_english_only", name: "English Only", score: 100 },
          ] },
      ],
    },
    {
      question_id: "3",
      description: "Part C - Audio-Visual Response (Q1)",
      weight: 25,
      raw_score: 0,
      final_question_score: 0,
      deductions: [{ reason: "Answer under 20 seconds of speech", deductionPct: 100 }],
      transcript: "Um, I think it was about, uh, the environment.",
      audio_metrics: {
        totalDurationSeconds: 11.4, wpm: 68, pauseCount: 2, longestPauseSeconds: 3.8,
        fillerWordCount: 4, wordCount: 13, fluencyLevel: 1,
        fluencyLabel: "Fluency level is Fragmented (1 of 4)",
      },
      criterion_breakdown: [],
    },
  ],
};

const RECOMMENDATIONS = `Answer development is the recurring weak point — this student consistently states a position but stops before supporting it with detail or examples, which cost marks in all three scored questions.

Fluency drops sharply on the unprepared Part C question compared to the rehearsed Part B presentation, suggesting the gap is confidence with spontaneous speech rather than language knowledge. Practise short impromptu responses with a 60-second minimum.

The Part C answer was cut off under 20 seconds and the second Part C question was never attempted; together these forfeited half the available marks. Before the next attempt, confirm the student understands that a short answer scores zero rather than partial credit.`;

async function main() {
  const report = buildReportObject(MOCK_EXAM_RESULT, RECOMMENDATIONS);

  const html = renderDashboardHtml(MOCK_EXAM_RESULT, report, {
    studentName: "Noa Ben-David",
    examLevel: "5 Point COBE · CEFR B2",
    dateExecuted: "2026-08-04",
    examId: "exam_7f3a91c2",
  });

  const htmlPath = path.join(__dirname, "sample_dashboard.html");
  fs.writeFileSync(htmlPath, html);
  console.log(`HTML dashboard -> ${htmlPath}`);

  if (process.argv.includes("--html")) return;

  const pdfPath = path.join(__dirname, "sample_dashboard.pdf");
  await renderReportPdf(html, pdfPath);
  console.log(`PDF dashboard  -> ${pdfPath}`);
}

main().catch((err) => {
  console.error("Dashboard render failed:", err);
  process.exit(1);
});
