require("dotenv").config();

const { createApp } = require("./src/app");
const { PORT } = require("./src/config");

/**
 * The process entry point: configuration, a port, and nothing else. All
 * wiring lives in src/app.js.
 */
const app = createApp();

app.listen(PORT, () => {
  console.log(`\n  Speak2Go COBE evaluation server`);
  console.log(`  → http://localhost:${PORT}\n`);
  if (!process.env.DEEPGRAM_API_KEY || !process.env.OPENAI_API_KEY) {
    console.warn("  WARNING: DEEPGRAM_API_KEY / OPENAI_API_KEY missing from .env — runs will fail.\n");
  }
});
