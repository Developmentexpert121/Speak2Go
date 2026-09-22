const { badRequest } = require("../utils/AppError");

/**
 * A recording is addressed by (userEmail, idDetection) rather than by URL,
 * because the bucket is private and the Speak2Go app resolves the key itself
 * after authorising the caller. Both halves are therefore required.
 */
function validateFetchRecording(body = {}) {
  const userEmail = String(body.userEmail || "").trim();
  const idDetection = String(body.idDetection || "").trim();

  const missing = [];
  if (!userEmail) missing.push("userEmail");
  if (!idDetection) missing.push("idDetection");
  if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(", ")}`);

  return { userEmail, idDetection };
}

module.exports = { validateFetchRecording };
