const crypto = require("crypto");

const { getBlueprint, getExamTotalPoints } = require("../config/examBlueprint");
const { DEFAULT_QUESTION_TEXTS, DEFAULT_PART_C_TRANSCRIPT } = require("../config/defaults");
const { createJob, updateJob, getJob, listJobs } = require("../db/jobRepository");
const { runExam } = require("../jobs/examRunJob");
const { buildStudentObject, buildExamObject, CEFR_BY_LEVEL, LEVEL_LABEL } = require("./specObjectsService");
const { badRequest, notFound } = require("../utils/AppError");

/**
 * Exam logic: turning a validated request into a graded run.
 *
 * No req/res in here — arguments in, result out, per the style guide. That is
 * what makes the interesting part testable without standing up an HTTP server.
 */

/** The levels this service can grade, for the UI to render. */
const LEVELS = [
  { level: "5_UNITS_B2", label: LEVEL_LABEL["5_UNITS_B2"], cefr: "B2", supported: true },
  { level: "4_UNITS_B1", label: LEVEL_LABEL["4_UNITS_B1"], cefr: "B1", supported: true },
];

/** The slot list a UI should render for a level, pre-filled with question text. */
function getBlueprintForLevel(level) {
  return {
    level,
    cefrLevel: CEFR_BY_LEVEL[level] || null,
    levelLabel: LEVEL_LABEL[level] || level,
    totalPoints: getExamTotalPoints(level),
    slots: getBlueprint(level).map((bp) => ({
      ...bp,
      question_text: DEFAULT_QUESTION_TEXTS[bp.question_id] || "",
    })),
    defaultPartCTranscript: DEFAULT_PART_C_TRANSCRIPT,
  };
}

/**
 * Builds the question list the scoring engine takes, by walking the blueprint
 * for the level and attaching whatever the caller supplied for each slot.
 *
 * Driven by the blueprint rather than by the submitted array on purpose: a
 * question nobody submitted still has to appear, or it silently stops counting
 * toward the exam's 100 points.
 */
function buildQuestions({ level, questions, audioByQuestionId, partCTranscript }) {
  const suppliedById = new Map(questions.map((q) => [String(q.question_id), q]));
  const tempFiles = [];

  const built = getBlueprint(level).map((bp) => {
    const supplied = suppliedById.get(bp.question_id) || {};
    // Audio arrives either as a browser upload or as a path already fetched
    // from the platform via /api/recordings/fetch.
    const audioFilePath = audioByQuestionId.get(bp.question_id) || supplied.localPath || null;
    if (audioFilePath) tempFiles.push(audioFilePath);

    return {
      question_id: bp.question_id,
      description: bp.description,
      part: bp.part,
      weight: bp.points,
      question_text: supplied.question_text || DEFAULT_QUESTION_TEXTS[bp.question_id] || "",
      questionType: supplied.questionType || supplied.question_type || null,
      audioFilePath,
      // A key, not a URL: the recordings bucket is private, so we read it with
      // GetObjectCommand the same way the Speak2Go app does.
      audioFileKey: supplied.audioFileKey || supplied.audio_file_key || null,
      // Speak2Go mints the playback token, so a finished URL is passed through
      // rather than rebuilt here.
      audioPlaybackUrl: supplied.audioPlaybackUrl || supplied.audio_playback_url || null,
      // Per-question clip transcript. Part C's two questions can reference
      // different clips, and scoring an answer against the wrong one makes it
      // read as off-topic. partCTranscript is the fallback for the operator
      // UI, which has a single paste box.
      referenceMaterial:
        supplied.videoTranscription ??
        supplied.video_transcription ??
        (bp.part === "C" && partCTranscript ? partCTranscript : null),
    };
  });

  return { questions: built, tempFiles };
}

/**
 * Starts a run and returns immediately; the caller polls for progress.
 * A full exam is ~5 transcriptions and ~5 scoring calls, far too long to hold
 * an HTTP request open.
 */
function createExam(input) {
  const { questions, tempFiles } = buildQuestions(input);

  if (!questions.some((q) => q.audioFilePath || q.audioFileKey)) {
    throw badRequest(
      "No audio supplied. Upload at least one answer, or fetch one from the platform."
    );
  }

  const examId = `exam_${crypto.randomBytes(6).toString("hex")}`;
  const studentObject = buildStudentObject(input.student);
  const examObject = buildExamObject({
    examId,
    level: input.level,
    name: input.examName,
    description: input.examDescription,
    dateExecuted: input.dateExecuted || new Date().toISOString(),
  });

  createJob(examId, {
    studentName: studentObject.fullName,
    level: input.level,
    total: questions.length,
  });
  // Available while the run is still going, so a UI can show who is being
  // graded rather than an empty panel for several minutes.
  updateJob(examId, { studentObject, examObject });

  // Fire and forget.
  runExam({
    examId,
    questions,
    level: input.level,
    partCTranscript: input.partCTranscript,
    partCClipId: input.partCClipId,
    tempFiles,
    studentObject,
    examObject,
    callbackUrl: input.callbackUrl,
  });

  return { examId, studentObject, examObject };
}

function getExam(examId) {
  const job = getJob(examId);
  if (!job) throw notFound("Unknown examId");
  return job;
}

const listExams = () => ({ exams: listJobs() });

module.exports = { LEVELS, getBlueprintForLevel, buildQuestions, createExam, getExam, listExams };
