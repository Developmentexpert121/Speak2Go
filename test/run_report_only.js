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
 *
 * It is deliberately built to exercise EVERY branch of the report layout in
 * one page, because the rendered file is what gets sent to the client for
 * design review and a branch that never fires is a branch nobody comments on:
 *   - Part A scored normally, with full sub-criteria and star ratings;
 *   - Part B zeroed by a time-band penalty, which is the "no rubric score"
 *     path plus a row in the deductions table;
 *   - Part C question 1 scored with a partial deduction, so raw and final
 *     differ visibly;
 *   - Part C question 2 never attempted, which is what proves the Details
 *     table still totals 100 rather than quietly marking the exam out of 75.
 *
 * Note the snake_case here: this is engine-shaped input, and buildReportObject
 * is the boundary that renames it. See the header of buildReportObject.js.
 */
const MOCK_EXAM_RESULT = {
  level: "5_UNITS_CEFR_B2",
  overall_score: 34.22,
  points_earned: 34.22,
  points_possible: 100,

  // The blueprint the exam was marked against. buildPartScores() reads the
  // Details table off THIS, not off the answers, which is why question 4
  // below can be missing from question_results and still occupy a 25-point row.
  exam_layout: [
    { question_id: "1a", part: "A", points: 25, choice_group: "A", description: "Part A - Personal Response (Q1)" },
    { question_id: "1b", part: "A", points: 25, choice_group: "A", description: "Part A - Personal Response (Q2)" },
    { question_id: "2", part: "B", points: 25, description: "Part B - Project Presentation" },
    { question_id: "3", part: "C", points: 25, description: "Part C - Video Comprehension" },
    { question_id: "4", part: "C", points: 25, description: "Part C - Personal Opinion" },
  ],

  unattempted_questions: [
    { question_id: "4", description: "Part C - Personal Opinion", points_forfeited: 25 },
  ],

  question_results: [
    {
      // The clean case: answered well, nothing penalised.
      question_id: "1a",
      part: "A",
      weight: 25,
      choice_group: "A",
      counts_toward_final: true,
      description: "Part A - Personal Response (Q1)",
      question_text: "Tell me about something you have done recently that you are proud of.",
      transcript:
        "Last month I organised a food drive at my school. I was responsible for talking to the shops in my neighbourhood and asking them to donate. At first I was quite nervous about calling strangers, but after the third or fourth shop it became much easier. In the end we collected about two hundred kilos of food, and I am proud of that because it was my own idea and I saw it through.",
      audio_file_url: null,
      raw_score: 80,
      final_question_score: 80,
      deductions: [],
      suppressed_flags: [],
      audio_metrics: {
        wpm: 118,
        totalDurationSeconds: 74,
        longPauseCount: 1,
        fluencyLabel: "Fluency level is Functional (3 of 4)",
      },
      criterion_breakdown: [
        {
          criterion_name: "Topic Development",
          weight: 0.5,
          criterion_score: 81.25,
          sub_criteria: [
            { id: "sc1_relevancy", name: "Relevancy", score: 100 },
            { id: "sc2_prompt_understanding", name: "Prompt Understanding", score: 75 },
            { id: "sc3_answer_logic", name: "Answer Logic", score: 75 },
            { id: "sc4_answer_development", name: "Answer Development", score: 75 },
          ],
        },
        {
          criterion_name: "Delivery",
          weight: 0.15,
          criterion_score: 75,
          sub_criteria: [
            { id: "sc5_speech_quality", name: "Speech quality", score: 75 },
            { id: "sc6_fluency", name: "Fluency", score: 75 },
          ],
        },
        {
          criterion_name: "Vocabulary",
          weight: 0.2,
          criterion_score: 75,
          sub_criteria: [{ id: "sc7_vocabulary_range", name: "Vocabulary range", score: 75 }],
        },
        {
          criterion_name: "Language",
          weight: 0.15,
          criterion_score: 87.5,
          sub_criteria: [
            { id: "sc8_correct_grammar", name: "Correct Grammar", score: 75 },
            { id: "sc9_english_only", name: "English Only", score: 100 },
          ],
        },
      ],
    },
    {
      // A weaker but still valid answer — shows the middle two star bands.
      question_id: "1b",
      part: "A",
      weight: 25,
      choice_group: "A",
      counts_toward_final: false,
      description: "Part A - Personal Response (Q2)",
      question_text: "Do you think young people spend too much time on social media?",
      transcript:
        "Yes, I think so. Many people in my class are on their phone all the time, even in the break. It is a problem because... because they don't talk to each other. But also it is good sometimes, for example if you want to know what happens in the world. So I think it depends.",
      audio_file_url: null,
      raw_score: 64.28,
      final_question_score: 64.28,
      deductions: [],
      suppressed_flags: [],
      audio_metrics: {
        wpm: 96,
        totalDurationSeconds: 41,
        longPauseCount: 4,
        fluencyLabel: "Fluency level is Halting (2 of 4)",
      },
      criterion_breakdown: [
        {
          criterion_name: "Topic Development",
          weight: 0.5,
          criterion_score: 64.5,
          sub_criteria: [
            { id: "sc1_relevancy", name: "Relevancy", score: 75 },
            { id: "sc2_prompt_understanding", name: "Prompt Understanding", score: 75 },
            { id: "sc3_answer_logic", name: "Answer Logic", score: 54 },
            { id: "sc4_answer_development", name: "Answer Development", score: 54 },
          ],
        },
        {
          criterion_name: "Delivery",
          weight: 0.15,
          criterion_score: 64.5,
          sub_criteria: [
            { id: "sc5_speech_quality", name: "Speech quality", score: 75 },
            { id: "sc6_fluency", name: "Fluency", score: 54 },
          ],
        },
        {
          criterion_name: "Vocabulary",
          weight: 0.2,
          criterion_score: 54,
          sub_criteria: [{ id: "sc7_vocabulary_range", name: "Vocabulary range", score: 54 }],
        },
        {
          criterion_name: "Language",
          weight: 0.15,
          criterion_score: 77,
          sub_criteria: [
            { id: "sc8_correct_grammar", name: "Correct Grammar", score: 54 },
            { id: "sc9_english_only", name: "English Only", score: 100 },
          ],
        },
      ],
    },
    {
      // Zeroed by the time-band rule before the rubric ever ran. Renders the
      // "no rubric score" block and puts a 100% row in the deductions table.
      question_id: "2",
      part: "B",
      weight: 25,
      description: "Part B - Project Presentation",
      question_text: "Present your project. You have three minutes.",
      transcript: "Um, my project is about recycling. Yeah. That's it.",
      audio_file_url: null,
      raw_score: 0,
      final_question_score: 0,
      deductions: [
        {
          reason: "Part B time-based rule: answer length fell in the band below 0:20",
          deductionPct: 100,
        },
      ],
      suppressed_flags: [],
      audio_metrics: {
        wpm: 61,
        totalDurationSeconds: 11,
        longPauseCount: 2,
        fluencyLabel: "Fluency level is Fragmented (1 of 4)",
      },
      criterion_breakdown: [],
    },
    {
      // A partial deduction, so raw and final visibly differ on the page.
      question_id: "3",
      part: "C",
      weight: 25,
      description: "Part C - Video Comprehension",
      question_text: "What was the main problem described in the video clip, and how was it solved?",
      transcript:
        "The video was about a city that had a lot of traffic. They said the roads were full every morning and people waited maybe one hour. So the mayor decided to make the buses free, and after that more people used the bus instead of the car. I think it worked because at the end they showed the roads were more empty.",
      audio_file_url: null,
      raw_score: 71.1,
      final_question_score: 56.88,
      deductions: [
        { reason: "Coverage: one of the two required elements was not addressed", deductionPct: 20 },
      ],
      suppressed_flags: [
        { flag: "unintelligible", reason: "rubric scores disagreed with the flag; not applied" },
      ],
      audio_metrics: {
        wpm: 104,
        totalDurationSeconds: 58,
        longPauseCount: 3,
        fluencyLabel: "Fluency level is Halting (2 of 4)",
      },
      criterion_breakdown: [
        {
          criterion_name: "Topic Development",
          weight: 0.5,
          criterion_score: 69.75,
          sub_criteria: [
            { id: "sc1_relevancy", name: "Relevancy", score: 75 },
            { id: "sc2_prompt_understanding", name: "Prompt Understanding", score: 75 },
            { id: "sc3_answer_logic", name: "Answer Logic", score: 75 },
            { id: "sc4_answer_development", name: "Answer Development", score: 54 },
          ],
        },
        {
          criterion_name: "Delivery",
          weight: 0.15,
          criterion_score: 64.5,
          sub_criteria: [
            { id: "sc5_speech_quality", name: "Speech quality", score: 75 },
            { id: "sc6_fluency", name: "Fluency", score: 54 },
          ],
        },
        {
          criterion_name: "Vocabulary",
          weight: 0.2,
          criterion_score: 75,
          sub_criteria: [{ id: "sc7_vocabulary_range", name: "Vocabulary range", score: 75 }],
        },
        {
          criterion_name: "Language",
          weight: 0.15,
          criterion_score: 77,
          sub_criteria: [
            { id: "sc8_correct_grammar", name: "Correct Grammar", score: 54 },
            { id: "sc9_english_only", name: "English Only", score: 100 },
          ],
        },
      ],
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
  // The meta block is the Student and Exam objects flattened into the header.
  // Filled in fully here rather than with the bare name, because the header is
  // one of the things the client is reviewing.
  const html = renderReportHtml(report, {
    studentName: "Test Student",
    className: "י'3",
    schoolName: "Sample High School",
    examLevel: "5 Points (COBE)",
    cefrLevel: "B2",
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
