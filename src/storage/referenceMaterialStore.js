const fs = require("fs");
const path = require("path");

/**
 * Persistence layer for Part C reference-material transcripts.
 *
 * Deliberately shaped like fileStore.js (save / get) so that once a real DB
 * is available, only this file needs to be swapped — all callers remain
 * unchanged.
 *
 * Key: the lesson clip's ID_detection value (a string, typically the platform's
 * video/detection ID).  This is intentionally NOT keyed by topic name, because
 * two different lessons can share the same topic ("Books") while having
 * completely different clips, and two different Part C clips can appear inside
 * the same lesson.  Using the actual clip ID is the only collision-free key.
 *
 * Storage layout: data/reference_material/<sanitised-id>.json
 * Each file holds: { idDetection, savedAt, transcript }
 */
const STORE_DIR = path.join(__dirname, "..", "..", "data", "reference_material");

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function filePathFor(idDetection) {
  // Match the sanitisation used in fileStore so the two stores are consistent.
  const safeId = String(idDetection).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STORE_DIR, `${safeId}.json`);
}

/**
 * Persist a transcript for a given clip ID.
 *
 * @param {string} idDetection - the clip's ID_detection value from the lesson
 * @param {string} transcript  - plain-text transcript of the clip
 * @returns {object} the stored record
 */
async function saveReferenceMaterial(idDetection, transcript) {
  ensureStoreDir();
  const payload = {
    idDetection: String(idDetection),
    savedAt: new Date().toISOString(),
    transcript: String(transcript),
  };
  fs.writeFileSync(filePathFor(idDetection), JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Retrieve the transcript for a given clip ID, or null if not yet on file.
 *
 * Returning null (not throwing) keeps the pipeline degrading gracefully:
 * an unanswered Part C question is scored without a reference transcript
 * rather than crashing the whole exam.
 *
 * @param {string} idDetection
 * @returns {string|null}
 */
async function getReferenceMaterial(idDetection) {
  ensureStoreDir();
  const fp = filePathFor(idDetection);
  if (!fs.existsSync(fp)) return null;
  const record = JSON.parse(fs.readFileSync(fp, "utf-8"));
  return record.transcript ?? null;
}

module.exports = { saveReferenceMaterial, getReferenceMaterial };
