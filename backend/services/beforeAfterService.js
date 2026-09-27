'use strict';

const path = require('node:path');
const AppError = require('./AppError');

const CATEGORY_KEYS = ['testing', 'documentation', 'structure', 'codeQuality', 'dependencies'];
const FIXED_CHECKS = new Set([
  'node --test',
  'jest --runInBand',
  'vitest run',
  'mocha',
  'Changed files exist',
]);

function invalidInput(message = 'Before/after comparison input is incomplete or invalid.') {
  return new AppError('INVALID_BEFORE_AFTER_INPUT', 400, message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRelativePath(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') &&
    !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !/^[a-zA-Z]:/.test(value) &&
    !value.split(/[\\/]/).includes('..') && value !== '.';
}

function normalizePaths(paths, name) {
  if (!Array.isArray(paths)) throw invalidInput(`${name} must be a list of relative paths.`);
  if (!paths.every(safeRelativePath)) throw invalidInput(`${name} contains an unsafe path.`);
  return [...new Set(paths)];
}

function optionalScore(source, key, label) {
  if (!Object.hasOwn(source, key) || source[key] == null) return null;
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw invalidInput(`${label} contains a malformed ${key} score.`);
  }
  return value;
}

function normalizeHealthResult(result, label) {
  if (!isRecord(result)) throw invalidInput(`${label} health result is required.`);

  const scores = Object.hasOwn(result, 'healthScore') ? result.healthScore : result;
  if (scores == null) {
    return {
      score: null,
      categories: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, null])),
    };
  }
  if (!isRecord(scores)) throw invalidInput(`${label} health score must be an object.`);

  return {
    score: optionalScore(scores, 'overall', label),
    categories: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, optionalScore(scores, key, label)])),
  };
}

function normalizeCheckName(value, approvedFiles) {
  if (typeof value !== 'string') throw invalidInput('Verification checks must be strings.');
  if (FIXED_CHECKS.has(value)) return value;

  const syntaxCheck = value.match(/^node --check (.+)$/);
  if (syntaxCheck && safeRelativePath(syntaxCheck[1]) && approvedFiles.has(syntaxCheck[1])) return value;

  throw invalidInput('Verification result contains an unsupported check.');
}

function normalizeChecks(verificationResult, approvedFiles) {
  const checksRun = verificationResult.checksRun ?? [];
  const passedChecks = verificationResult.passedChecks ?? [];
  const failedChecks = verificationResult.failedChecks ?? [];
  if (!Array.isArray(checksRun) || !Array.isArray(passedChecks) || !Array.isArray(failedChecks)) {
    throw invalidInput('Verification check details are malformed.');
  }

  return {
    checksRun: checksRun.map((check) => normalizeCheckName(check, approvedFiles)),
    passedChecks: passedChecks.map((check) => normalizeCheckName(check, approvedFiles)),
    failedChecks: failedChecks.map((failure) => {
      if (!isRecord(failure)) throw invalidInput('A failed verification check is malformed.');
      const check = normalizeCheckName(failure.check, approvedFiles);
      const normalized = { check };
      if (Number.isInteger(failure.exitCode)) normalized.exitCode = failure.exitCode;
      if (typeof failure.signal === 'string' && /^SIG[A-Z0-9]+$/.test(failure.signal)) {
        normalized.signal = failure.signal;
      }
      return normalized;
    }),
  };
}

function buildSummary(beforeScore, afterScore, scoreDelta, verificationStatus, changedFiles) {
  let scoreSummary;
  if (beforeScore === null || afterScore === null) {
    scoreSummary = 'Health score comparison is unavailable because a score is missing.';
  } else if (scoreDelta > 0) {
    scoreSummary = verificationStatus === 'passed'
      ? `Health improved by ${scoreDelta} points and verification passed.`
      : `Health score increased by ${scoreDelta} points, but verification failed.`;
  } else if (scoreDelta < 0) {
    scoreSummary = `Health score decreased by ${Math.abs(scoreDelta)} points.`;
  } else {
    scoreSummary = `Health score was unchanged; verification ${verificationStatus}.`;
  }

  const fileSummary = changedFiles.length === 0
    ? ' No approved changed files were confirmed.'
    : ` ${changedFiles.length} approved changed file${changedFiles.length === 1 ? ' was' : 's were'} confirmed.`;
  return `${scoreSummary}${fileSummary}`;
}

function compareBeforeAfter({ beforeHealthResult, afterHealthResult, treatmentResult, verificationResult } = {}) {
  if (!isRecord(treatmentResult) || !isRecord(verificationResult)) {
    throw invalidInput('Treatment and verification results are required.');
  }
  if (!['applied', 'no_changes'].includes(treatmentResult.status)) {
    throw invalidInput('Treatment result status is invalid.');
  }
  if (!['passed', 'failed'].includes(verificationResult.status)) {
    throw invalidInput('Verification status must be passed or failed.');
  }

  const treatmentFiles = normalizePaths(treatmentResult.changedFiles, 'Treatment changed files');
  const verificationFiles = normalizePaths(verificationResult.changedFiles, 'Verification changed files');
  const verificationFileSet = new Set(verificationFiles);
  const changedFiles = treatmentFiles.filter((file) => verificationFileSet.has(file));
  const approvedFiles = new Set(changedFiles);

  const before = normalizeHealthResult(beforeHealthResult, 'Before');
  const after = normalizeHealthResult(afterHealthResult, 'After');
  const scoreDelta = before.score === null || after.score === null ? null : after.score - before.score;
  const verificationChecks = normalizeChecks(verificationResult, approvedFiles);
  const improved = scoreDelta !== null && scoreDelta > 0 && verificationResult.status === 'passed';

  return {
    beforeScore: before.score,
    afterScore: after.score,
    scoreDelta,
    beforeCategories: before.categories,
    afterCategories: after.categories,
    changedFiles,
    verificationStatus: verificationResult.status,
    verificationChecks,
    improved,
    summary: buildSummary(before.score, after.score, scoreDelta, verificationResult.status, changedFiles),
  };
}

module.exports = { compareBeforeAfter };