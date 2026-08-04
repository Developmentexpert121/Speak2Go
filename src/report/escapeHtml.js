/**
 * Escapes a value for safe interpolation into HTML text or a quoted attribute.
 *
 * This matters more than it looks: deduction reasons carry
 * `contentFlags.flag_reasoning`, which is model-generated text quoting the
 * student's own transcript. Without escaping, whatever a student says can
 * reach a teacher-facing page as live markup.
 */
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formats a number safely — never throws on null/undefined/NaN.
 *
 * null and undefined are rejected explicitly rather than left to Number(),
 * which coerces both to 0. Displaying a missing score as "0.0" would read as
 * "the student scored zero" instead of "this was never scored".
 */
function num(value, decimals = 1, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : fallback;
}

module.exports = { esc, num };
