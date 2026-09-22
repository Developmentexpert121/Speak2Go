/**
 * Wraps an async route so a rejected promise reaches the error handler.
 *
 * Express 5 forwards rejections automatically, but wrapping is explicit and
 * survives a downgrade. Without it an async route that throws hangs the
 * request instead of answering it — the failure mode is a timeout rather than
 * an error, which is considerably harder to diagnose.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
