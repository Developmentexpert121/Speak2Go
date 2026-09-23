const { canFetchRecordings, RECORDING_PATH } = require("../integrations/speak2goClient");
const {
  isConfigured: reportUploadConfigured,
  BUCKET: REPORT_BUCKET,
  REGION: REPORT_REGION,
} = require("../integrations/s3ReportStorageClient");
const { LEVELS } = require("./examService");
const config = require("../config");

/**
 * What the service can currently do.
 *
 * The two integration points that depend on Speak2Go's infrastructure are
 * reported explicitly so a missing report upload or an undelivered result can
 * be diagnosed as "not configured" rather than mistaken for a bug in the run.
 */
const getHealth = () => ({
  ok: true,
  deepgramKey: Boolean(config.deepgram.apiKey),
  openaiKey: Boolean(config.openai.apiKey),
  model: config.openai.model,
  recordingsFetch: canFetchRecordings(),
  recordingEndpoint: RECORDING_PATH,
  reportUpload: {
    configured: reportUploadConfigured(),
    bucket: REPORT_BUCKET,
    region: REPORT_REGION,
  },
  resultCallback: {
    signingSecret: Boolean(config.resultCallback.signingSecret),
    allowedHosts: config.resultCallback.allowedHosts,
  },
  levels: LEVELS,
});

module.exports = { getHealth };
