/**
 * Uploads a rendered report to the client's bucket and returns a link to it.
 *
 * Objects are private and server-side encrypted, so the link is presigned
 * unless S3_PUBLIC_BASE_URL says the bucket is fronted by CloudFront. Without
 * credentials the caller falls back to serving from memory rather than failing
 * a graded exam. See docs/integrations.md.
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const config = require("../config");

const BUCKET = config.aws.reportBucket;
const REGION = config.aws.region;
const PREFIX = config.aws.reportPrefix.replace(/^\/+|\/+$/g, "");
const PUBLIC_BASE_URL = config.aws.publicBaseUrl.replace(/\/+$/, "");

/** Seconds a presigned report link stays valid. Seven days is the SigV4 max. */
const URL_TTL_SECONDS = config.aws.urlTtlSeconds;

let client;
function getClient() {
  if (!client) client = new S3Client({ region: REGION });
  return client;
}

/**
 * Whether anything was supplied, not whether it is valid — validating would
 * mean a network round trip on every health check.
 */
function isConfigured() {
  return config.aws.hasCredentials;
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
