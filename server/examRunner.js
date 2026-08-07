/**
 * Drives one exam run end to end, updating the job store as it goes.
 *
 * This is the orchestrator the repo previously lacked: the scoring engine was
 * complete but only reachable from manual CLI scripts. Nothing here changes
 * scoring behaviour — it just sequences the existing pieces:
 *
 *   reference material -> evaluateFullExam -> generateRecommendations
 *                      -> buildReportObject -> render HTML + PDF
 *
 * Results are returned to the caller and held in memory only. Per the client's
 * instruction, nothing is written to a database.
 */

const fs = require("fs");

const { evaluateFullExam } = require("../src/pipeline/evaluateFullExam");
const { generateRecommendations } = require("../src/report/generateRecommendations");
const { buildReportObject } = require("../src/report/buildReportObject");
const { saveReferenceMaterial } = require("../src/storage/referenceMaterialStore");
const { updateJob } = require("./jobStore");
const { buildReports } = require("./reportStore");
const { buildExamObject } = require("./specObjects");

/**
 * @param {object} params
 * @param {string} params.examId
 * @param {Array}  params.questions - [{ question_id, description, part, weight,
 *   question_text, audioFilePath|null, referenceMaterial|null }]
 * @param {string} params.level
 * @param {string} [params.partCTranscript] - seeded into the reference store
 * @param {string} [params.partCClipId]
 * @param {Array}  [params.tempFiles] - paths to delete once the run finishes
 * @param {object} [params.studentObject] - spec 3.2, built by the caller
 * @param {object} [params.examObject] - spec 3.1, built by the caller
 */
async function runExam({
  examId,
  questions,
  level,
  partCTranscript,
  partCClipId,
  tempFiles = [],
  studentObject = null,
  examObject = null,
}) {
  try {
    updateJob(examId, { status: "running", stage: "starting", total: questions.length });

    // Seed the Part C clip transcript so the production lookup path has
    // something to find. Without a DB this lives under data/reference_material.
    if (partCTranscript && partCClipId) {
      updateJob(examId, { stage: "seeding_reference_material" });
      await saveReferenceMaterial(partCClipId, partCTranscript);
    }

    const examResult = await evaluateFullExam({
      questions,
      level,
      onProgress: ({ stage, question_id, completed, total }) => {
        updateJob(examId, {
          stage: stage === "evaluating" ? "transcribing_and_scoring" : "question_done",
          currentQuestionId: question_id,
          completed,
          total,
        });
      },
    });

    updateJob(examId, { stage: "generating_recommendations", result: examResult });

    let recommendations = "";
    try {
      recommendations = await generateRecommendations(examResult);
    } catch (err) {
      // A failed summary shouldn't throw away a completed exam — the scores
      // are the valuable part, the recommendations are a convenience.
      recommendations = `(Teacher recommendations could not be generated: ${err.message})`;
    }

    const report = buildReportObject(examResult, recommendations);

    // Spec section 2 asks for both an HTML report for inline rendering and a
    // downloadable PDF, and 3.1 stores their urls on the Exam Object. Render
    // them here so those two fields hold something fetchable rather than null.
    updateJob(examId, { stage: "rendering_reports", result: examResult, report });

    const meta = {
      studentName: studentObject?.full_name || "Student",
      examLevel: examObject?.level_label || level,
      cefrLevel: examObject?.cefr_level || null,
      dateExecuted: examObject?.date_executed || new Date().toISOString(),
      schoolName: studentObject?.school_name || null,
      gradeClass: studentObject?.grade_class || null,
    };

    const urls = await buildReports({ examId, examResult, report, meta });

    // Close out the Exam Object now that the two fields that could only be
    // known after the run — the score and the report urls — exist.
    // examObject arrives already in spec (snake_case) shape, so re-derive it
    // through the same builder rather than spreading — that keeps one place
    // responsible for the shape and avoids half-updated objects.
    const finalExamObject = buildExamObject({
      examId,
      level,
      name: examObject?.name,
      description: examObject?.description,
      dateExecuted: meta.dateExecuted,
      examLessonFlag: examObject?.exam_lesson,
      examLessonSource: examObject?.exam_lesson_source,
      finalScore: examResult.overall_score,
      reportHtmlUrl: urls.reportHtmlUrl,
      reportPdfUrl: urls.reportPdfUrl,
    });
    finalExamObject.report_dashboard_url = urls.reportDashboardUrl;

    updateJob(examId, {
      status: "done",
      stage: "done",
      result: examResult,
      report,
      exam_object: finalExamObject,
      student_object: studentObject,
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    updateJob(examId, {
      status: "error",
      stage: "error",
      error: err.message,
      finishedAt: new Date().toISOString(),
    });
  } finally {
    for (const f of tempFiles) {
      try {
        if (f && fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        /* best effort cleanup */
      }
    }
  }
}

module.exports = { runExam };
