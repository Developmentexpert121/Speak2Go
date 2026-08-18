/**
 * Builds the link a report uses to play back a student's recording.
 *
 * The client specified this format on 13 Aug 2026:
 *
 *   https://app.speak2go.com/#/recordings/play?r=<reportId>&q=<questionId>
 *
 * WHY NOT A DIRECT S3 LINK. We already have the ability to mint presigned URLs
 * to the recordings bucket, and it would be less code. The client explicitly
 * ruled it out: they do not want time-limited links, and they do not want the
 * recordings bucket public. A report is a document that may be opened months
 * later — a presigned URL inside it is a dead link by then, and the only
 * alternative would be making the bucket readable to anyone with the object
 * path. Pointing at their own app means the link never expires and Speak2Go
 * authorises each playback itself.
 *
 * This module therefore builds a URL and nothing else. It never touches S3.
 */

/** Overridable so a staging deployment does not link into production. */
function appBaseUrl() {
  return (process.env.SPEAK2GO_APP_BASE_URL || "https://app.speak2go.com").replace(/\/+$/, "");
}

/**
 * @param {object} params
 * @param {string} params.reportId - the exam/report this recording belongs to
 * @param {string} params.questionId - which question within it
 * @returns {string|null} null when either id is missing, so a report with
 *   incomplete data renders without a link rather than with a broken one
 *   pointing at "undefined".
 */
function buildRecordingUrl({ reportId, questionId }) {
  const r = String(reportId ?? "").trim();
  const q = String(questionId ?? "").trim();
  if (!r || !q) return null;

  // Both ids are interpolated into a query string, so they are encoded rather
  // than trusted. questionId in particular is now a Speak2Go-supplied value.
  return `${appBaseUrl()}/#/recordings/play?r=${encodeURIComponent(r)}&q=${encodeURIComponent(q)}`;
}

module.exports = { buildRecordingUrl, appBaseUrl };
