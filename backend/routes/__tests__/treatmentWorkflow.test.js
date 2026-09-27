'use strict';

const request = require('supertest');

jest.mock('../../services/treatmentWorkflowService');

const { executeTreatmentWorkflow } = require('../../services/treatmentWorkflowService');
const AppError = require('../../services/AppError');
const app = require('../../app');

const WORKSPACE_ID = 'repodoctor-6c94fe5c-b10a-4da4-85fa-721a61c906bd';
const FINDING = {
    title: 'Resolve source markers',
    category: 'Code Quality',
    severity: 'Medium',
    evidence: 'The source file contains TODO markers.',
    affectedPath: 'src/index.js',
    explanation: 'Remove completed-work markers.',
};
const VALID_BODY = { workspaceId: WORKSPACE_ID, finding: FINDING };
const WORKFLOW_RESULT = {
    workspaceId: WORKSPACE_ID,
    treatmentResult: { status: 'applied', changedFiles: ['src/index.js'] },
    verificationResult: {
        status: 'passed',
        checksRun: ['node --check src/index.js'],
        passedChecks: ['node --check src/index.js'],
        failedChecks: [],
        changedFiles: ['src/index.js'],
        verificationMessage: 'All deterministic verification checks passed.',
    },
    beforeAfter: {
        beforeScore: 32,
        afterScore: 34,
        scoreDelta: 2,
        beforeCategories: { testing: 0, documentation: 0, structure: 65, codeQuality: 85, dependencies: 40 },
        afterCategories: { testing: 0, documentation: 0, structure: 65, codeQuality: 100, dependencies: 40 },
        changedFiles: ['src/index.js'],
        verificationStatus: 'passed',
        verificationChecks: {
            checksRun: ['node --check src/index.js'],
            passedChecks: ['node --check src/index.js'],
            failedChecks: [],
        },
        improved: true,
        summary: 'Health improved by 2 points and verification passed. 1 approved changed file was confirmed.',
    },
    changedFiles: ['src/index.js'],
    status: 'completed',
};

beforeEach(() => {
    jest.resetAllMocks();
    executeTreatmentWorkflow.mockResolvedValue(WORKFLOW_RESULT);
    jest.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function postWorkflow(body) {
    return request(app).post('/api/treatment-workflow').send(body);
}

describe('POST /api/treatment-workflow', () => {
    test('delegates exactly the opaque workspace ID and finding, then returns the normalized result', async () => {
        const response = await postWorkflow(VALID_BODY);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(WORKFLOW_RESULT);
        expect(executeTreatmentWorkflow).toHaveBeenCalledTimes(1);
        expect(executeTreatmentWorkflow).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, finding: FINDING });
    });

    test('rejects path-shaped or malformed workspace IDs without calling the service', async () => {
        const invalidIds = [
            'C:\\private\\repo',
            '/tmp/workspace',
            '../workspace',
            'repodoctor-not-a-uuid',
        ];

        for (const workspaceId of invalidIds) {
            const response = await postWorkflow({ ...VALID_BODY, workspaceId });
            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('INVALID_WORKSPACE_ID');
            expect(JSON.stringify(response.body)).not.toContain(workspaceId);
        }
        expect(executeTreatmentWorkflow).not.toHaveBeenCalled();
    });

    test.each([null, [], 'not-a-finding'])('rejects invalid finding value %p', async (finding) => {
        const response = await postWorkflow({ ...VALID_BODY, finding });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_TREATMENT_WORKFLOW_REQUEST');
        expect(executeTreatmentWorkflow).not.toHaveBeenCalled();
    });

    test.each([
        {},
        { workspaceId: WORKSPACE_ID },
        { finding: FINDING },
    ])('rejects missing request fields in %p', async (body) => {
        const response = await postWorkflow(body);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_TREATMENT_WORKFLOW_REQUEST');
        expect(executeTreatmentWorkflow).not.toHaveBeenCalled();
    });

    test.each([
        ['workspacePath', 'C:\\private\\repo'],
        ['workspaceRoot', 'C:\\private'],
        ['command', 'node arbitrary.js'],
        ['executable', 'C:\\node.exe'],
        ['prescription', { approved: true, affectedPaths: ['src/other.js'] }],
        ['options', { fetchImpl: 'client-value' }],
        ['beforeAfter', { beforeScore: 1 }],
        ['healthResult', { overall: 100 }],
    ])('rejects forbidden top-level field %s', async (key, value) => {
        const response = await postWorkflow({ ...VALID_BODY, [key]: value });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_TREATMENT_WORKFLOW_REQUEST');
        expect(executeTreatmentWorkflow).not.toHaveBeenCalled();
    });

    test('rejects command-like and filesystem fields nested in the finding', async () => {
        const command = await postWorkflow({
            ...VALID_BODY,
            finding: { ...FINDING, command: 'node arbitrary.js' },
        });
        const pathInput = await postWorkflow({
            ...VALID_BODY,
            finding: { ...FINDING, affectedPath: 'C:\\private\\file.js' },
        });

        expect(command.status).toBe(400);
        expect(pathInput.status).toBe(400);
        expect(executeTreatmentWorkflow).not.toHaveBeenCalled();
    });

    test('propagates AppError status and code with a safe message', async () => {
        process.env.ROUTE_WORKFLOW_SECRET = 'route-workflow-secret';
        executeTreatmentWorkflow.mockRejectedValue(new AppError(
            'AI_PROVIDER_ERROR', 502, `secret route-workflow-secret at C:\\private\\repo`
        ));

        const response = await postWorkflow(VALID_BODY);

        expect(response.status).toBe(502);
        expect(response.body.error.code).toBe('AI_PROVIDER_ERROR');
        expect(response.body.error.message).not.toContain('route-workflow-secret');
        expect(response.body.error.message).not.toContain('C:\\private');
        expect(JSON.stringify(response.body)).not.toContain(process.env.ROUTE_WORKFLOW_SECRET);
        delete process.env.ROUTE_WORKFLOW_SECRET;
    });

    test('does not leak paths, file contents, beforeContent, or command output', async () => {
        const response = await postWorkflow(VALID_BODY);
        const json = JSON.stringify(response.body);

        expect(response.body).toEqual(WORKFLOW_RESULT);
        expect(json).not.toContain('C:\\private');
        expect(json).not.toContain('source contents');
        expect(json).not.toContain('beforeContent');
        expect(json).not.toContain('outputSummary');
        expect(json).not.toContain('API_KEY');
        expect(json).not.toContain('environment variables');
    });

    test('does not return or forward client-supplied prescriptions or commands', async () => {
        const response = await postWorkflow(VALID_BODY);

        expect(executeTreatmentWorkflow).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, finding: FINDING });
        expect(response.body).not.toHaveProperty('prescription');
        expect(response.body).not.toHaveProperty('command');
    });

    test('returns a generic internal error without leaking unexpected exception details', async () => {
        executeTreatmentWorkflow.mockRejectedValue(new Error('secret key C:\\private\\repo'));

        const response = await postWorkflow(VALID_BODY);

        expect(response.status).toBe(500);
        expect(response.body).toEqual({
            error: { code: 'INTERNAL_ERROR', message: 'The treatment workflow could not be completed.' },
        });
        expect(JSON.stringify(response.body)).not.toContain('secret');
        expect(JSON.stringify(response.body)).not.toContain('C:\\private');
    });
});