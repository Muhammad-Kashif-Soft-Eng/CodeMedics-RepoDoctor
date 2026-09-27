'use strict';

const path = require('node:path');
const { Router } = require('express');
const { executeTreatmentWorkflow } = require('../services/treatmentWorkflowService');
const AppError = require('../services/AppError');

const router = Router();
const REQUEST_KEYS = new Set(['workspaceId', 'finding']);
const FINDING_KEYS = new Set(['title', 'category', 'severity', 'evidence', 'affectedPath', 'explanation']);
const WORKSPACE_ID_PATTERN = /^repodoctor-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidRequest(message = 'The treatment workflow request is incomplete or invalid.') {
    return new AppError('INVALID_TREATMENT_WORKFLOW_REQUEST', 400, message);
}

function validateFinding(finding) {
    if (!isRecord(finding) || Object.keys(finding).some((key) => !FINDING_KEYS.has(key))) {
        throw invalidRequest('A single supported finding is required.');
    }

    if (finding.affectedPath != null) {
        const filePath = finding.affectedPath;
        if (
            typeof filePath !== 'string' || !filePath.trim() || filePath !== filePath.trim() ||
            filePath.includes('\0') || filePath.includes('..') || filePath.includes('\\') ||
            path.isAbsolute(filePath) || path.win32.isAbsolute(filePath) || /^[a-zA-Z]:/.test(filePath) ||
            filePath.split('/').some((segment) => !segment || segment === '.')
        ) {
            throw new AppError('UNSAFE_PATH', 400, 'The finding path must be repository-relative.');
        }
    }
}

function validateRequest(body) {
    if (!isRecord(body) || Object.keys(body).some((key) => !REQUEST_KEYS.has(key))) {
        throw invalidRequest('Only workspaceId and finding are accepted.');
    }
    if (!Object.hasOwn(body, 'workspaceId') || !Object.hasOwn(body, 'finding')) {
        throw invalidRequest('Both workspaceId and finding are required.');
    }
    if (typeof body.workspaceId !== 'string' || !WORKSPACE_ID_PATTERN.test(body.workspaceId)) {
        throw new AppError('INVALID_WORKSPACE_ID', 400, 'The workspace identifier is invalid.');
    }
    validateFinding(body.finding);
    return { workspaceId: body.workspaceId, finding: body.finding };
}

function safeErrorMessage(error) {
    const messages = {
        INVALID_TREATMENT_WORKFLOW_REQUEST: 'The treatment workflow request is incomplete or invalid.',
        INVALID_WORKSPACE_ID: 'The workspace identifier is invalid.',
        UNSAFE_PATH: 'The finding path must be repository-relative.',
        PRESCRIPTION_NOT_APPROVED: 'The prescription must be approved before treatment can proceed.',
    };
    return messages[error.code] || 'The treatment workflow could not be completed.';
}

router.post('/', async (req, res) => {
    try {
        const input = validateRequest(req.body);
        const result = await executeTreatmentWorkflow(input);
        return res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) {
            return res.status(error.httpStatus).json({
                error: { code: error.code, message: safeErrorMessage(error) },
            });
        }
        console.error('[treatment-workflow route] unexpected error:', error);
        return res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'The treatment workflow could not be completed.' },
        });
    }
});

module.exports = router;