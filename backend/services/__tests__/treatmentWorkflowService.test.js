'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

jest.mock('../workspaceService', () => ({
    runInWorkspace: jest.fn(),
    cleanupWorkspace: jest.fn(),
}));
jest.mock('../treatmentService', () => ({ applyTreatment: jest.fn() }));
jest.mock('../verificationService', () => ({ verifyTreatment: jest.fn() }));
jest.mock('../classifyTree', () => jest.fn());
jest.mock('../analyzeContent', () => ({ analyzeContent: jest.fn() }));
jest.mock('../scoreHealth', () => jest.fn());
jest.mock('../beforeAfterService', () => ({ compareBeforeAfter: jest.fn() }));

const workspaceService = require('../workspaceService');
const { applyTreatment } = require('../treatmentService');
const { verifyTreatment } = require('../verificationService');
const classifyTree = require('../classifyTree');
const { analyzeContent } = require('../analyzeContent');
const scoreHealth = require('../scoreHealth');
const { compareBeforeAfter } = require('../beforeAfterService');
const AppError = require('../AppError');
const { executeTreatmentWorkflow } = require('../treatmentWorkflowService');

const actualClassifyTree = jest.requireActual('../classifyTree');
const actualAnalyzeContent = jest.requireActual('../analyzeContent').analyzeContent;
const actualScoreHealth = jest.requireActual('../scoreHealth');
const actualCompareBeforeAfter = jest.requireActual('../beforeAfterService').compareBeforeAfter;

const WORKSPACE_ID = 'repodoctor-6c94fe5c-b10a-4da4-85fa-721a61c906bd';
const SOURCE_BEFORE = '// TODO: remove this marker\n// FIXME: remove this marker too\nmodule.exports = 1;\n';
const SOURCE_AFTER = 'module.exports = 1;\n';
const SECRET = 'workflow-test-secret';

let workspacePath;
let previousEnvironment;
let callOrder;
let context;

function finding(overrides = {}) {
    return {
        title: 'Resolve source markers',
        category: 'Code Quality',
        severity: 'Medium',
        evidence: 'The source file contains TODO and FIXME markers.',
        affectedPath: 'src/index.js',
        explanation: 'Remove the completed-work markers.',
        ...overrides,
    };
}

function workspaceContext(overrides = {}) {
    return {
        scanResult: {
            scanId: 'scan-result-456',
            owner: 'demo-owner',
            repo: 'demo-project',
            defaultBranch: 'main',
            language: 'JavaScript',
        },
        prescription: {
            title: 'Remove completed TODO markers',
            reason: 'The work is complete.',
            expectedOutcome: 'No TODO or FIXME markers remain.',
            affectedPaths: ['src/index.js'],
            treatmentSteps: ['Remove both comment lines.'],
            verificationPlan: 'Run the allowed JavaScript verification check.',
            riskNotes: null,
            approved: true,
        },
        ...overrides,
    };
}

function successfulVerification() {
    return {
        status: 'passed',
        checksRun: ['node --check src/index.js'],
        passedChecks: ['node --check src/index.js'],
        failedChecks: [],
        outputSummary: `absolute ${workspacePath} ${SECRET} ${SOURCE_AFTER}`,
        changedFiles: ['src/index.js'],
        beforeState: { 'src/index.js': { exists: true, sizeBytes: 1, sha256: 'a'.repeat(64) } },
        currentState: { 'src/index.js': { exists: true, sizeBytes: 1, sha256: 'b'.repeat(64) } },
    };
}

function mockSuccessfulTreatment() {
    applyTreatment.mockImplementation(async ({ workspacePath: receivedPath }) => {
        callOrder.push('treatment');
        expect(receivedPath).toBe(workspacePath);
        const beforeContent = fs.readFileSync(path.join(receivedPath, 'src', 'index.js'), 'utf8');
        fs.writeFileSync(path.join(receivedPath, 'src', 'index.js'), SOURCE_AFTER);
        return {
            status: 'applied',
            workspacePath: receivedPath,
            changedFiles: ['src/index.js'],
            beforeContent: { 'src/index.js': beforeContent },
            proposedChanges: [{ relativePath: 'src/index.js', content: SOURCE_AFTER }],
        };
    });
}

beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoctor-workflow-'));
    fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ name: 'demo-project' }));
    fs.writeFileSync(path.join(workspacePath, 'src', 'index.js'), SOURCE_BEFORE);
    previousEnvironment = Object.fromEntries(['OPENAI_API_KEY', 'GITHUB_TOKEN'].map((name) => [name, process.env[name]]));
    process.env.OPENAI_API_KEY = SECRET;
    process.env.GITHUB_TOKEN = 'github-workflow-secret';
    callOrder = [];
    context = workspaceContext();

    jest.clearAllMocks();
    workspaceService.runInWorkspace.mockImplementation(async (_workspaceId, operation) => operation(workspacePath, context));
    workspaceService.cleanupWorkspace.mockResolvedValue({ workspaceId: WORKSPACE_ID, removed: true });
    classifyTree.mockImplementation((...args) => actualClassifyTree(...args));
    analyzeContent.mockImplementation((...args) => actualAnalyzeContent(...args));
    scoreHealth.mockImplementation((...args) => {
        callOrder.push('score');
        return actualScoreHealth(...args);
    });
    compareBeforeAfter.mockImplementation((...args) => {
        callOrder.push('compare');
        return actualCompareBeforeAfter(...args);
    });
});

afterEach(() => {
    for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    fs.rmSync(workspacePath, { recursive: true, force: true });
});

describe('treatmentWorkflowService.executeTreatmentWorkflow', () => {
    test('runs approved treatment, verification, local scans, comparison, and cleanup in order', async () => {
        mockSuccessfulTreatment();
        verifyTreatment.mockImplementation(async (request) => {
            callOrder.push('verification');
            expect(request.workspacePath).toBe(workspacePath);
            expect(fs.readFileSync(path.join(request.workspacePath, 'src', 'index.js'), 'utf8')).toBe(SOURCE_AFTER);
            return successfulVerification();
        });

        const result = await executeTreatmentWorkflow({ workspaceId: WORKSPACE_ID, finding: finding() });

        expect(workspaceService.runInWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, expect.any(Function));
        expect(applyTreatment).toHaveBeenCalledWith(expect.objectContaining({
            finding: finding(),
            prescription: context.prescription,
            workspacePath,
            scanResult: context.scanResult,
        }));
        expect(verifyTreatment).toHaveBeenCalledWith(expect.objectContaining({ workspacePath }));
        expect(verifyTreatment.mock.calls[0][0].treatmentResult.beforeContent['src/index.js']).toBe(SOURCE_BEFORE);
        expect(callOrder).toEqual(['score', 'treatment', 'verification', 'score', 'compare']);
        expect(result.status).toBe('completed');
        expect(result.workspaceId).toBe(WORKSPACE_ID);
        expect(result.changedFiles).toEqual(['src/index.js']);
        expect(result.beforeAfter.verificationStatus).toBe('passed');
        expect(result.beforeAfter.scoreDelta).toBe(2);
        expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    test('rejects an unapproved workspace prescription without treating', async () => {
        context.prescription.approved = false;

        await expect(executeTreatmentWorkflow({ workspaceId: WORKSPACE_ID, finding: finding() }))
            .rejects.toMatchObject({ code: 'PRESCRIPTION_NOT_APPROVED' });

        expect(applyTreatment).not.toHaveBeenCalled();
        expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    test('rejects an invalid opaque workspace ID without treating', async () => {
        workspaceService.runInWorkspace.mockRejectedValue(new AppError(
            'INVALID_WORKSPACE_ID', 400, 'an absolute path must not be leaked'
        ));

        await expect(executeTreatmentWorkflow({ workspaceId: 'C:\\outside\\project', finding: finding() }))
            .rejects.toMatchObject({ code: 'INVALID_WORKSPACE_ID' });

        expect(applyTreatment).not.toHaveBeenCalled();
        expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith('C:\\outside\\project');
    });

    test('sanitizes treatment failures and still cleans up', async () => {
        applyTreatment.mockRejectedValue(new AppError(
            'AI_PROVIDER_ERROR', 502, `provider secret ${SECRET} at ${workspacePath}`
        ));

        let workflowError;
        try {
            await executeTreatmentWorkflow({ workspaceId: WORKSPACE_ID, finding: finding() });
        } catch (error) {
            workflowError = error;
        }

        expect(workflowError).toMatchObject({ code: 'AI_PROVIDER_ERROR', httpStatus: 502 });
        expect(workflowError.message).not.toContain(SECRET);
        expect(workflowError.message).not.toContain(workspacePath);
        expect(verifyTreatment).not.toHaveBeenCalled();
        expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    test('runs after-scan and comparison after failed verification but reports workflow failure', async () => {
        mockSuccessfulTreatment();
        verifyTreatment.mockImplementation(async () => {
            callOrder.push('verification');
            return {
                ...successfulVerification(),
                status: 'failed',
                passedChecks: [],
                failedChecks: [{ check: 'node --check src/index.js', exitCode: 1, output: `${SECRET} ${workspacePath}` }],
            };
        });

        const result = await executeTreatmentWorkflow({ workspaceId: WORKSPACE_ID, finding: finding() });

        expect(result.status).toBe('failed');
        expect(result.verificationResult.status).toBe('failed');
        expect(result.beforeAfter.verificationStatus).toBe('failed');
        expect(result.verificationResult.failedChecks).toEqual([
            { check: 'node --check src/index.js', exitCode: 1 },
        ]);
        expect(callOrder).toEqual(['score', 'treatment', 'verification', 'score', 'compare']);
        expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    test('rejects arbitrary command, path, prescription, and workspace-root inputs', async () => {
        const invalidRequests = [
            { workspaceId: WORKSPACE_ID, finding: finding(), command: 'node arbitrary.js' },
            { workspaceId: WORKSPACE_ID, finding: finding(), workspacePath },
            { workspaceId: WORKSPACE_ID, finding: finding(), workspaceRoot: workspacePath },
            { workspaceId: WORKSPACE_ID, finding: finding(), prescription: context.prescription },
            { workspaceId: WORKSPACE_ID, finding: finding(), affectedPaths: ['src/other.js'] },
        ];

        for (const invalid of invalidRequests) {
            await expect(executeTreatmentWorkflow(invalid)).rejects.toMatchObject({
                code: 'INVALID_TREATMENT_WORKFLOW_REQUEST',
            });
        }

        expect(applyTreatment).not.toHaveBeenCalled();
        expect(workspaceService.runInWorkspace).not.toHaveBeenCalled();
        expect(workspaceService.cleanupWorkspace).toHaveBeenCalledTimes(invalidRequests.length);
    });

    test('rejects a finding path outside the stored approved paths', async () => {
        await expect(executeTreatmentWorkflow({
            workspaceId: WORKSPACE_ID,
            finding: finding({ affectedPath: 'src/not-approved.js' }),
        })).rejects.toMatchObject({ code: 'UNSAFE_PATH' });

        expect(applyTreatment).not.toHaveBeenCalled();
        expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    test('does not report success when treatment reports no changes', async () => {
        applyTreatment.mockResolvedValue({
            status: 'no_changes',
            changedFiles: [],
            beforeContent: { 'src/index.js': SOURCE_BEFORE },
        });
        verifyTreatment.mockResolvedValue({
            status: 'failed',
            checksRun: [],
            passedChecks: [],
            failedChecks: [{ check: 'Changed files', reason: 'No changed files.' }],
            changedFiles: [],
        });

        const result = await executeTreatmentWorkflow({ workspaceId: WORKSPACE_ID, finding: finding() });

        expect(result.status).toBe('failed');
        expect(result.treatmentResult).toEqual({ status: 'no_changes', changedFiles: [] });
        expect(workspaceService.cleanupWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    });

    test('returns only safe workflow data without source, workspace paths, or secrets', async () => {
        mockSuccessfulTreatment();
        verifyTreatment.mockResolvedValue(successfulVerification());

        const result = await executeTreatmentWorkflow({ workspaceId: WORKSPACE_ID, finding: finding() });
        const serialized = JSON.stringify(result);

        expect(Object.keys(result)).toEqual([
            'workspaceId', 'treatmentResult', 'verificationResult', 'beforeAfter', 'changedFiles', 'status',
        ]);
        expect(serialized).not.toContain(workspacePath);
        expect(serialized).not.toContain(SOURCE_BEFORE);
        expect(serialized).not.toContain(SOURCE_AFTER);
        expect(serialized).not.toContain(SECRET);
        expect(serialized).not.toContain('github-workflow-secret');
        expect(serialized).not.toContain('beforeContent');
        expect(serialized).not.toContain('outputSummary');
    });
});