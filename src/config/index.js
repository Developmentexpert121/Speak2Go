/**
 * Configuration, read from the environment in one place.
 *
 * The style guide asks for config in env vars or a config file, never
 * hardcoded. Reading it here rather than scattering process.env through the
 * code means the full set of knobs is greppable in one file, and a missing
 * value shows up as a named default rather than as `undefined` surfacing
 * somewhere far from its cause.
 *
 * Per-environment overrides live in development.js / production.js and are
 * merged on top of these defaults.
 */

const path = require("path");

const env = process.env.NODE_ENV || "development";

const base = {
  env,
  PORT: Number(process.env.PORT) || 3000,

  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY || "",
  },

  speak2go: {
    apiUrl: process.env.SPEAK2GO_API_URL || "",
    apiToken: process.env.SPEAK2GO_API_TOKEN || "",
    appBaseUrl: process.env.SPEAK2GO_APP_BASE_URL || "https://app.speak2go.com",
  },

  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    reportBucket: process.env.S3_REPORT_BUCKET || "oral-exams-s2g",
    reportPrefix: process.env.S3_REPORT_PREFIX || "reports",
    recordingsBucket: process.env.S3_RECORDINGS_BUCKET || "s2g-recordings",
    urlTtlSeconds: Number(process.env.S3_URL_TTL_SECONDS) || 7 * 24 * 60 * 60,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || "",
  },

  resultCallback: {
    signingSecret: process.env.WEBHOOK_SIGNING_SECRET || "",
    allowedHosts: (process.env.WEBHOOK_ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean),
    maxRetries: process.env.WEBHOOK_MAX_RETRIES,
  },

  scoring: {
    pauseThresholdSeconds: Number(process.env.PAUSE_THRESHOLD_SECONDS) || 3,
  },

  paths: {
    referenceMaterial: path.join(__dirname, "..", "..", "data", "reference_material"),
  },
};

let overrides = {};
try {
  overrides = require(`./${env}`);
} catch {
  // No per-environment file is a normal state, not an error.
}

module.exports = { ...base, ...overrides };
