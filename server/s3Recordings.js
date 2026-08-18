/**
 * Reads a student's recording out of Speak2Go's private recordings bucket.
 *
 * The client set this shape on 13 Aug 2026: "since user recordings are
 * sensitive objects, the cobe report generator will need to access them the
 * same way speak2go does, which is by using aws' GetObjectCommand with a
 * bucket name and key."
 *
 * So the question object now carries `audioFileKey`, not a URL. Nothing here
 * mints a presigned link or makes an object public — the file is streamed to a
 * temp path, transcribed, and deleted by examRunner's cleanup along with every
 * other temp file for that run.
 *
 * ACCESS IS READ-ONLY BY DESIGN. This module only ever issues GetObject. If a
 * credential here could write, a bug in the report path could overwrite a
 * student's recording — an unrecoverable loss of the evidence behind a grade.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

/**
 * Separate from the reports bucket: different data, different sensitivity,
 * and we hold different permissions on each (read-only here, write there).
 */
const BUCKET = process.env.S3_RECORDINGS_BUCKET || "s2g-recordings";
const REGION = process.env.S3_RECORDINGS_REGION || process.env.AWS_REGION || "us-east-1";

let client = null;
function getClient() {
  if (!client) client = new S3Client({ region: REGION });
  return client;
}

function isConfigured() {
  return Boolean(
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
      process.env.AWS_PROFILE ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE
  );
}

/**
 * Downloads one recording to a temp file.
 *
 * @param {object} params
 * @param {string} params.key - S3 object key, as supplied by Speak2Go
 * @param {string} [params.examId] - only used to name the temp file readably
 * @returns {Promise<string>} local path; the caller owns deleting it
 */
async function downloadRecordingByKey({ key, examId = "exam" }) {
  if (!key) throw new Error("downloadRecordingByKey: no key supplied");
  if (!isConfigured()) {
    throw new Error(
      "No AWS credentials configured, so the recordings bucket cannot be read. " +
        "Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY."
    );
  }

  // The key names the object; it must never be able to name a local path.
  // Without this a key like "../../etc/passwd" would choose where we write.
  const safeName = path
    .basename(String(key))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-80);
  const localPath = path.join(
    os.tmpdir(),
    `s2g_rec_${String(examId).replace(/[^a-zA-Z0-9._-]/g, "_")}_${Date.now()}_${safeName}`
  );

  let res;
  try {
    res = await getClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    // Named explicitly: "access denied" on this path almost always means the
    // read-only policy has not been attached yet, not that the file is absent.
    throw new Error(
      `Could not read recording "${key}" from ${BUCKET}: ${err.name} — ${err.message}`
    );
  }

  await pipeline(res.Body, fs.createWriteStream(localPath));
  return localPath;
}

module.exports = { downloadRecordingByKey, isConfigured, BUCKET, REGION };
