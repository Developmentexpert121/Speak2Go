/**
 * Reads student recordings from the private recordings bucket, the same way
 * the Speak2Go app does.
 *
 * Separate from the reports bucket: different data, different sensitivity,
 * and read-only here against read/write there.
 *
 * File extensions in this bucket LIE — every object is named .mp3 and the
 * real containers are WebM and Ogg. Nothing may branch on the extension.
 * See docs/integrations.md.
 */

/**
 * FILE EXTENSIONS IN THIS BUCKET LIE. Every recording is named ".mp3", but
 * sampling the objects on 19 Aug 2026 showed the actual containers are WebM
 * and Ogg — what a browser's MediaRecorder produces. Nothing here or in
 * sttService.js branches on the extension: the raw bytes are handed to
 * Deepgram, which sniffs the container itself, and a real recording was
 * transcribed end to end at 0.999 confidence to confirm it.
 *
 * So do not "fix" the naming by deriving a mime type from the key, and do not
 * add a decoder chosen by extension. Both would break every object in the
 * bucket while looking like a tidy-up.
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
const config = require("../config");

const BUCKET = config.aws.recordingsBucket;
const REGION = config.aws.region;

let client = null;
function getClient() {
  if (!client) client = new S3Client({ region: REGION });
  return client;
}

function isConfigured() {
  return config.aws.hasCredentials;
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
