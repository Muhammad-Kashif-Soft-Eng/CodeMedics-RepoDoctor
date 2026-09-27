'use strict';

const path = require('node:path');
const { Router } = require('express');
const { verifyTreatment } = require('../services/verificationService');
const AppError = require('../services/AppError');

const router = Router();
const REQUEST_KEYS = new Set(['workspacePath', 'changedFiles', 'treatmentResult', 'projectInfo']);
const TREATMENT_RESULT_KEYS = new Set([
    'status',
    'changedFiles',
    'beforeContent',
    'workspacePath',
    'proposedChanges',
]);
const PROJECT_INFO_KEYS = new Set(['language', 'packageManager', 'scripts', 'hasPackageJson']);
const SECRET_ENV_PATTERN = /(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|MONGODB_URI)/i;
const MAX_CHANGED_FILES = 100;
const MAX_OUTPUT_LENGTH = 12000;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidRequest(message = 'The verification request is incomplete or invalid.') {
    return new AppError('INVALID_VERIFICATION_REQUEST', 400, message);
}

function hasOnlyKeys(value, allowedKeys) {
    return Object.keys(value).every((key) => allowedKeys.has(key));
}

function validateChangedFiles(changedFiles) {
    if (!Array.isArray(changedFiles) || changedFiles.length > MAX_CHANGED_FILES) {
        throw invalidRequest('Changed files must be a list of at most 100 relative paths.');
    }
    for (const file of changedFiles) {
        if (
            typeof file !== 'string' || !file.trim() || file.includes('\0') ||
            path.isAbsolute(file) || path.win32.isAbsolute(file) ||
            file.split(/[\\/]/).includes('..')
        ) {
            throw new AppError('UNSAFE_PATH', 400, 'Changed file paths must be safe relative paths.');
        }
    }
}

function validateProjectInfo(projectInfo) {
    if (!isRecord(projectInfo) || !hasOnlyKeys(projectInfo, PROJECT_INFO_KEYS)) {
        throw invalidRequest('Project information contains unsupported fields.');
    }
    if (projectInfo.language != null && !['JavaScript', 'Node.js', 'TypeScript'].includes(projectInfo.language)) {
        throw invalidRequest('The project language is not supported for deterministic verification.');
    }
    if (projectInfo.packageManager != null && !['npm', 'pnpm', 'yarn', 'bun'].includes(projectInfo.packageManager)) {
        throw invalidRequest('The package manager is not supported.');
    }
    if (projectInfo.scripts != null && (
        !Array.isArray(projectInfo.scripts) ||
        projectInfo.scripts.some((script) => typeof script !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(script))
    )) {
        throw invalidRequest('Project script names must be identifiers, not commands.');
    }
    if (projectInfo.hasPackageJson != null && typeof projectInfo.hasPackageJson !== 'boolean') {
        throw invalidRequest();
    }
}

function validateRequest(body) {
    if (!isRecord(body) || !hasOnlyKeys(body, REQUEST_KEYS)) throw invalidRequest();
    if (typeof body.workspacePath !== 'string' || !body.workspacePath.trim()) {
        throw invalidRequest('A controlled workspace path is required.');
    }
    validateChangedFiles(body.changedFiles);
    validateProjectInfo(body.projectInfo);

    const treatmentResult = body.treatmentResult;
    if (!isRecord(treatmentResult)) throw invalidRequest('A treatment result is required.');
    if (!hasOnlyKeys(treatmentResult, TREATMENT_RESULT_KEYS)) {
        throw invalidRequest('The treatment result contains unsupported fields.');
    }
    if (!['applied', 'no_changes'].includes(treatmentResult.status)) {
        throw invalidRequest('The treatment result status is invalid.');
    }
    if (!Array.isArray(treatmentResult.changedFiles)) {
        throw invalidRequest('Treatment result changed files are required.');
    }
    validateChangedFiles(treatmentResult.changedFiles);
    if (
        body.changedFiles.length !== treatmentResult.changedFiles.length ||
        body.changedFiles.some((file, index) => file !== treatmentResult.changedFiles[index])
    ) {
        throw invalidRequest('Changed files must match the treatment result.');
    }
    if (treatmentResult.beforeContent != null) {
        if (!isRecord(treatmentResult.beforeContent)) throw invalidRequest('The treatment before-state is invalid.');
        for (const [file, content] of Object.entries(treatmentResult.beforeContent)) {
            if (!body.changedFiles.includes(file) || (content !== null && typeof content !== 'string')) {
                throw invalidRequest('The treatment before-state does not match the changed files.');
            }
        }
    }
    if (treatmentResult.workspacePath != null && typeof treatmentResult.workspacePath !== 'string') {
        throw invalidRequest('The treatment workspace information is invalid.');
    }
    if (treatmentResult.proposedChanges != null && !Array.isArray(treatmentResult.proposedChanges)) {
        throw invalidRequest('The treatment result changes are invalid.');
    }

    return {
        workspacePath: body.workspacePath,
        changedFiles: body.changedFiles,
        treatmentResult: {
            status: treatmentResult.status,
            changedFiles: treatmentResult.changedFiles,
            ...(treatmentResult.beforeContent == null
                ? {}
                : {
                    beforeContent: Object.fromEntries(
                        body.changedFiles
                            .filter((file) => Object.hasOwn(treatmentResult.beforeContent, file))
                            .map((file) => [file, treatmentResult.beforeContent[file]])
                    ),
                }),
        },
        projectInfo: body.projectInfo,
    };
}

function redactText(value, workspacePath) {
    let text = typeof value === 'string' ? value : '';
    const secretValues = Object.entries(process.env)
        .filter(([name, secret]) => SECRET_ENV_PATTERN.test(name) && typeof secret === 'string' && secret.length >= 4)
        .map(([, secret]) => secret);
    for (const secret of secretValues) text = text.split(secret).join('[redacted]');

    if (workspacePath) {
        text = text.split(workspacePath).join('[workspace]');
    }
    text = text.replace(/[A-Za-z]:\\[^\r\n,;]+/g, '[path redacted]');
    text = text.replace(/(^|[\s(])\/(?:[^\s():]+\/)*[^\s():]*/g, '$1[path redacted]');
    return text.slice(0, MAX_OUTPUT_LENGTH);
}

function sanitizeChecks(checks) {
    if (!Array.isArray(checks)) return [];
    return checks
        .filter((check) => typeof check === 'string')
        .slice(0, MAX_CHANGED_FILES + 1)
        .map((check) => redactText(check));
}

function sanitizeFailedChecks(checks, workspacePath) {
    if (!Array.isArray(checks)) return [];
    return checks.slice(0, MAX_CHANGED_FILES + 1).map((failure) => {
        if (!isRecord(failure)) return { reason: 'A verification check failed.' };
        const safeFailure = {};
        if (typeof failure.check === 'string') safeFailure.check = redactText(failure.check, workspacePath);
        if (Number.isInteger(failure.exitCode)) safeFailure.exitCode = failure.exitCode;
        if (typeof failure.signal === 'string') safeFailure.signal = redactText(failure.signal, workspacePath);
        if (typeof failure.output === 'string') safeFailure.output = redactText(failure.output, workspacePath);
        if (typeof failure.reason === 'string') safeFailure.reason = redactText(failure.reason, workspacePath);
        return safeFailure;
    });
}

function sanitizeFingerprints(state, changedFiles) {
    if (!isRecord(state)) return undefined;
    const allowedFiles = new Set(changedFiles);
    const result = {};
    for (const [file, fingerprint] of Object.entries(state)) {
        if (!allowedFiles.has(file) || !isRecord(fingerprint)) continue;
        result[file] = {
            exists: fingerprint.exists === true,
            sizeBytes: Number.isFinite(fingerprint.sizeBytes) && fingerprint.sizeBytes >= 0 ? fingerprint.sizeBytes : null,
            sha256: typeof fingerprint.sha256 === 'string' && /^[a-f\d]{64}$/i.test(fingerprint.sha256)
                ? fingerprint.sha256
                : null,
        };
    }
    return result;
}

function safeError(err) {
    const messages = {
        INVALID_VERIFICATION_REQUEST: 'The verification request is incomplete or invalid.',
        UNSAFE_WORKSPACE: 'The workspace is outside the permitted verification area.',
        UNSAFE_PATH: 'A changed file path is not permitted.',
        UNSUPPORTED_VERIFICATION_COMMAND: 'No supported deterministic verification check is available.',
        VERIFICATION_PROCESS_ERROR: 'The verification check could not be completed.',
        VERIFICATION_TIMEOUT: 'The verification check timed out.',
    };
    return {
        status: err.httpStatus,
        body: {
            error: {
                code: err.code,
                message: messages[err.code] || 'Verification could not be completed.',
            },
        },
    };
}

router.post('/', async (req, res) => {
    try {
        const input = validateRequest(req.body);
        const result = await verifyTreatment(input);
        if (!isRecord(result) || !['passed', 'failed'].includes(result.status) || !Array.isArray(result.changedFiles)) {
            throw new AppError('INVALID_VERIFICATION_RESULT', 502, 'The verification service returned an invalid result.');
        }
        validateChangedFiles(result.changedFiles);
        if (
            result.changedFiles.length !== input.changedFiles.length ||
            result.changedFiles.some((file, index) => file !== input.changedFiles[index])
        ) {
            throw new AppError('INVALID_VERIFICATION_RESULT', 502, 'The verification service returned inconsistent changed files.');
        }

        const response = {
            status: result.status,
            checksRun: sanitizeChecks(result.checksRun),
            passedChecks: sanitizeChecks(result.passedChecks),
            failedChecks: sanitizeFailedChecks(result.failedChecks, input.workspacePath),
            output: redactText(result.outputSummary ?? result.output, input.workspacePath),
            changedFiles: input.changedFiles,
            verificationMessage: redactText(result.verificationMessage, input.workspacePath),
        };
        const beforeState = sanitizeFingerprints(result.beforeState, response.changedFiles);
        const currentState = sanitizeFingerprints(result.currentState, response.changedFiles);
        if (beforeState !== undefined) response.beforeState = beforeState;
        if (currentState !== undefined) response.currentState = currentState;

        return res.status(200).json(response);
    } catch (err) {
        if (err instanceof AppError) {
            const safe = safeError(err);
            return res.status(safe.status).json(safe.body);
        }
        console.error('[verify route] unexpected error:', err);
        return res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
        });
    }
});

module.exports = router;