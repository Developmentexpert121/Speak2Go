/**
 * An error carrying the HTTP status it should be reported as.
 *
 * Services throw these and the central error handler turns them into
 * responses. That is what lets a service stay free of `res` — it says what
 * went wrong and how serious it is, and the HTTP layer decides the wording of
 * the reply.
 *
 * Anything thrown that is NOT an AppError is treated as a 500 by the handler,
 * which is the safe default: an unexpected error is a bug, not a client
 * mistake, and should not be reported as one.
 */
class AppError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = "AppError";
    this.status = status;
    if (details) this.details = details;
  }
}

const badRequest = (message, details) => new AppError(message, 400, details);
const notFound = (message) => new AppError(message, 404);
const unprocessable = (message) => new AppError(message, 422);
const badGateway = (message) => new AppError(message, 502);

module.exports = { AppError, badRequest, notFound, unprocessable, badGateway };
