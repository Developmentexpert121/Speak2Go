const fs = require("fs");
const path = require("path");

/**
 * Temporary persistence layer while MongoDB access is blocked.
 *
 * Deliberately shaped like a repository/DAO — save/get/list — so that once
 * Mongo credentials arrive, this file is the ONLY thing that needs to be
 * swapped for a real Mongoose/native-driver implementation. Nothing else
 * in the pipeline (evaluateFullExam, report builder, API layer once built)
 * should need to change — they should only ever call these three functions.
 *
 * Storage layout: data/exams/<examId>.json
 * Each file holds: { examId, studentId, level, savedAt, examResult, report }
 */
const STORE_DIR = path.join(__dirname, "..", "..", "data", "exams");

function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function filePathFor(examId) {
  // basic sanitization — examId becomes a filename
  const safeId = String(examId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STORE_DIR, `${safeId}.json`);
}

/**
 * @param {string} examId - unique exam identifier (matches spec's exam_id)
 * @param {object} record - { studentId, level, examResult, report }
 */
async function saveExamResult(examId, record) {
  ensureStoreDir();
  const payload = {
    examId,
    savedAt: new Date().toISOString(),
    ...record,
  };
  fs.writeFileSync(filePathFor(examId), JSON.stringify(payload, null, 2));
  return payload;
}

async function getExamResult(examId) {
  ensureStoreDir();
  const fp = filePathFor(examId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

async function listExams({ studentId } = {}) {
  ensureStoreDir();
  const files = fs.readdirSync(STORE_DIR).filter((f) => f.endsWith(".json"));
  const all = files.map((f) => JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), "utf-8")));
  return studentId ? all.filter((r) => r.studentId === studentId) : all;
}

module.exports = { saveExamResult, getExamResult, listExams };
