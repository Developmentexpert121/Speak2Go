require("dotenv").config();
const { evaluateQuestion } = require("../src/pipeline/evaluateExam");

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error("Usage: node test/run_pipeline.js <path-to-audio-file>");
    process.exit(1);
  }

  const result = await evaluateQuestion({
    audioFilePath: audioPath,
    questionText: "Describe a project you worked on recently and explain what you learned from it.",
    level: "5_UNITS_CEFR_B2", // try "4_UNITS_CEFR_B1" for the 4-point rubric
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Pipeline error:", err.message);
  process.exit(1);
});
