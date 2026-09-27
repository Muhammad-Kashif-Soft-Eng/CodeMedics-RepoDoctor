'use strict';

/**
 * AppError
 *
 * All deliberate errors thrown inside Codemedics services use this class.
 * It carries a machine-readable `code`, an HTTP status for the route layer,
 * and a human-readable `message` that is safe to forward to the frontend.
 *
 * Usage:
 *   throw new AppError('INVALID_URL', 400, 'The repository URL is not a valid GitHub URL.');
 */
class AppError extends Error {
  /**
   * @param {string} code        - Machine-readable error code (e.g. 'INVALID_URL')
   * @param {number} httpStatus  - HTTP status code the route should respond with
   * @param {string} message     - Human-readable message safe to return to the client
   */
  constructor(code, httpStatus, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    // Maintain a proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

module.exports = AppError;
