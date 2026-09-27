'use strict';

const path = require('node:path');
const { Router } = require('express');
const { compareBeforeAfter } = require('../services/beforeAfterService');
const AppError = require('../services/AppError');

const router = Router();
const REQUEST_KEYS = new Set([
    'beforeHealthResult',
    'afterHealthResult',
    'treatmentResult',
    'verificationResult',
]);
const SCORE_KEYS = new Set([
    'overall',
    'testing',
    'documentation',
    'structure',
    'codeQuality',
    'dependencies',
]);
const CATEGORY_KEYS = ['testing', 'documentation', 'structure', 'codeQuality', 'dependencies'];
const TREATMENT_KEYS = new Set(['status', 'changedFiles']);
const VERIFICATION_KEYS = new Set(['status', 'changedFiles', 'checksRun', 'passedChecks', 'failedChecks']);
const FAILED_CHECK_KEYS = new Set(['check', 'exitCode', 'signal']);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidRequest(message = 'The before/after request is incomplete or invalid.') {
    return new AppError('INVALID_BEFORE_AFTER_REQUEST', 400, message);
}

function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.has(key));
}

function validateScores(scores, label) {
    if (!isRecord(scores) || !hasOnlyKeys(scores, SCORE_KEYS)) {
        throw invalidRequest(`${label} health scores must contain only supported score fields.`);
    }
    for (const [key, value] of Object.entries(scores)) {
        if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) {
            throw invalidRequest(`${label} health score field "${key}" is invalid.`);
        }
    }
    return { healthScore: scores };
}

function validateHealthResult(value, label) {
    if (!isRecord(value)) throw invalidRequest(`${label} health result is required.`);
    if (Object.hasOwn(value, 'healthScore')) {
        if (!hasOnlyKeys(value, new Set(['healthScore']))) {
            throw invalidRequest(`${label} health result contains unsupported fields.`);
        }
        if (value.healthScore == null) return { healthScore: null };
        return validateScores(value.healthScore, label);
    }
    return validateScores(value, label);
}

function validateChangedFiles(files, label) {
    if (!Array.isArray(files) || files.length > 100) {
        throw invalidRequest(`${label} must be a list of at most 100 relative paths.`);
    }
    for (const file of files) {
        if (
            typeof file !== 'string' || !file.trim() || file.includes('\0') || file === '.' ||
            path.isAbsolute(file) || path.win32.isAbsolute(file) || /^[a-zA-Z]:/.test(file) ||
            file.split(/[\\/]/).includes('..')
        ) {
            throw invalidRequest(`${label} contains an unsafe relative path.`);
        }
    }
    return [...files];
}

function validateTreatmentResult(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, TREATMENT_KEYS)) {
        throw invalidRequest('A minimal treatment result is required.');
    }
    if (!['applied', 'no_changes'].includes(value.status)) {
        throw invalidRequest('Treatment result status is invalid.');
    }
    return {
        status: value.status,
        changedFiles: validateChangedFiles(value.changedFiles, 'Treatment changed files'),
    };
}

function validateCheckList(value, label) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.some((check) => typeof check !== 'string')) {
        throw invalidRequest(`${label} must be a list of check names.`);
    }
    return [...value];
}

function validateVerificationResult(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, VERIFICATION_KEYS)) {
        throw invalidRequest('A minimal verification result is required.');
    }
    if (!['passed', 'failed'].includes(value.status)) {
        throw invalidRequest('Verification status must be passed or failed.');
    }
    const failedChecks = value.failedChecks ?? [];
    if (!Array.isArray(failedChecks)) throw invalidRequest('Failed verification checks must be a list.');
    const safeFailures = failedChecks.map((failure) => {
        if (!isRecord(failure) || !hasOnlyKeys(failure, FAILED_CHECK_KEYS) || typeof failure.check !== 'string') {
            throw invalidRequest('Failed verification check details are malformed.');
        }
        const normalized = { check: failure.check };
        if (Number.isInteger(failure.exitCode)) normalized.exitCode = failure.exitCode;
        if (typeof failure.signal === 'string') normalized.signal = failure.signal;
        return normalized;
    });

    return {
        status: value.status,
        changedFiles: validateChangedFiles(value.changedFiles, 'Verification changed files'),
        checksRun: validateCheckList(value.checksRun, 'Checks run'),
        passedChecks: validateCheckList(value.passedChecks, 'Passed checks'),
        failedChecks: safeFailures,
    };
}

function validateRequest(body) {
    if (!isRecord(body) || !hasOnlyKeys(body, REQUEST_KEYS)) throw invalidRequest();
    return {
        beforeHealthResult: validateHealthResult(body.beforeHealthResult, 'Before'),
        afterHealthResult: validateHealthResult(body.afterHealthResult, 'After'),
        treatmentResult: validateTreatmentResult(body.treatmentResult),
        verificationResult: validateVerificationResult(body.verificationResult),
    };
}

function validateCategories(value, label) {
    if (!isRecord(value) || !hasOnlyKeys(value, new Set(CATEGORY_KEYS))) {
        throw new AppError('INVALID_BEFORE_AFTER_RESULT', 502, `The comparison service returned invalid ${label} categories.`);
    }
    const categories = {};
    for (const key of CATEGORY_KEYS) {
        const score = value[key];
        if (score != null && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100)) {
            throw new AppError('INVALID_BEFORE_AFTER_RESULT', 502, 'The comparison service returned invalid categories.');
        }
        categories[key] = score ?? null;
    }
    return categories;
}

function normalizeResult(result, input) {
    if (!isRecord(result)) {
        throw new AppError('INVALID_BEFORE_AFTER_RESULT', 502, 'The comparison service returned an invalid result.');
    }
    for (const key of ['beforeScore', 'afterScore', 'scoreDelta']) {
        if (result[key] != null && (typeof result[key] !== 'number' || !Number.isFinite(result[key]))) {
            throw new AppError('INVALID_BEFORE_AFTER_RESULT', 502, 'The comparison service returned invalid scores.');
        }
    }
    if (!['passed', 'failed'].includes(result.verificationStatus) || typeof result.improved !== 'boolean' || typeof result.summary !== 'string') {
        throw new AppError('INVALID_BEFORE_AFTER_RESULT', 502, 'The comparison service returned an invalid result.');
    }

    const changedFiles = validateChangedFiles(result.changedFiles, 'Comparison changed files');
    if (changedFiles.some((file) =>
        !input.treatmentResult.changedFiles.includes(file) ||
        !input.verificationResult.changedFiles.includes(file)
    )) {
        throw new AppError('INVALID_BEFORE_AFTER_RESULT', 502, 'The comparison service returned an unapproved changed file.');
    }

    if (!isRecord(result.verificationChecks) || !hasOnlyKeys(
        result.verificationChecks,
        new Set(['checksRun', 'passedChecks', 'failedChecks'])
    )) {
        throw new AppError('INVALID_BEFORE_AFTER_RESULT', 502, 'The comparison service returned invalid verification checks.');
    }
    const verificationChecks = {
        checksRun: validateCheckList(result.verificationChecks.checksRun, 'Checks run'),
        passedChecks: validateCheckList(result.verificationChecks.passedChecks, 'Passed checks'),
        failedChecks: validateVerificationResult({
            status: result.verificationStatus,
            changedFiles,
            failedChecks: result.verificationChecks.failedChecks,
        }).failedChecks,
    };

    return {
        beforeScore: result.beforeScore ?? null,
        afterScore: result.afterScore ?? null,
        scoreDelta: result.scoreDelta ?? null,
        beforeCategories: validateCategories(result.beforeCategories, 'before'),
        afterCategories: validateCategories(result.afterCategories, 'after'),
        changedFiles,
        verificationStatus: result.verificationStatus,
        verificationChecks,
        improved: result.improved,
        summary: result.summary,
    };
}

router.post('/', async (req, res) => {
    try {
        const input = validateRequest(req.body);
        const result = await compareBeforeAfter(input);
        return res.status(200).json(normalizeResult(result, input));
    } catch (err) {
        if (err instanceof AppError) {
            return res.status(err.httpStatus).json({
                error: { code: err.code, message: err.message },
            });
        }
        console.error('[before-after route] unexpected error:', err);
        return res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
        });
    }
});

module.exports = router;