require("dotenv").config();
const path = require("path");
const { transcribeAudioFile } = require("../src/services/sttService");
const { computeAudioMetrics } = require("../src/services/audioMetrics");

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error("Usage: node test/run_stt.js <path-to-audio-file>");
    process.exit(1);
  }

  console.log(`Transcribing: ${path.resolve(audioPath)}\n`);
  const sttResult = await transcribeAudioFile(audioPath);

  console.log("--- TRANSCRIPT ---");
  console.log(sttResult.transcript);

  const metrics = computeAudioMetrics(sttResult);
  console.log("\n--- AUDIO METRICS ---");
  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
