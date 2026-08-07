require("dotenv").config();

const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const { getBlueprint, getExamTotalPoints } = require("../src/config/examBlueprint");
const { DEFAULT_QUESTION_TEXTS, DEFAULT_PART_C_TRANSCRIPT } = require("./defaults");
const { createJob, updateJob, getJob, listJobs } = require("./jobStore");
const { runExam } = require("./examRunner");
const { listByStudent, downloadRecording, canFetchRecordings, RECORDING_PATH } = require("./recordings");
const { getReport } = require("./reportStore");
const { buildStudentObject, buildExamObject, CEFR_BY_LEVEL, LEVEL_LABEL } = require("./specObjects");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Audio lands in the OS temp dir; sttService reads from disk. Files are
// deleted by examRunner once the run finishes.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => {
      const safe = String(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `s2g_${Date.now()}_${Math.random().toString(36).slice(2)}_${safe}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per answer is generous
});

/**
 * The levels this module can grade, and why the third one cannot be.
 *
 * 3-point Boost is in the spec (section 1, CEFR A2) but no Boost rubric has
 * been supplied: neither the MoE Table of Specs docx nor the scoring xlsx
 * contains one — both cover COBE only, referencing She'elon 16387 for Boost
 * without reproducing its criteria. Guessing a rubric would produce grades
 * that look official and are not, so the level is exposed as blocked with the
 * reason attached rather than quietly omitted from the dropdown.
 */
const LEVELS = [
  { level: "5_UNITS_B2", label: LEVEL_LABEL["5_UNITS_B2"], cefr: "B2", supported: true },
  { level: "4_UNITS_B1", label: LEVEL_LABEL["4_UNITS_B1"], cefr: "B1", supported: true },
  {
    level: "3_UNITS_BOOST",
    label: LEVEL_LABEL["3_UNITS_BOOST"],
    cefr: "A2",
    supported: false,
    blockedReason:
      "No Boost rubric supplied. The MoE Table of Specs and the scoring sheet both cover " +
      "COBE only; Boost is referenced as She'elon 16387 but its criteria are not included. " +
      "Awaiting the rubric from the client.",
  },
];

/**
 * Health check, plus the integration facts the UI needs to explain itself:
 * which levels can actually be graded and whether recording fetch is wired up.
 */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    deepgramKey: Boolean(process.env.DEEPGRAM_API_KEY),
    openaiKey: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || "gpt-4o",
    recordingsFetch: canFetchRecordings(),
    recordingEndpoint: RECORDING_PATH,
    levels: LEVELS,
  });
});

/**
 * The exam shape the UI should render: one upload slot per blueprint question,
 * pre-filled with default question text.
 */
app.get("/api/blueprint", (req, res) => {
  const level = req.query.level || "5_UNITS_B2";
  const known = LEVELS.find((l) => l.level === level);
  if (known && !known.supported) {
    return res.status(422).json({ error: known.blockedReason, level, blocked: true });
  }

  try {
    const slots = getBlueprint(level).map((bp) => ({
      ...bp,
      question_text: DEFAULT_QUESTION_TEXTS[bp.question_id] || "",
    }));
    res.json({
      level,
      cefr_level: CEFR_BY_LEVEL[level] || null,
      level_label: LEVEL_LABEL[level] || level,
      totalPoints: getExamTotalPoints(level),
      slots,
      defaultPartCTranscript: DEFAULT_PART_C_TRANSCRIPT,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Available recordings, grouped student -> lesson, which is how they are
 * actually stored (users.freeSpeechArray[], keyed by idDetection).
 */
app.get("/api/recordings", (req, res) => {
  try {
    res.json({
      fetchEnabled: canFetchRecordings(),
      endpoint: RECORDING_PATH,
      students: listByStudent(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Pull one recording via the Speak2Go app endpoint. The unit is
 * (userEmail, idDetection) — not a URL — because the bucket is private and
 * the app resolves the S3 key itself after authorizing the caller.
 */
app.post("/api/recordings/fetch", async (req, res) => {
  const { userEmail, idDetection } = req.body || {};
  if (!userEmail || !idDetection) {
    return res.status(400).json({ error: "userEmail and idDetection are both required" });
  }

  try {
    const localPath = await downloadRecording({ userEmail, idDetection });
    res.json({ ok: true, localPath });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Start an exam run.
 *
 * Multipart form:
 *   - level, partCTranscript, partCClipId, examName, examDescription (text)
 *   - student: JSON object using REAL schema field names —
 *       { IDNumber, FirstName, LastName, StudentGrade, StudentMakbila,
 *         SemelMosad, schoolName }
 *     IDNumber is hashed before it is stored anywhere; the raw value is not
 *     retained past this function.
 *   - questions: JSON array of { question_id, question_text, localPath? }
 *   - files named audio_<question_id>
 *
 * Returns { examId, student_object, exam_object } immediately; poll
 * /api/exams/:id for progress.
 */
app.post("/api/exams", upload.any(), (req, res) => {
  try {
    const level = req.body.level || "5_UNITS_B2";
    const known = LEVELS.find((l) => l.level === level);
    if (known && !known.supported) {
      return res.status(422).json({ error: known.blockedReason });
    }

    const partCTranscript = req.body.partCTranscript || "";
    const partCClipId = req.body.partCClipId || "ui_part_c_clip";

    const studentInput = req.body.student ? JSON.parse(req.body.student) : {};
    const studentObject = buildStudentObject(studentInput);

    const submitted = req.body.questions ? JSON.parse(req.body.questions) : [];
    const byId = new Map(submitted.map((q) => [String(q.question_id), q]));

    const filesById = new Map();
    for (const f of req.files || []) {
      const match = /^audio_(.+)$/.exec(f.fieldname);
      if (match) filesById.set(match[1], f.path);
    }

    const blueprint = getBlueprint(level);
    const tempFiles = [];

    const questions = blueprint.map((bp) => {
      const supplied = byId.get(bp.question_id) || {};
      // Audio arrives either as a browser upload or as a path already fetched
      // from the platform via /api/recordings/fetch.
      const audioFilePath = filesById.get(bp.question_id) || supplied.localPath || null;
      if (audioFilePath) tempFiles.push(audioFilePath);

      return {
        question_id: bp.question_id,
        description: bp.description,
        part: bp.part,
        weight: bp.points,
        question_text: supplied.question_text || DEFAULT_QUESTION_TEXTS[bp.question_id] || "",
        audioFilePath,
        referenceMaterial: bp.part === "C" && partCTranscript ? partCTranscript : null,
      };
    });

    if (!questions.some((q) => q.audioFilePath)) {
      return res.status(400).json({
        error: "No audio supplied. Upload at least one answer, or fetch one from the platform.",
      });
    }

    const examId = `exam_${crypto.randomBytes(6).toString("hex")}`;
    const examObject = buildExamObject({
      examId,
      level,
      name: req.body.examName || null,
      description: req.body.examDescription || null,
      dateExecuted: req.body.dateExecuted || new Date().toISOString(),
    });

    createJob(examId, {
      studentName: studentObject.full_name,
      level,
      total: questions.length,
    });
    // Available while the run is still going, so the UI can show who is being
    // graded rather than an empty panel for several minutes.
    updateJob(examId, { student_object: studentObject, exam_object: examObject });

    // Fire and forget — the client polls for progress.
    runExam({
      examId,
      questions,
      level,
      partCTranscript,
      partCClipId,
      tempFiles,
      studentObject,
      examObject,
    });

    res.status(202).json({ examId, student_object: studentObject, exam_object: examObject });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Poll a run. */
app.get("/api/exams/:examId", (req, res) => {
  const job = getJob(req.params.examId);
  if (!job) return res.status(404).json({ error: "Unknown examId" });
  res.json(job);
});

/**
 * The report urls named in spec 3.1. Three views of the same run: the formal
 * report (html + pdf) that goes to the teacher, and the operator dashboard.
 */
app.get("/api/exams/:examId/report.html", (req, res) => {
  const stored = getReport(req.params.examId);
  if (!stored) return res.status(404).send("Report not found or evicted.");
  res.type("html").send(stored.html);
});

app.get("/api/exams/:examId/dashboard.html", (req, res) => {
  const stored = getReport(req.params.examId);
  if (!stored?.dashboardHtml) return res.status(404).send("Dashboard not found or evicted.");
  res.type("html").send(stored.dashboardHtml);
});

app.get("/api/exams/:examId/report.pdf", (req, res) => {
  const stored = getReport(req.params.examId);
  if (!stored?.pdfPath) return res.status(404).send("PDF not found or evicted.");
  res.type("pdf").set(
    "Content-Disposition",
    `attachment; filename="${req.params.examId}.pdf"`
  );
  res.sendFile(stored.pdfPath);
});

/** Recent runs, for the history strip. */
app.get("/api/exams", (req, res) => {
  res.json({ exams: listJobs() });
});

app.listen(PORT, () => {
  console.log(`\n  Speak2Go COBE evaluation server`);
  console.log(`  → http://localhost:${PORT}\n`);
  if (!process.env.DEEPGRAM_API_KEY || !process.env.OPENAI_API_KEY) {
    console.warn("  WARNING: DEEPGRAM_API_KEY / OPENAI_API_KEY missing from .env — runs will fail.\n");
  }
});

module.exports = app;
