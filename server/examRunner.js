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
const { deliverResult } = require("./webhook");

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
 * @param {string} [params.callbackUrl] - where to POST the finished result.
 *   Supplied by Speak2Go on the Exam Object; validated and signed in webhook.js
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
  callbackUrl = null,
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
      examId,
      studentName: studentObject?.fullName || "Student",
      examLevel: examObject?.levelLabel || level,
      cefrLevel: examObject?.cefrLevel || null,
      dateExecuted: examObject?.dateExecuted || new Date().toISOString(),
      schoolName: studentObject?.schoolName || null,
      className: studentObject?.className || null,
    };

    const urls = await buildReports({ examId, examResult, report, meta });

    // Close out the Exam Object now that the two fields that could only be
    // known after the run — the score and the report urls — exist. Re-derive
    // it through the same builder rather than spreading, so one place stays
    // responsible for the shape and half-updated objects can't happen.
    const finalExamObject = buildExamObject({
      examId,
      level,
      name: examObject?.name,
      description: examObject?.description,
      dateExecuted: meta.dateExecuted,
      examLessonFlag: examObject?.examLesson,
      examLessonSource: examObject?.examLessonSource,
      finalScore: examResult.overall_score,
      reportHtmlUrl: urls.reportHtmlUrl,
      reportPdfUrl: urls.reportPdfUrl,
    });
    finalExamObject.reportDashboardUrl = urls.reportDashboardUrl;

    updateJob(examId, {
      status: "done",
      stage: "done",
      result: examResult,
      report,
      examObject: finalExamObject,
      studentObject,
      finishedAt: new Date().toISOString(),
    });

    // Hand the result to Speak2Go. Deliberately after the job is marked done
    // and deliberately not allowed to fail the run: the exam is graded either
    // way, and a callback that cannot be reached is a delivery problem, not a
    // grading one. The outcome is recorded on the job so it stays visible.
    // Normally supplied alongside the Exam Object. The nested form is still
    // honoured so a caller written against the earlier shape keeps working.
    const target = callbackUrl || examObject?.callbackUrl || null;
    if (target) {
      const delivery = await deliverResult({
        examId,
        callbackUrl: target,
        payload: { examObject: finalExamObject, studentObject, report },
      });
      updateJob(examId, { delivery });
    }
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
