'use strict';

const request = require('supertest');

jest.mock('../../services/workspaceService', () => ({ createWorkspace: jest.fn() }));
jest.mock('../../models/ScanResult', () => ({ findById: jest.fn() }));

const workspaceService = require('../../services/workspaceService');
const ScanResult = require('../../models/ScanResult');
const AppError = require('../../services/AppError');
const app = require('../../app');

const SCAN_ID = 'scan-result-123';
const WORKSPACE_ID = 'repodoctor-6c94fe5c-b10a-4da4-85fa-721a61c906bd';
const SOURCE_CONTENT = 'source contents must never be returned';
const SECRET = 'workspace-route-secret';

const STORED_SCAN = {
    _id: SCAN_ID,
    owner: 'acme',
    repo: 'widget',
    defaultBranch: 'main',
    language: 'JavaScript',
    truncated: false,
    structure: {
        totalFiles: 3,
        totalDirectories: 1,
        sourceFileCount: 1,
        testFileCount: 1,
        docFileCount: 0,
        configFileCount: 0,
        hasPackageJson: true,
        hasReadme: false,
        hasTests: true,
    },
    testingSignals: { testFileCount: 1, testFilePaths: ['test/widget.test.js'], testDirPaths: ['test'] },
    docSignals: { readmePaths: [], docFilePaths: [], docFileCount: 0 },
    qualitySignals: { largeFilePaths: [], skippedFilePaths: [] },
    dependencySignals: { manifestPaths: ['package.json'] },
    healthScore: { overall: 50 },
};

const FINDING = {
    title: 'Limited test coverage',
    category: 'Testing',
    severity: 'High',
    evidence: 'One test file was detected.',
    affectedPath: 'test/widget.test.js',
    explanation: 'More behavior should be covered.',
};

const PRESCRIPTION = {
    title: 'Improve test coverage',
    reason: 'Important behavior is not covered.',
    expectedOutcome: 'The test file is expanded.',
    affectedPaths: ['test/widget.test.js'],
    treatmentSteps: ['Add focused tests.'],
    verificationPlan: 'Run the supported verification check.',
    riskNotes: null,
    approved: true,
};

const VALID_BODY = { scanId: SCAN_ID, selectedFinding: FINDING, prescription: PRESCRIPTION };

beforeEach(() => {
    jest.resetAllMocks();
    ScanResult.findById.mockResolvedValue(STORED_SCAN);
    workspaceService.createWorkspace.mockResolvedValue({
        workspaceId: WORKSPACE_ID,
        repository: { owner: 'acme', repo: 'widget', defaultBranch: 'main' },
        materializedFiles: ['package.json', 'test/widget.test.js'],
        workspacePath: 'C:\\private\\workspaces\\workspace-1',
        sourceContent: SOURCE_CONTENT,
        beforeContent: { 'test/widget.test.js': SOURCE_CONTENT },
        secret: SECRET,
        environment: { API_KEY: SECRET },
    });
    jest.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function postWorkspace(body) {
    return request(app).post('/api/workspace').send(body);
}

describe('POST /api/workspace', () => {
    test('creates an approved workspace from the stored scan and returns safe metadata', async () => {
        const response = await postWorkspace(VALID_BODY);

        expect(response.status).toBe(201);
        expect(response.body).toEqual({
            workspaceId: WORKSPACE_ID,
            repository: { owner: 'acme', repo: 'widget', defaultBranch: 'main' },
            materializedFiles: ['package.json', 'test/widget.test.js'],
        });
        expect(ScanResult.findById).toHaveBeenCalledWith(SCAN_ID);
        expect(workspaceService.createWorkspace).toHaveBeenCalledWith({
            scanResult: expect.objectContaining({
                scanId: SCAN_ID,
                owner: 'acme',
                repo: 'widget',
                defaultBranch: 'main',
            }),
            prescription: PRESCRIPTION,
        });
    });

    test.each([
        {},
        { selectedFinding: FINDING, prescription: PRESCRIPTION },
        { scanId: SCAN_ID, prescription: PRESCRIPTION },
        { scanId: SCAN_ID, selectedFinding: FINDING },
    ])('rejects missing required data in %p', async (body) => {
        const response = await postWorkspace(body);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_WORKSPACE_REQUEST');
        expect(ScanResult.findById).not.toHaveBeenCalled();
        expect(workspaceService.createWorkspace).not.toHaveBeenCalled();
    });

    test('rejects an invalid repository identity from the stored scan', async () => {
        ScanResult.findById.mockResolvedValue({ ...STORED_SCAN, owner: '../outside' });
        workspaceService.createWorkspace.mockRejectedValue(new AppError(
            'INVALID_WORKSPACE_REQUEST', 400, 'invalid repository identity'
        ));

        const response = await postWorkspace(VALID_BODY);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_WORKSPACE_REQUEST');
        expect(workspaceService.createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
            scanResult: expect.objectContaining({ owner: '../outside' }),
        }));
    });

    test.each([null, [], { ...FINDING, category: 'Security' }, { ...FINDING, severity: 'Urgent' }])(
        'rejects invalid finding %p', async (selectedFinding) => {
            const response = await postWorkspace({ ...VALID_BODY, selectedFinding });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('INVALID_FINDING');
            expect(workspaceService.createWorkspace).not.toHaveBeenCalled();
        }
    );

    test.each([
        ['path outside scan evidence', { ...PRESCRIPTION, affectedPaths: ['src/not-scanned.js'] }],
        ['prescription path not matching the selected finding', { ...PRESCRIPTION, affectedPaths: ['test/other.test.js'] }],
        ['unapproved prescription', { ...PRESCRIPTION, approved: false }],
    ])('rejects %s', async (_reason, prescription) => {
        const response = await postWorkspace({ ...VALID_BODY, prescription });

        expect(response.status).toBe(400);
        expect(workspaceService.createWorkspace).not.toHaveBeenCalled();
    });

    test.each([
        ['workspacePath', 'C:\\private\\repo'],
        ['workspaceRoot', 'C:\\private'],
        ['command', 'node arbitrary.js'],
        ['executable', 'C:\\node.exe'],
        ['workspaceId', WORKSPACE_ID],
        ['beforeContent', { 'test/widget.test.js': SOURCE_CONTENT }],
    ])('rejects forbidden top-level field %s', async (key, value) => {
        const response = await postWorkspace({ ...VALID_BODY, [key]: value });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_WORKSPACE_REQUEST');
        expect(workspaceService.createWorkspace).not.toHaveBeenCalled();
    });

    test('rejects filesystem and command fields inside the prescription', async () => {
        const pathInjection = await postWorkspace({
            ...VALID_BODY,
            prescription: { ...PRESCRIPTION, workspacePath: 'C:\\private\\repo' },
        });
        const commandInjection = await postWorkspace({
            ...VALID_BODY,
            prescription: { ...PRESCRIPTION, command: 'node arbitrary.js' },
        });

        expect(pathInjection.status).toBe(400);
        expect(commandInjection.status).toBe(400);
        expect(workspaceService.createWorkspace).not.toHaveBeenCalled();
    });

    test('returns a safe not-found error when the scan ID is unknown', async () => {
        ScanResult.findById.mockResolvedValue(null);

        const response = await postWorkspace(VALID_BODY);

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('SCAN_RESULT_NOT_FOUND');
        expect(workspaceService.createWorkspace).not.toHaveBeenCalled();
    });

    test('propagates workspace service errors without leaking paths or secrets', async () => {
        workspaceService.createWorkspace.mockRejectedValue(new AppError(
            'REPO_PRIVATE', 403, `private C:\\secret\\repo ${SECRET}`
        ));

        const response = await postWorkspace(VALID_BODY);
        const json = JSON.stringify(response.body);

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('REPO_PRIVATE');
        expect(json).not.toContain('C:\\secret');
        expect(json).not.toContain(SECRET);
    });

    test('does not return absolute paths, file contents, or secret metadata from the service', async () => {
        const response = await postWorkspace(VALID_BODY);
        const json = JSON.stringify(response.body);

        expect(json).toContain(WORKSPACE_ID);
        expect(json).not.toContain('C:\\private');
        expect(json).not.toContain(SOURCE_CONTENT);
        expect(json).not.toContain(SECRET);
        expect(json).not.toContain('beforeContent');
        expect(json).not.toContain('environment');
    });

    test('rejects absolute paths returned as materialized-file metadata', async () => {
        workspaceService.createWorkspace.mockResolvedValue({
            workspaceId: WORKSPACE_ID,
            repository: { owner: 'acme', repo: 'widget', defaultBranch: 'main' },
            materializedFiles: ['C:\\private\\source.js'],
        });

        const response = await postWorkspace(VALID_BODY);

        expect(response.status).toBe(502);
        expect(response.body.error.code).toBe('INVALID_WORKSPACE_RESULT');
        expect(JSON.stringify(response.body)).not.toContain('C:\\private');
    });
});