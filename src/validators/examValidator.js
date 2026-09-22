const { badRequest, unprocessable } = require("../utils/AppError");
const { normalizeLevel } = require("../services/specObjectsService");

/**
 * Validates and normalises the multipart body of POST /api/exams.
 *
 * Kept out of both the route and the service: the route should not know the
 * shape of the payload, and the service should not know the payload arrived as
 * multipart form fields with JSON-encoded strings inside it. This is the layer
 * that turns a request into plain arguments.
 *
 * It throws rather than returning an error object, so a caller cannot forget
 * to check the result.
 */

const SUPPORTED_LEVELS = ["5_UNITS_B2", "4_UNITS_B1"];

/** JSON.parse that reports which field was malformed rather than "unexpected token". */
function parseJsonField(raw, fieldName, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest(`"${fieldName}" is not valid JSON`);
  }
}

function validateCreateExam(body = {}, files = []) {
  // Accepts the pre-spec-doc spellings ("5_UNITS_CEFR_B2") and returns the
  // canonical one, so an older caller is not rejected over a naming change.
  const level = normalizeLevel(body.level || "5_UNITS_B2");
  if (!SUPPORTED_LEVELS.includes(level)) {
    throw unprocessable(
      `Level "${level}" cannot be graded. Supported: ${SUPPORTED_LEVELS.join(", ")}`
    );
  }

  const student = parseJsonField(body.student, "student", {});
  const questions = parseJsonField(body.questions, "questions", []);
  if (!Array.isArray(questions)) throw badRequest(`"questions" must be an array`);

  // Audio arrives as files named audio_<question_id>.
  const audioByQuestionId = new Map();
  for (const file of files) {
    const match = /^audio_(.+)$/.exec(file.fieldname);
    if (match) audioByQuestionId.set(match[1], file.path);
  }

  return {
    level,
    student,
    questions,
    audioByQuestionId,
    partCTranscript: body.partCTranscript || "",
    partCClipId: body.partCClipId || "ui_part_c_clip",
    examName: body.examName || null,
    examDescription: body.examDescription || null,
    dateExecuted: body.dateExecuted || null,
    // Caller-supplied, so the result callback rejects it later unless its host
    // is on the allowlist. Not validated here beyond presence: the SSRF check
    // belongs with the code that makes the request.
    callbackUrl: body.callbackUrl || null,
  };
}

function validateBlueprintQuery(query = {}) {
  const level = normalizeLevel(query.level || "5_UNITS_B2");
  if (!SUPPORTED_LEVELS.includes(level)) {
    throw unprocessable(
      `Level "${level}" cannot be graded. Supported: ${SUPPORTED_LEVELS.join(", ")}`
    );
  }
  return { level };
}

module.exports = { validateCreateExam, validateBlueprintQuery, SUPPORTED_LEVELS };
