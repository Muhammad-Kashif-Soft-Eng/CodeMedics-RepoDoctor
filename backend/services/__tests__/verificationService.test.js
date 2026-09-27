'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AppError = require('../AppError');
const { verifyTreatment } = require('../verificationService');

let testRoot;
let previousVerificationRoot;

function createWorkspace(options = {}) {
    const testScript = Object.hasOwn(options, 'testScript') ? options.testScript : 'node --test';
    const { testSource } = options;
    const workspace = fs.mkdtempSync(path.join(testRoot, 'workspace-'));
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'changed.js'), 'module.exports = true;\n');

    if (testScript !== null) {
        fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
            name: 'verification-fixture',
            scripts: { test: testScript },
        }));
    }
    if (testSource !== undefined) {
        fs.mkdirSync(path.join(workspace, 'test'), { recursive: true });
        fs.writeFileSync(path.join(workspace, 'test', 'verification.test.js'), testSource);
    }
    return workspace;
}

function requestFor(workspace, overrides = {}) {
    const changedFiles = overrides.changedFiles ?? ['src/changed.js'];
    const treatmentResult = overrides.treatmentResult ?? {
        status: 'applied',
        changedFiles,
        beforeContent: { 'src/changed.js': 'module.exports = false;\n' },
    };
    return {
        workspacePath: workspace,
        changedFiles,
        treatmentResult,
        projectInfo: { language: 'JavaScript', packageManager: 'npm' },
        ...overrides,
    };
}

const PASSING_TEST = [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "test('fixture passes', () => { console.log('verification output marker'); assert.equal(2 + 2, 4); });",
].join('\n');

const FAILING_TEST = [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "test('fixture fails', () => { assert.equal(2 + 2, 5); });",
].join('\n');

beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoctor-verification-'));
    previousVerificationRoot = process.env.VERIFICATION_WORKSPACE_ROOT;
    process.env.VERIFICATION_WORKSPACE_ROOT = testRoot;
});

afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
    if (previousVerificationRoot === undefined) delete process.env.VERIFICATION_WORKSPACE_ROOT;
    else process.env.VERIFICATION_WORKSPACE_ROOT = previousVerificationRoot;
});

describe('verificationService.verifyTreatment', () => {
    test('passes when the allowlisted project test script succeeds', async () => {
        const workspace = createWorkspace({ testSource: PASSING_TEST });

        const result = await verifyTreatment(requestFor(workspace));

        expect(result.status).toBe('passed');
        expect(result.checksRun).toEqual(['node --test']);
        expect(result.passedChecks).toEqual(['node --test']);
        expect(result.failedChecks).toEqual([]);
    });

    test('fails when the project test script exits unsuccessfully', async () => {
        const workspace = createWorkspace({ testSource: FAILING_TEST });

        const result = await verifyTreatment(requestFor(workspace));

        expect(result.status).toBe('failed');
        expect(result.passedChecks).toEqual([]);
        expect(result.failedChecks[0].exitCode).not.toBe(0);
        expect(result.failedChecks[0].output).toContain('fixture fails');
    });

    test('fails without running a command when no changed files are reported', async () => {
        const workspace = createWorkspace({ testSource: PASSING_TEST });
        const spawnImpl = jest.fn();
        const request = requestFor(workspace, {
            changedFiles: [],
            treatmentResult: { status: 'no_changes', changedFiles: [], beforeContent: {} },
            options: { spawnImpl },
        });

        const result = await verifyTreatment(request);

        expect(result.status).toBe('failed');
        expect(result.failedChecks[0].check).toBe('Changed files');
        expect(spawnImpl).not.toHaveBeenCalled();
    });

    test('rejects unsupported project test commands without executing them', async () => {
        const workspace = createWorkspace({ testScript: 'echo must-not-run' });
        const spawnImpl = jest.fn();

        await expect(verifyTreatment(requestFor(workspace, { options: { spawnImpl } }))).rejects.toMatchObject({
            code: 'UNSUPPORTED_VERIFICATION_COMMAND',
        });
        expect(spawnImpl).not.toHaveBeenCalled();
    });

    test('rejects a workspace outside the configured controlled root', async () => {
        const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoctor-outside-'));
        const outsideWorkspace = path.join(outsideRoot, 'workspace');
        fs.mkdirSync(outsideWorkspace);

        try {
            await expect(verifyTreatment(requestFor(outsideWorkspace))).rejects.toMatchObject({
                code: 'UNSAFE_WORKSPACE',
            });
        } finally {
            fs.rmSync(outsideRoot, { recursive: true, force: true });
        }
    });

    test('maps process launch errors to a controlled application error', async () => {
        const workspace = createWorkspace({ testSource: PASSING_TEST });
        const spawnImpl = jest.fn(() => {
            const child = new EventEmitter();
            process.nextTick(() => child.emit('error', new Error('internal executable path')));
            return child;
        });

        await expect(verifyTreatment(requestFor(workspace, { options: { spawnImpl } }))).rejects.toMatchObject({
            code: 'VERIFICATION_PROCESS_ERROR',
        });
    });

    test('times out and terminates a hanging verification process', async () => {
        const workspace = createWorkspace({
            testSource: "const test = require('node:test'); test('hangs', () => new Promise(() => {}));",
        });

        await expect(verifyTreatment(requestFor(workspace, { options: { timeoutMs: 30 } }))).rejects.toMatchObject({
            code: 'VERIFICATION_TIMEOUT',
            httpStatus: 504,
        });
    });

    test('captures command output in the normalized summary', async () => {
        const workspace = createWorkspace({ testSource: PASSING_TEST });

        const result = await verifyTreatment(requestFor(workspace));

        expect(result.outputSummary).toContain('node --test:');
        expect(result.outputSummary).toContain('verification output marker');
    });

    test('reports changed files and before/current state fingerprints', async () => {
        const workspace = createWorkspace({ testSource: PASSING_TEST });

        const result = await verifyTreatment(requestFor(workspace));

        expect(result.changedFiles).toEqual(['src/changed.js']);
        expect(result.beforeState['src/changed.js']).toMatchObject({ exists: true, sizeBytes: 24 });
        expect(result.currentState['src/changed.js']).toMatchObject({ exists: true, sizeBytes: 23 });
        expect(result.beforeState['src/changed.js'].sha256).not.toBe(result.currentState['src/changed.js'].sha256);
    });

    test('never reports passed for a nonzero process result', async () => {
        const workspace = createWorkspace({ testSource: FAILING_TEST });

        const result = await verifyTreatment(requestFor(workspace));

        expect(result.status).toBe('failed');
        expect(result.failedChecks).toHaveLength(1);
        expect(result.verificationMessage).toContain('failed');
    });

    test('uses node syntax checks for changed JavaScript files when no test script exists', async () => {
        const workspace = createWorkspace({ testScript: null });

        const result = await verifyTreatment(requestFor(workspace));

        expect(result.status).toBe('passed');
        expect(result.checksRun).toEqual(['node --check src/changed.js']);
    });

    test('requires treatment changed files to match the request', async () => {
        const workspace = createWorkspace();
        const request = requestFor(workspace, {
            treatmentResult: { status: 'applied', changedFiles: ['other.js'], beforeContent: {} },
        });

        await expect(verifyTreatment(request)).rejects.toMatchObject({
            code: 'INVALID_VERIFICATION_REQUEST',
        });
    });

    test('returns failed when a reported changed file is missing in the current workspace', async () => {
        const workspace = createWorkspace();
        const request = requestFor(workspace, {
            changedFiles: ['src/missing.js'],
            treatmentResult: {
                status: 'applied',
                changedFiles: ['src/missing.js'],
                beforeContent: { 'src/missing.js': null },
            },
        });

        const result = await verifyTreatment(request);

        expect(result.status).toBe('failed');
        expect(result.failedChecks[0].check).toBe('Changed files exist');
    });

    test('accepts only explicit runner identifiers and never reads a client shell command', async () => {
        const workspace = createWorkspace({ testScript: null });
        process.env.OPENAI_API_KEY = 'verification-test-secret';
        const spawnImpl = jest.fn((executable, args, options) => {
            expect(executable).toBe(process.execPath);
            expect(args[0]).toBe('--check');
            expect(options.shell).toBe(false);
            expect(options.env.OPENAI_API_KEY).toBeUndefined();
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            process.nextTick(() => child.emit('close', 0, null));
            return child;
        });

        const result = await verifyTreatment(requestFor(workspace, {
            projectInfo: { language: 'JavaScript', command: 'arbitrary client command' },
            options: { spawnImpl },
        }));

        expect(result.status).toBe('passed');
        expect(spawnImpl).toHaveBeenCalledTimes(1);
    });

    test('preserves before-state and current-state for a no-change treatment result', async () => {
        const workspace = createWorkspace();
        const request = requestFor(workspace, {
            changedFiles: ['src/changed.js'],
            treatmentResult: {
                status: 'no_changes',
                changedFiles: ['src/changed.js'],
                beforeContent: { 'src/changed.js': 'module.exports = false;\n' },
            },
        });

        const result = await verifyTreatment(request);

        expect(result.status).toBe('failed');
        expect(result.beforeState['src/changed.js'].sha256).toBeDefined();
        expect(result.currentState['src/changed.js'].sha256).toBeDefined();
    });

    test('uses AppError for invalid input', async () => {
        await expect(verifyTreatment({ workspacePath: testRoot })).rejects.toBeInstanceOf(AppError);
    });
});
