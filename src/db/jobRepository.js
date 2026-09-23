/**
 * In-memory store of exam runs, keyed by examId. See docs/architecture.md for
 * why this is not a database.
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
    // then patched with finalScore and the report urls when it finishes.
    examObject: null,
    studentObject: null,
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
    .map(({ examId, status, stage, createdAt, finishedAt, meta, result, studentObject, examObject }) => ({
      examId,
      status,
      stage,
      createdAt,
      finishedAt,
      // Never the raw IDNumber — studentObject.studentId is already hashed.
      studentName: studentObject?.fullName || meta?.studentName || null,
      studentId: studentObject?.studentId || null,
      schoolId: studentObject?.schoolId || null,
      level: meta?.level || null,
      cefrLevel: examObject?.cefrLevel || null,
      overallScore: result?.overall_score ?? null,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

module.exports = { createJob, updateJob, getJob, listJobs };
