const { AppError } = require("../utils/AppError");

/**
 * The single place an error becomes a response.
 *
 * An AppError was predicted, so its message is safe to return. Anything else
 * is a bug: logged in full, reported as a bare 500, because a stack can carry
 * file paths, keys or a student's data. See docs/architecture.md.
 */
function errorHandler(err, req, res, _next) {
  const isKnown = err instanceof AppError;
  const status = isKnown ? err.status : 500;

  if (!isKnown) {
    console.error(`  unhandled error on ${req.method} ${req.originalUrl}:`, err);
  }

  res.status(status).json({
    error: isKnown ? err.message : "Internal server error",
    ...(isKnown && err.details ? { details: err.details } : {}),
  });
}

/** 404 for anything no route claimed, so it reaches errorHandler too. */
function notFoundHandler(req, res, next) {
  next(new AppError(`No route for ${req.method} ${req.originalUrl}`, 404));
}

module.exports = { errorHandler, notFoundHandler };
