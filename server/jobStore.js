/**
 * In-memory job store for exam runs.
 *
 * A full exam is ~5 Deepgram calls plus ~5 LLM calls run sequentially, which
 * takes minutes — far longer than a browser or proxy will hold a single HTTP
 * request open. So the API accepts the upload, returns an examId immediately,
 * and the client polls for progress.
 *
 * Deliberately in-memory: the client has asked that nothing be written to a
 * database for now. That means job state is lost on restart, which is fine for
 * a single-operator tool but is the first thing to revisit if this is ever
 * deployed for real. Shaped like save/get/list so swapping in a real store
 * later touches only this file.
 */

const jobs = new Map();

// Keep the process from growing without bound during a long session.
const MAX_JOBS = 50;

function createJob(examId, meta = {}) {
  const job = {
    examId,
    status: "queued", // queued | running | done | error
    stage: "queued",
    completed: 0,
    total: meta.total ?? 0,
    currentQuestionId: null,
    meta,
    result: null,
    report: null,
    // Spec section 3.1 / 3.2 objects. Populated up front from the submission
    // so the UI can show who is being graded while the run is still going,
    // then patched with final_score and the report urls when it finishes.
    exam_object: null,
    student_object: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(examId, job);

  // Evict oldest once over the cap.
  if (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.keys()][0];
    jobs.delete(oldest);
  }
  return job;
}

function updateJob(examId, patch) {
  const job = jobs.get(examId);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

function getJob(examId) {
  return jobs.get(examId) || null;
}

function listJobs() {
  return [...jobs.values()]
    .map(({ examId, status, stage, createdAt, finishedAt, meta, result, student_object, exam_object }) => ({
      examId,
      status,
      stage,
      createdAt,
      finishedAt,
      // Never the raw IDNumber — student_object.student_id is already hashed.
      studentName: student_object?.full_name || meta?.studentName || null,
      studentId: student_object?.student_id || null,
      schoolId: student_object?.school_id || null,
      level: meta?.level || null,
      cefr_level: exam_object?.cefr_level || null,
      overall_score: result?.overall_score ?? null,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

module.exports = { createJob, updateJob, getJob, listJobs };
