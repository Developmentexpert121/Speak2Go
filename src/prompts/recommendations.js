const fs = require("fs");
const path = require("path");

const template = fs.readFileSync(path.join(__dirname, "recommendations.txt"), "utf8");

const RECOMMENDATIONS_SYSTEM =
  "You write concise, specific teacher-facing feedback summaries.";

/** Fills the prompt template with the per-question summary. */
const buildRecommendationsPrompt = (summary) =>
  template.replace("{{DATA}}", JSON.stringify(summary, null, 2));

module.exports = { RECOMMENDATIONS_SYSTEM, buildRecommendationsPrompt };
