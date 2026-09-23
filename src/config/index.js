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

function build() {
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

    /**
     * Salt for hashing a student's national ID into the anonymised studentId.
     * Must stay constant for the life of a deployment: changing it reissues
     * every identifier and breaks the link to a student's past reports.
     */
    studentIdSalt: process.env.STUDENT_ID_SALT || "",

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
      /**
       * Whether the SDK will find credentials at all — an explicit key pair, a
       * named profile, or one of the container/web-identity mechanisms AWS
       * injects in a deployed environment.
       */
      hasCredentials: Boolean(
        (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
          process.env.AWS_PROFILE ||
          process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
          process.env.AWS_WEB_IDENTITY_TOKEN_FILE
      ),
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

    return { ...base, ...overrides };
  }

/**
 * The live configuration object.
  *
 * Values are read from the environment once, at startup, which is what a
 * deployed service wants: a process should not change behaviour halfway
 * through because something edited its environment.
  *
 * `reload()` recomputes in place, mutating this same object rather than
 * replacing it, so every module that already holds a reference sees the new
 * values. It exists for tests that need to prove behaviour under a different
 * environment — the fail-closed webhook checks, for instance, which are only
 * meaningful if the "no secret configured" case can actually be exercised.
 */
const config = build();

function reload() {
  // Every key except reload itself — deleting that would remove the function
  // currently executing and leave the object unusable on the next call.
  for (const key of Object.keys(config)) {
    if (key !== "reload") delete config[key];
  }
  Object.assign(config, build());
  return config;
}

// Non-enumerable so it never shows up in a config dump or a JSON response.
Object.defineProperty(config, "reload", { value: reload, enumerable: false });

module.exports = config;
