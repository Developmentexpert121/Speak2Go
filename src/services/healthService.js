const { canFetchRecordings, RECORDING_PATH } = require("../integrations/speak2goClient");
const {
  isConfigured: reportUploadConfigured,
  BUCKET: REPORT_BUCKET,
  REGION: REPORT_REGION,
} = require("../integrations/s3ReportStorageClient");
const { LEVELS } = require("./examService");

/**
 * What the service can currently do.
 *
 * The two integration points that depend on Speak2Go's infrastructure are
 * reported explicitly so a missing report upload or an undelivered result can
 * be diagnosed as "not configured" rather than mistaken for a bug in the run.
 */
const getHealth = () => ({
  ok: true,
  deepgramKey: Boolean(process.env.DEEPGRAM_API_KEY),
  openaiKey: Boolean(process.env.OPENAI_API_KEY),
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  recordingsFetch: canFetchRecordings(),
  recordingEndpoint: RECORDING_PATH,
  reportUpload: {
    configured: reportUploadConfigured(),
    bucket: REPORT_BUCKET,
    region: REPORT_REGION,
  },
  resultCallback: {
    signingSecret: Boolean(process.env.WEBHOOK_SIGNING_SECRET),
    allowedHosts: (process.env.WEBHOOK_ALLOWED_HOSTS || "").split(",").filter(Boolean),
  },
  levels: LEVELS,
});

module.exports = { getHealth };
