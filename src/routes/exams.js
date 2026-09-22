const express = require("express");
const multer = require("multer");
const os = require("os");

const examService = require("../services/examService");
const reportDocumentService = require("../services/reportDocumentService");
const { validateCreateExam, validateBlueprintQuery } = require("../validators/examValidator");
const { asyncHandler } = require("../middleware/asyncHandler");

const router = express.Router();

// Audio lands in the OS temp dir; the transcription client reads from disk.
// Files are deleted by the exam job once the run finishes.
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

router.get("/blueprint", (req, res) => {
  const { level } = validateBlueprintQuery(req.query);
  res.json(examService.getBlueprintForLevel(level));
});

/**
 * Start an exam run. Returns { examId, studentObject, examObject } straight
 * away; poll GET /api/exams/:examId for progress.
 */
router.post("/exams", upload.any(), (req, res) => {
  const input = validateCreateExam(req.body, req.files);
  res.status(202).json(examService.createExam(input));
});

router.get("/exams", (req, res) => res.json(examService.listExams()));

router.get("/exams/:examId", (req, res) => res.json(examService.getExam(req.params.examId)));

router.get("/exams/:examId/report.html", (req, res) =>
  res.type("html").send(reportDocumentService.getReportHtml(req.params.examId))
);

router.get("/exams/:examId/dashboard.html", (req, res) =>
  res.type("html").send(reportDocumentService.getDashboardHtml(req.params.examId))
);

router.get("/exams/:examId/report.pdf", (req, res) => {
  const pdfPath = reportDocumentService.getReportPdfPath(req.params.examId);
  res
    .type("pdf")
    .set("Content-Disposition", `attachment; filename="${req.params.examId}.pdf"`)
    .sendFile(pdfPath);
});

module.exports = router;
