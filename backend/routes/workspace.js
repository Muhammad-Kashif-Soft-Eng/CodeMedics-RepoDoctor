'use strict';

const path = require('node:path');
const { Router } = require('express');
const { buildDiagnosisEvidence } = require('../services/diagnosisService');
const workspaceService = require('../services/workspaceService');
const ScanResult = require('../models/ScanResult');
const AppError = require('../services/AppError');

const router = Router();
const REQUEST_KEYS = new Set(['scanId', 'selectedFinding', 'prescription']);
const FINDING_KEYS = new Set(['title', 'category', 'severity', 'evidence', 'affectedPath', 'explanation']);
const PRESCRIPTION_KEYS = new Set([
    'title',
    'reason',
    'expectedOutcome',
    'affectedPaths',
    'treatmentSteps',
    'verificationPlan',
    'riskNotes',
    'approved',
]);
const CATEGORIES = new Set(['Testing', 'Documentation', 'Structure', 'Code Quality', 'Dependencies']);
const SEVERITIES = new Set(['Critical', 'High', 'Medium', 'Low']);
const WORKSPACE_ID_PATTERN = /^repodoctor-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AFFECTED_PATHS = 20;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
    return Object.keys(value).every((key) => allowedKeys.has(key));
}

function invalidRequest(message = 'The workspace preparation request is incomplete or invalid.') {
    return new AppError('INVALID_WORKSPACE_REQUEST', 400, message);
}

function validateFinding(finding, supportedPaths) {
    if (!isRecord(finding) || !hasOnlyKeys(finding, FINDING_KEYS)) {
        throw new AppError('INVALID_FINDING', 400, 'A single supported finding is required.');
    }
    if (
        typeof finding.title !== 'string' || !finding.title.trim() ||
        !CATEGORIES.has(finding.category) || !SEVERITIES.has(finding.severity) ||
        typeof finding.evidence !== 'string' || !finding.evidence.trim() ||
        typeof finding.explanation !== 'string' || !finding.explanation.trim() ||
        (finding.affectedPath !== null && typeof finding.affectedPath !== 'string')
    ) {
        throw new AppError('INVALID_FINDING', 400, 'The selected finding is incomplete or invalid.');
    }
    if (supportedPaths && finding.affectedPath !== null && !supportedPaths.has(finding.affectedPath)) {
        throw new AppError('INVALID_FINDING', 400, 'The selected finding is not supported by this scan.');
    }
}

function validatePrescription(prescription, finding, supportedPaths) {
    if (!isRecord(prescription) || !hasOnlyKeys(prescription, PRESCRIPTION_KEYS)) {
        throw invalidRequest('A supported prescription is required.');
    }
    if (prescription.approved !== true) {
        throw new AppError('PRESCRIPTION_NOT_APPROVED', 400, 'The prescription must be approved before workspace preparation.');
    }
    if (
        typeof prescription.title !== 'string' || !prescription.title.trim() ||
        typeof prescription.reason !== 'string' || !prescription.reason.trim() ||
        typeof prescription.expectedOutcome !== 'string' || !prescription.expectedOutcome.trim() ||
        typeof prescription.verificationPlan !== 'string' || !prescription.verificationPlan.trim() ||
        !Array.isArray(prescription.affectedPaths) || prescription.affectedPaths.length === 0 ||
        prescription.affectedPaths.length > MAX_AFFECTED_PATHS ||
        !Array.isArray(prescription.treatmentSteps) || prescription.treatmentSteps.length === 0 ||
        prescription.treatmentSteps.length > 10 ||
        prescription.treatmentSteps.some((step) => typeof step !== 'string' || !step.trim()) ||
        (prescription.riskNotes !== null && typeof prescription.riskNotes !== 'string')
    ) {
        throw invalidRequest('The approved prescription is incomplete or invalid.');
    }
    if (prescription.affectedPaths.some((filePath) => !supportedPaths.has(filePath))) {
        throw new AppError('UNSAFE_PATH', 400, 'The approved prescription contains a path outside the scan evidence.');
    }
    if (finding.affectedPath !== null && !prescription.affectedPaths.includes(finding.affectedPath)) {
        throw new AppError('UNSAFE_PATH', 400, 'The prescription does not include the selected finding path.');
    }
}

function validateRequest(body) {
    if (!isRecord(body) || !hasOnlyKeys(body, REQUEST_KEYS)) {
        throw invalidRequest('Only scanId, selectedFinding, and prescription are accepted.');
    }
    if (
        typeof body.scanId !== 'string' || !body.scanId.trim() ||
        !Object.hasOwn(body, 'selectedFinding') || !Object.hasOwn(body, 'prescription')
    ) {
        throw invalidRequest('A scan ID, selected finding, and approved prescription are required.');
    }
    validateFinding(body.selectedFinding);
    return body;
}

function toScanResult(record, scanId) {
    if (!isRecord(record)) {
        throw new AppError('SCAN_RESULT_NOT_FOUND', 404, 'The scan result was not found.');
    }
    const result = {
        scanId: String(record._id ?? scanId),
        owner: record.owner,
        repo: record.repo,
        defaultBranch: record.defaultBranch,
        language: typeof record.language === 'string' ? record.language : null,
        structure: record.structure,
        testingSignals: record.testingSignals,
        docSignals: record.docSignals,
        qualitySignals: record.qualitySignals,
        dependencySignals: record.dependencySignals,
        healthScore: record.healthScore,
        truncated: record.truncated,
    };
    if (
        !result.scanId || typeof result.owner !== 'string' || typeof result.repo !== 'string' ||
        typeof result.defaultBranch !== 'string'
    ) {
        throw new AppError('INVALID_SCAN_RESULT', 422, 'The stored scan result is incomplete.');
    }
    return result;
}

function isSafeRelativePath(filePath) {
    return typeof filePath === 'string' && filePath.length > 0 && filePath === filePath.trim() &&
        !filePath.includes('\0') && !filePath.includes('..') && !filePath.includes('\\') &&
        !path.posix.isAbsolute(filePath) && !path.win32.isAbsolute(filePath) && !/^[a-zA-Z]:/.test(filePath) &&
        filePath.split('/').every((segment) => segment.length > 0 && segment !== '.');
}

function normalizeWorkspaceResult(result, scanResult) {
    if (
        !isRecord(result) || typeof result.workspaceId !== 'string' ||
        !WORKSPACE_ID_PATTERN.test(result.workspaceId) || !isRecord(result.repository) ||
        !Array.isArray(result.materializedFiles) || !result.materializedFiles.every(isSafeRelativePath)
    ) {
        throw new AppError('INVALID_WORKSPACE_RESULT', 502, 'The workspace service returned invalid metadata.');
    }

    return {
        workspaceId: result.workspaceId,
        repository: {
            owner: scanResult.owner,
            repo: scanResult.repo,
            defaultBranch: scanResult.defaultBranch,
        },
        materializedFiles: [...new Set(result.materializedFiles)],
    };
}

function safeErrorMessage(error) {
    const messages = {
        INVALID_WORKSPACE_REQUEST: 'The workspace preparation request is incomplete or invalid.',
        INVALID_FINDING: 'The selected finding is invalid for this scan.',
        PRESCRIPTION_NOT_APPROVED: 'The prescription must be approved before workspace preparation.',
        UNSAFE_PATH: 'The approved prescription contains an unsupported path.',
        SCAN_RESULT_NOT_FOUND: 'The scan result was not found.',
        INVALID_SCAN_RESULT: 'The stored scan result is incomplete.',
        REPO_PRIVATE: 'Only public repositories can be prepared.',
        REPO_NOT_FOUND: 'The public repository could not be found.',
        GITHUB_UNAVAILABLE: 'Repository files could not be retrieved from GitHub.',
        GITHUB_RATE_LIMITED: 'GitHub API rate limit reached. Please try again later.',
        WORKSPACE_FILE_NOT_FOUND: 'An approved repository file is unavailable.',
        WORKSPACE_FILE_UNAVAILABLE: 'A required repository file could not be materialized.',
        WORKSPACE_ROOT_INVALID: 'The workspace storage is unavailable.',
        WORKSPACE_PREPARATION_FAILED: 'The temporary workspace could not be prepared.',
        INVALID_WORKSPACE_RESULT: 'The workspace service returned invalid metadata.',
    };
    return messages[error.code] || 'Workspace preparation could not be completed.';
}

router.post('/', async (req, res) => {
    try {
        const input = validateRequest(req.body);
        let record;
        try {
            record = await ScanResult.findById(input.scanId);
        } catch (error) {
            if (error?.name === 'CastError') {
                throw new AppError('SCAN_RESULT_NOT_FOUND', 404, 'The scan result was not found.');
            }
            throw error;
        }

        const scanResult = toScanResult(record, input.scanId);
        const { supportedPaths } = buildDiagnosisEvidence(scanResult);
        validateFinding(input.selectedFinding, supportedPaths);
        validatePrescription(input.prescription, input.selectedFinding, supportedPaths);

        const result = await workspaceService.createWorkspace({
            scanResult,
            prescription: input.prescription,
        });
        return res.status(201).json(normalizeWorkspaceResult(result, scanResult));
    } catch (error) {
        if (error instanceof AppError) {
            return res.status(error.httpStatus).json({
                error: { code: error.code, message: safeErrorMessage(error) },
            });
        }
        console.error('[workspace route] unexpected error:', error);
        return res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Workspace preparation could not be completed.' },
        });
    }
});

module.exports = router;