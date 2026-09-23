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
 *
 * WHO MINTS THE TOKEN. The link needs to work for a teacher who is not logged
 * in, so it carries a token. Speak2Go mints that token, not us: they own the
 * decision about who may hear a recording, they can revoke a link once issued,
 * and it keeps the signing key in one place rather than copied into this
 * service. When they supply a ready-made playback URL on the question we use
 * it verbatim; the constructed form below is the fallback for questions that
 * arrive without one.
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
