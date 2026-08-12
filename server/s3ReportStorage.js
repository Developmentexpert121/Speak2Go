/**
 * Publishes finished report HTML to the Speak2Go S3 bucket, so that the Exam
 * Object's reportHtmlUrl points at durable storage rather than at this
 * process's memory.
 *
 * The client asked (11 Aug 2026) for the HTML to be saved to their bucket and
 * the URL returned, and for PDFs NOT to be pre-rendered — Avinoam generates
 * those on demand from the HTML. That works because renderReportHtml emits a
 * fully self-contained document: no external stylesheets, fonts, images or
 * scripts. It can be fetched straight out of the bucket and printed.
 *
 * THE BUCKET. The client's message named "oral-exam-s2g" in prose and
 * "arn:aws:s3:::oral-exams-s2g" in the ARN. Those are different names, and
 * only the plural one exists — an unauthenticated probe returns 403 (exists,
 * access denied) for oral-exams-s2g and 404 for the singular spelling. The ARN
 * is therefore the correct one, in us-east-1. Both are overridable by env so a
 * correction does not need a code change.
 *
 * ACCESS. Credentials are read from the environment by the AWS SDK's default
 * provider chain (env vars, shared config file, or an instance role). Nothing
 * is hardcoded here. The console username and password the client sent cannot
 * be used by this code at all — console sign-in and API access are different
 * mechanisms; this needs an access key pair or, better, a role.
 *
 * PRIVACY. Reports carry a student's full name, school, class and grades, so
 * objects are written with no public-read ACL and handed out as presigned URLs
 * that expire. If Speak2Go would rather serve them itself, set
 * S3_PUBLIC_BASE_URL and we return a plain path instead.
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const BUCKET = process.env.S3_REPORT_BUCKET || "oral-exams-s2g";
const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = (process.env.S3_REPORT_PREFIX || "reports").replace(/^\/+|\/+$/g, "");
const PUBLIC_BASE_URL = (process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

/** Seconds a presigned report link stays valid. Seven days is the SigV4 max. */
const URL_TTL_SECONDS = Number(process.env.S3_URL_TTL_SECONDS || 7 * 24 * 60 * 60);

let client;
function getClient() {
  if (!client) client = new S3Client({ region: REGION });
  return client;
}

/**
 * Whether uploading is configured. Checked before use so the pipeline can fall
 * back to serving reports from memory instead of failing an otherwise
 * successful exam run.
 *
 * Deliberately does not verify the credentials are VALID — that would mean a
 * network round trip on every health check. It reports only whether anything
 * was supplied at all.
 */
function isConfigured() {
  return Boolean(
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
      process.env.AWS_PROFILE ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE
  );
}

/** `reports/2026/08/{examId}/report.html` — dated so the bucket stays browsable. */
function reportKey(examId, filename = "report.html") {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // examId is generated server-side, but it reaches an object key, so anything
  // that could climb out of the prefix is stripped rather than trusted.
  const safeId = String(examId).replace(/[^A-Za-z0-9._-]/g, "_");
  return `${PREFIX}/${yyyy}/${mm}/${safeId}/${filename}`;
}

/**
 * Uploads one report document and returns a URL for it.
 *
 * @param {object} params
 * @param {string} params.examId
 * @param {string} params.body - the HTML document
 * @param {string} [params.filename]
 * @param {string} [params.contentType]
 * @returns {Promise<{ uploaded: boolean, url: string|null, key: string, reason?: string }>}
 */
async function uploadReport({ examId, body, filename = "report.html", contentType = "text/html; charset=utf-8" }) {
  const key = reportKey(examId, filename);

  if (!isConfigured()) {
    return {
      uploaded: false,
      url: null,
      key,
      reason: "no AWS credentials in the environment — S3 upload skipped",
    };
  }

  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Inline rather than attachment: the HTML is meant to render in the
        // dashboard, and a download prompt would defeat that.
        ContentDisposition: "inline",
        ServerSideEncryption: "AES256",
      })
    );

    // A public base URL means Speak2Go has decided to serve these itself (via
    // CloudFront or a proxy) and owns the access control. Otherwise we hand
    // back a link that expires.
    const url = PUBLIC_BASE_URL
      ? `${PUBLIC_BASE_URL}/${key}`
      : await getSignedUrl(getClient(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
          expiresIn: URL_TTL_SECONDS,
        });

    return { uploaded: true, url, key };
  } catch (err) {
    // Never fatal. A graded exam whose report could not be uploaded is still a
    // graded exam, and the in-memory URL still serves it.
    console.warn(`  S3 upload failed for ${examId} (${key}): ${err.message}`);
    return { uploaded: false, url: null, key, reason: err.message };
  }
}

module.exports = { uploadReport, isConfigured, reportKey, BUCKET, REGION, PREFIX };
