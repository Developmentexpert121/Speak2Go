const { AppError } = require("../utils/AppError");

/**
 * The single place an error becomes a response.
 *
 * Routes and services throw; nothing below this line catches to build a reply.
 * The style guide asks for exactly this, and it also removes a class of bug
 * the previous per-route try/catch had: each route chose its own status code
 * and message shape, so the same failure could surface as a 400 from one
 * endpoint and a 500 from another.
 *
 * An AppError is something we predicted, so its message is safe to send back.
 * Anything else is a bug: it is logged in full here and reported to the caller
 * as a generic 500, because an unexpected stack can carry file paths, keys or
 * a student's data and none of that belongs in an HTTP response.
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
