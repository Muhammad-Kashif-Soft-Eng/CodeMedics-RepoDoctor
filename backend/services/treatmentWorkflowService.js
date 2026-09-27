'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { MAX_CONTENT_BYTES } = require('./githubClient');
const classifyTree = require('./classifyTree');
const { analyzeContent } = require('./analyzeContent');
const scoreHealth = require('./scoreHealth');
const { applyTreatment } = require('./treatmentService');
const { verifyTreatment } = require('./verificationService');
const { compareBeforeAfter } = require('./beforeAfterService');
const workspaceService = require('./workspaceService');
const AppError = require('./AppError');

const WORKFLOW_INPUT_KEYS = new Set(['workspaceId', 'finding']);
const FINDING_KEYS = new Set(['title', 'category', 'severity', 'evidence', 'affectedPath', 'explanation']);
const SOURCE_FILE_PATTERN = /\.(js|jsx|mjs|cjs|ts|tsx)$/i;
const CHECK_NAMES = new Set([
    'node --test',
    'jest --runInBand',
    'vitest run',
    'mocha',
    'Changed files exist',
]);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidRequest(message = 'The treatment workflow request is incomplete or invalid.') {
    return new AppError('INVALID_TREATMENT_WORKFLOW_REQUEST', 400, message);
}

function isSafeRelativePath(value) {
    return typeof value === 'string' && value.length > 0 && value === value.trim() &&
        !value.includes('\0') && !value.includes('..') && !value.includes('\\') &&
        !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !/^[a-zA-Z]:/.test(value) &&
        value.split('/').every((segment) => segment.length > 0 && segment !== '.');
}

function validateInput(params) {
    if (!isRecord(params) || Object.keys(params).some((key) => !WORKFLOW_INPUT_KEYS.has(key))) {
        throw invalidRequest('Only the workspace identifier and selected finding are accepted.');
    }
    if (typeof params.workspaceId !== 'string' || !params.workspaceId.trim()) {
        throw invalidRequest('A workspace identifier is required.');
    }
    if (
        !isRecord(params.finding) ||
        Object.keys(params.finding).some((key) => !FINDING_KEYS.has(key))
    ) {
        throw invalidRequest('A single supported finding is required.');
    }
    return { workspaceId: params.workspaceId, finding: params.finding };
}

function validateWorkspaceContext(context, finding) {
    if (!isRecord(context) || !isRecord(context.scanResult) || !isRecord(context.prescription)) {
        throw new AppError('WORKSPACE_CONTEXT_UNAVAILABLE', 409, 'The approved workspace context is unavailable.');
    }

    const { scanResult, prescription } = context;
    if (prescription.approved !== true) {
        throw new AppError(
            'PRESCRIPTION_NOT_APPROVED',
            400,
            'The prescription must be approved before treatment can proceed.'
        );
    }
    if (
        !Array.isArray(prescription.affectedPaths) || prescription.affectedPaths.length === 0 ||
        !prescription.affectedPaths.every(isSafeRelativePath)
    ) {
        throw new AppError('UNSAFE_PATH', 400, 'The approved file paths are invalid.');
    }
    if (
        typeof scanResult.owner !== 'string' || typeof scanResult.repo !== 'string' ||
        typeof scanResult.defaultBranch !== 'string'
    ) {
        throw new AppError('WORKSPACE_CONTEXT_UNAVAILABLE', 409, 'The approved repository context is unavailable.');
    }
    if (finding.affectedPath != null && !prescription.affectedPaths.includes(finding.affectedPath)) {
        throw new AppError('UNSAFE_PATH', 400, 'The selected finding is outside the approved file paths.');
    }

    return { scanResult, prescription, approvedPaths: new Set(prescription.affectedPaths) };
}

function isWithin(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function collectWorkspaceTree(workspacePath) {
    const tree = [];
    const fileEntries = [];

    async function visit(directory, relativeDirectory = '') {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            const relativePath = relativeDirectory
                ? `${relativeDirectory}/${entry.name}`
                : entry.name;
            if (!isSafeRelativePath(relativePath)) continue;

            const absolutePath = path.resolve(workspacePath, ...relativePath.split('/'));
            if (!isWithin(workspacePath, absolutePath) || absolutePath === workspacePath) continue;

            if (entry.isDirectory()) {
                tree.push({ path: relativePath, type: 'tree' });
                await visit(absolutePath, relativePath);
            } else if (entry.isFile()) {
                const stat = await fs.stat(absolutePath);
                tree.push({ path: relativePath, type: 'blob', size: stat.size });
                fileEntries.push({ path: relativePath, absolutePath, size: stat.size });
            }
        }
    }

    await visit(workspacePath);
    return { tree, fileEntries };
}

async function scanWorkspace(workspacePath) {
    let workspaceTree;
    try {
        workspaceTree = await collectWorkspaceTree(workspacePath);
    } catch {
        throw new AppError('WORKSPACE_SCAN_FAILED', 500, 'The controlled workspace could not be scanned.');
    }

    const classification = classifyTree({ tree: workspaceTree.tree, truncated: false });
    const sizeByPath = new Map(workspaceTree.fileEntries.map((file) => [file.path, file.size]));
    const contentPaths = new Set();
    const readmePaths = classification.docSignals?.readmePaths ?? [];
    if (readmePaths.length > 0) contentPaths.add(readmePaths[0]);

    const manifestPaths = classification.dependencySignals?.manifestPaths ?? [];
    const packagePath = manifestPaths.find((filePath) => filePath.split('/').pop().toLowerCase() === 'package.json');
    if (packagePath) contentPaths.add(packagePath);

    for (const file of workspaceTree.fileEntries) {
        if (SOURCE_FILE_PATTERN.test(file.path.split('/').pop())) contentPaths.add(file.path);
    }

    const fetchedFiles = [];
    const skippedPaths = [];
    for (const relativePath of contentPaths) {
        const size = sizeByPath.get(relativePath) ?? 0;
        if (size > MAX_CONTENT_BYTES) {
            skippedPaths.push(relativePath);
            continue;
        }

        const absolutePath = path.resolve(workspacePath, ...relativePath.split('/'));
        if (!isWithin(workspacePath, absolutePath) || absolutePath === workspacePath) {
            throw new AppError('WORKSPACE_SCAN_FAILED', 500, 'The controlled workspace could not be scanned.');
        }
        try {
            fetchedFiles.push({
                path: relativePath,
                content: await fs.readFile(absolutePath, 'utf8'),
                size,
            });
        } catch {
            throw new AppError('WORKSPACE_SCAN_FAILED', 500, 'The controlled workspace could not be scanned.');
        }
    }

    const content = analyzeContent(fetchedFiles, classification, skippedPaths);
    const docSignals = { ...classification.docSignals, ...content.docSignals };
    const dependencySignals = { ...classification.dependencySignals, ...content.dependencySignals };
    const healthScore = scoreHealth({
        structure: classification.structure,
        testingSignals: classification.testingSignals,
        docSignals,
        qualitySignals: content.qualitySignals,
        dependencySignals,
    });
    return { healthScore };
}

function normalizeTreatmentResult(result, approvedPaths) {
    if (!isRecord(result) || !['applied', 'no_changes'].includes(result.status) || !Array.isArray(result.changedFiles)) {
        throw new AppError('INVALID_TREATMENT_RESULT', 502, 'The treatment service returned an invalid result.');
    }
    if (!result.changedFiles.every((file) => isSafeRelativePath(file) && approvedPaths.has(file))) {
        throw new AppError('UNSAFE_PATH', 502, 'The treatment service returned an unapproved file path.');
    }
    if (result.status === 'applied' && result.changedFiles.length === 0) {
        throw new AppError('INVALID_TREATMENT_RESULT', 502, 'The treatment service returned no applied files.');
    }
    return { status: result.status, changedFiles: [...new Set(result.changedFiles)] };
}

function normalizeVerificationResult(result, treatmentResult) {
    if (
        !isRecord(result) || !['passed', 'failed'].includes(result.status) ||
        !Array.isArray(result.changedFiles) ||
        result.changedFiles.length !== treatmentResult.changedFiles.length ||
        result.changedFiles.some((file, index) => file !== treatmentResult.changedFiles[index])
    ) {
        throw new AppError('INVALID_VERIFICATION_RESULT', 502, 'The verification service returned an invalid result.');
    }

    const checksRun = result.checksRun ?? [];
    const passedChecks = result.passedChecks ?? [];
    const failedChecks = result.failedChecks ?? [];
    if (
        !Array.isArray(checksRun) || checksRun.some((check) => typeof check !== 'string') ||
        !Array.isArray(passedChecks) || passedChecks.some((check) => typeof check !== 'string') ||
        !Array.isArray(failedChecks) || failedChecks.some((failure) => !isRecord(failure) || typeof failure.check !== 'string')
    ) {
        throw new AppError('INVALID_VERIFICATION_RESULT', 502, 'The verification service returned invalid check data.');
    }

    return {
        status: result.status,
        checksRun: [...checksRun],
        passedChecks: [...passedChecks],
        failedChecks: failedChecks.map((failure) => ({
            check: failure.check,
            ...(Number.isInteger(failure.exitCode) ? { exitCode: failure.exitCode } : {}),
            ...(typeof failure.signal === 'string' ? { signal: failure.signal } : {}),
        })),
        changedFiles: [...result.changedFiles],
        verificationMessage: result.status === 'passed'
            ? 'All deterministic verification checks passed.'
            : 'One or more deterministic verification checks failed.',
    };
}

function workflowError(error) {
    if (!(error instanceof AppError)) {
        return new AppError('TREATMENT_WORKFLOW_FAILED', 500, 'The treatment workflow could not be completed.');
    }
    const publicMessages = {
        INVALID_TREATMENT_WORKFLOW_REQUEST: 'The treatment workflow request is incomplete or invalid.',
        PRESCRIPTION_NOT_APPROVED: 'The prescription must be approved before treatment can proceed.',
        INVALID_WORKSPACE_ID: 'The workspace identifier is invalid.',
        UNSAFE_PATH: 'An approved file path is not permitted.',
    };
    return new AppError(
        error.code,
        error.httpStatus,
        publicMessages[error.code] || 'The treatment workflow could not be completed.'
    );
}

async function executeTreatmentWorkflow(params) {
    const workspaceId = params?.workspaceId;
    let failed = false;

    try {
        const input = validateInput(params);
        return await workspaceService.runInWorkspace(input.workspaceId, async (workspacePath, context) => {
            const { scanResult, prescription, approvedPaths } = validateWorkspaceContext(context, input.finding);
            const beforeHealthResult = await scanWorkspace(workspacePath);

            const rawTreatmentResult = await applyTreatment({
                finding: input.finding,
                prescription,
                workspacePath,
                scanResult,
            });
            const treatmentResult = normalizeTreatmentResult(rawTreatmentResult, approvedPaths);
            const rawVerificationResult = await verifyTreatment({
                workspacePath,
                changedFiles: treatmentResult.changedFiles,
                treatmentResult: {
                    status: rawTreatmentResult.status,
                    changedFiles: treatmentResult.changedFiles,
                    beforeContent: rawTreatmentResult.beforeContent,
                },
                projectInfo: {
                    ...(typeof scanResult.language === 'string' && ['JavaScript', 'Node.js', 'TypeScript'].includes(scanResult.language)
                        ? { language: scanResult.language }
                        : {}),
                },
            });
            const verificationResult = normalizeVerificationResult(rawVerificationResult, treatmentResult);
            const afterHealthResult = await scanWorkspace(workspacePath);
            const comparisonVerificationResult = {
                ...verificationResult,
                failedChecks: verificationResult.failedChecks.filter((failure) => failure.check !== 'Changed files'),
            };
            const beforeAfter = compareBeforeAfter({
                beforeHealthResult,
                afterHealthResult,
                treatmentResult,
                verificationResult: comparisonVerificationResult,
            });

            return {
                workspaceId: input.workspaceId,
                treatmentResult,
                verificationResult,
                beforeAfter,
                changedFiles: beforeAfter.changedFiles,
                status: treatmentResult.status === 'applied' && treatmentResult.changedFiles.length > 0 &&
                    verificationResult.status === 'passed'
                    ? 'completed'
                    : 'failed',
            };
        });
    } catch (error) {
        failed = true;
        throw workflowError(error);
    } finally {
        if (typeof workspaceId === 'string' && workspaceId.trim()) {
            try {
                await workspaceService.cleanupWorkspace(workspaceId);
            } catch (error) {
                if (!failed) throw workflowError(error);
            }
        }
    }
}

module.exports = { executeTreatmentWorkflow, scanWorkspace };