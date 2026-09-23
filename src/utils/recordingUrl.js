/**
 * The playback link a report uses. Points at Speak2Go's app, never at S3:
 * a presigned link expires and a public bucket would expose recordings whose
 * keys contain students' ID numbers. Speak2Go mints the token, so a supplied
 * URL wins over the constructed one. See docs/integrations.md.
 *
 * Builds a URL and nothing else — it never touches S3.
 */

const config = require("../config");

/** Overridable so a staging deployment does not link into production. */
function appBaseUrl() {
  return (config.speak2go.appBaseUrl).replace(/\/+$/, "");
}

/**
 * @param {object} params
 * @param {string} params.reportId - the exam/report this recording belongs to
 * @param {string} params.questionId - which question within it
 * @returns {string|null} null when either id is missing, so a report with
 *   incomplete data renders without a link rather than with a broken one
 *   pointing at "undefined".
 */
function buildRecordingUrl({ reportId, questionId, playbackUrl = null }) {
  // A URL supplied by Speak2Go wins. It already carries their token, so
  // rebuilding it here would strip exactly the part that makes it work.
  // Only http(s) is accepted: the value ends up in an href, and a
  // "javascript:" URL there would be an XSS hole opened by the payload.
  const supplied = String(playbackUrl ?? "").trim();
  if (supplied && /^https?:\/\//i.test(supplied)) return supplied;

  const r = String(reportId ?? "").trim();
  const q = String(questionId ?? "").trim();
  if (!r || !q) return null;

  // Both ids are interpolated into a query string, so they are encoded rather
  // than trusted. questionId in particular is now a Speak2Go-supplied value.
  return `${appBaseUrl()}/#/recordings/play?r=${encodeURIComponent(r)}&q=${encodeURIComponent(q)}`;
}

module.exports = { buildRecordingUrl, appBaseUrl };
