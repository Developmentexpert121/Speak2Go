const fs = require("fs");
const path = require("path");

/**
 * Part C clip transcripts on disk, keyed by clip id.
 *
 * Shaped as save / get so that swapping in a real database later touches only
 * this file. Ids are sanitised so one cannot escape the directory via "../".
 */
const STORE_DIR = path.join(__dirname, "..", "..", "data", "reference_material");

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function filePathFor(idDetection) {
  // Sanitised so a clip id cannot escape the directory via "../".
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
