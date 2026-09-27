'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const AppError = require('./AppError');

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_OUTPUT_BYTES = 12000;
const TEST_SCRIPT_ALLOWLIST = new Map([
    ['node --test', { runner: 'node-test', label: 'node --test' }],
    ['jest', { runner: 'jest', label: 'jest --runInBand' }],
    ['jest --runInBand', { runner: 'jest', label: 'jest --runInBand' }],
    ['vitest', { runner: 'vitest', label: 'vitest run' }],
    ['vitest run', { runner: 'vitest', label: 'vitest run' }],
    ['mocha', { runner: 'mocha', label: 'mocha' }],
]);
const SYNTAX_CHECK_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

function invalidRequest(message = 'The verification request is incomplete or invalid.') {
    return new AppError('INVALID_VERIFICATION_REQUEST', 400, message);
}

function unsafeWorkspace() {
    return new AppError('UNSAFE_WORKSPACE', 400, 'The workspace is outside the permitted verification area.');
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveWorkspace(workspacePath) {
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
        throw invalidRequest('A workspace path is required.');
    }

    const configuredRoot = process.env.VERIFICATION_WORKSPACE_ROOT || process.env.TREATMENT_WORKSPACE_ROOT;
    if (!configuredRoot) throw unsafeWorkspace();

    let workspace;
    let root;
    try {
        workspace = fs.realpathSync(path.resolve(workspacePath.trim()));
        root = fs.realpathSync(path.resolve(configuredRoot));
    } catch {
        throw unsafeWorkspace();
    }

    try {
        if (!fs.statSync(workspace).isDirectory() || !fs.statSync(root).isDirectory() || !isWithin(root, workspace)) {
            throw unsafeWorkspace();
        }
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw unsafeWorkspace();
    }

    return workspace;
}

function resolveChangedPath(relativePath, workspace) {
    if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0')) {
        throw new AppError('UNSAFE_PATH', 400, 'A changed file path is invalid.');
    }
    if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
        throw new AppError('UNSAFE_PATH', 400, 'A changed file path is not permitted.');
    }

    const resolved = path.resolve(workspace, relativePath);
    if (!isWithin(workspace, resolved)) throw new AppError('UNSAFE_PATH', 400, 'A changed file path is not permitted.');

    let ancestor = resolved;
    while (!fs.existsSync(ancestor)) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new AppError('UNSAFE_PATH', 400, 'A changed file path is not permitted.');
        ancestor = parent;
    }

    let realAncestor;
    try {
        realAncestor = fs.realpathSync(ancestor);
    } catch {
        throw new AppError('UNSAFE_PATH', 400, 'A changed file path is not permitted.');
    }
    if (!isWithin(workspace, realAncestor)) throw new AppError('UNSAFE_PATH', 400, 'A changed file path is not permitted.');

    return resolved;
}

function fileFingerprint(content) {
    if (typeof content !== 'string') return { exists: false, sizeBytes: 0, sha256: null };
    const bytes = Buffer.from(content, 'utf8');
    return {
        exists: true,
        sizeBytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
}

function getCurrentState(changedFiles, resolvedPaths) {
    const state = {};
    for (const [index, relativePath] of changedFiles.entries()) {
        const absolutePath = resolvedPaths[index];
        try {
            const content = fs.readFileSync(absolutePath);
            state[relativePath] = fileFingerprint(content.toString('utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') {
                state[relativePath] = fileFingerprint(null);
                continue;
            }
            throw new AppError('VERIFICATION_PROCESS_ERROR', 500, 'The workspace could not be inspected.');
        }
    }
    return state;
}

function summarizeOutput(value) {
    const output = String(value || '').trim();
    if (!output) return '(no output)';
    if (Buffer.byteLength(output, 'utf8') <= MAX_OUTPUT_BYTES) return output;
    let summary = output;
    while (Buffer.byteLength(summary, 'utf8') > MAX_OUTPUT_BYTES - 32) {
        summary = summary.slice(0, Math.floor(summary.length * 0.9));
    }
    return `${summary}\n[output truncated]`;
}

function verificationEnvironment() {
    return Object.fromEntries(
        Object.entries(process.env).filter(([name]) =>
            !/(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|MONGODB_URI)/i.test(name)
        )
    );
}

function readTestScript(workspace) {
    const packagePath = path.join(workspace, 'package.json');
    if (!fs.existsSync(packagePath)) return null;

    let packageJson;
    try {
        packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    } catch {
        throw new AppError('UNSUPPORTED_VERIFICATION_COMMAND', 400, 'The project test configuration is invalid.');
    }

    const testScript = packageJson?.scripts?.test;
    if (testScript == null) return null;
    if (typeof testScript !== 'string') {
        throw new AppError('UNSUPPORTED_VERIFICATION_COMMAND', 400, 'The project test command is not supported.');
    }

    const allowed = TEST_SCRIPT_ALLOWLIST.get(testScript.trim());
    if (!allowed) {
        throw new AppError('UNSUPPORTED_VERIFICATION_COMMAND', 400, 'The project test command is not in the verification allowlist.');
    }
    return allowed;
}

function resolveRunnerModule(moduleName, workspace) {
    try {
        if (moduleName === 'jest') return require.resolve('jest/bin/jest', { paths: [workspace] });
        if (moduleName === 'vitest') return require.resolve('vitest/vitest.mjs', { paths: [workspace] });
        if (moduleName === 'mocha') return require.resolve('mocha/bin/mocha.js', { paths: [workspace] });
    } catch {
        throw new AppError('UNSUPPORTED_VERIFICATION_COMMAND', 400, 'The configured test runner is not installed in the workspace.');
    }
    throw new AppError('UNSUPPORTED_VERIFICATION_COMMAND', 400, 'The configured test runner is not supported.');
}

function createCheck(workspace, testScript, changedFiles, resolvedPaths) {
    if (testScript) {
        if (testScript.runner === 'node-test') {
            return [{ name: testScript.label, executable: process.execPath, args: ['--test'] }];
        }
        const modulePath = resolveRunnerModule(testScript.runner, workspace);
        const runnerArgs = testScript.runner === 'jest'
            ? ['--runInBand']
            : testScript.runner === 'vitest' ? ['run'] : [];
        return [{ name: testScript.label, executable: process.execPath, args: [modulePath, ...runnerArgs] }];
    }

    const syntaxChecks = changedFiles
        .map((file, index) => ({ file, absolutePath: resolvedPaths[index] }))
        .filter(({ file }) => SYNTAX_CHECK_EXTENSIONS.has(path.extname(file).toLowerCase()));
    if (syntaxChecks.length === 0) {
        throw new AppError('UNSUPPORTED_VERIFICATION_COMMAND', 400, 'No supported test script or JavaScript syntax check is available.');
    }

    return syntaxChecks.map(({ file, absolutePath }) => ({
        name: `node --check ${file}`,
        executable: process.execPath,
        args: ['--check', absolutePath],
    }));
}

function runProcess(check, workspace, timeoutMs, spawnImpl) {
    return new Promise((resolve, reject) => {
        let child;
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        let timeoutTimer;
        let killTimer;

        const clearTimers = () => {
            clearTimeout(timeoutTimer);
            clearTimeout(killTimer);
        };
        const fail = (error) => {
            if (settled) return;
            settled = true;
            clearTimers();
            reject(error);
        };
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimers();
            resolve(result);
        };
        const capture = (current, chunk) => {
            const next = current + chunk.toString('utf8');
            return Buffer.byteLength(next, 'utf8') <= MAX_OUTPUT_BYTES
                ? next
                : next.slice(-MAX_OUTPUT_BYTES);
        };

        try {
            child = spawnImpl(check.executable, check.args, {
                cwd: workspace,
                shell: false,
                windowsHide: true,
                env: verificationEnvironment(),
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch {
            fail(new AppError('VERIFICATION_PROCESS_ERROR', 500, 'The verification check could not be started.'));
            return;
        }

        child.stdout?.on('data', (chunk) => { stdout = capture(stdout, chunk); });
        child.stderr?.on('data', (chunk) => { stderr = capture(stderr, chunk); });
        child.once('error', () => {
            fail(new AppError('VERIFICATION_PROCESS_ERROR', 500, 'The verification check could not be started.'));
        });
        child.once('close', (exitCode, signal) => {
            if (timedOut) {
                fail(new AppError('VERIFICATION_TIMEOUT', 504, `Verification check timed out: ${check.name}.`));
                return;
            }
            finish({ exitCode, signal, stdout, stderr });
        });

        timeoutTimer = setTimeout(() => {
            timedOut = true;
            child.kill();
            killTimer = setTimeout(() => {
                child.kill('SIGKILL');
                fail(new AppError('VERIFICATION_TIMEOUT', 504, `Verification check timed out: ${check.name}.`));
            }, 1000);
        }, timeoutMs);
    });
}

function normalizeOutput(checkResults) {
    return summarizeOutput(checkResults.map(({ check, result }) => {
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        return `${check.name}:\n${output || '(no output)'}`;
    }).join('\n\n'));
}

async function verifyTreatment({
    workspacePath,
    changedFiles,
    treatmentResult,
    projectInfo = {},
    options = {},
} = {}) {
    if (!Array.isArray(changedFiles) || !isRecord(treatmentResult) || !isRecord(projectInfo) || !isRecord(options)) {
        throw invalidRequest();
    }
    if (!['applied', 'no_changes'].includes(treatmentResult.status) || !Array.isArray(treatmentResult.changedFiles)) {
        throw invalidRequest('A normalized treatment result is required.');
    }
    if (changedFiles.length !== treatmentResult.changedFiles.length || changedFiles.some((file, index) => file !== treatmentResult.changedFiles[index])) {
        throw invalidRequest('Changed files must match the treatment result.');
    }

    const workspace = resolveWorkspace(workspacePath);
    const resolvedPaths = changedFiles.map((file) => resolveChangedPath(file, workspace));
    const beforeContent = treatmentResult.beforeContent ?? {};
    if (!isRecord(beforeContent)) throw invalidRequest('The treatment before-state is invalid.');

    const beforeState = Object.fromEntries(changedFiles.map((file) => [file, fileFingerprint(beforeContent[file])]));
    const currentState = getCurrentState(changedFiles, resolvedPaths);

    if (changedFiles.length === 0 || treatmentResult.status === 'no_changes') {
        return {
            status: 'failed',
            checksRun: [],
            passedChecks: [],
            failedChecks: [{
                check: 'Changed files',
                reason: 'No treatment changes were reported, so there is nothing to verify.',
            }],
            outputSummary: '(no verification command executed)',
            changedFiles,
            verificationMessage: 'Verification failed because no changed files were reported.',
            beforeState,
            currentState,
        };
    }

    const missingFiles = changedFiles.filter((file) => !currentState[file].exists);
    if (missingFiles.length > 0) {
        return {
            status: 'failed',
            checksRun: ['Changed files exist'],
            passedChecks: [],
            failedChecks: [{
                check: 'Changed files exist',
                reason: `Reported changed files are missing from the workspace: ${missingFiles.join(', ')}.`,
            }],
            outputSummary: '(verification command not run because changed files are missing)',
            changedFiles,
            verificationMessage: 'Verification failed because one or more reported changed files are missing.',
            beforeState,
            currentState,
        };
    }

    const timeoutMs = options.timeoutMs ?? Number(process.env.VERIFICATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
        throw invalidRequest('The verification timeout is invalid.');
    }

    const testScript = readTestScript(workspace);
    const checkList = createCheck(workspace, testScript, changedFiles, resolvedPaths);
    const spawnImpl = options.spawnImpl ?? spawn;
    const checkResults = [];

    for (const check of checkList) {
        const result = await runProcess(check, workspace, timeoutMs, spawnImpl);
        checkResults.push({ check, result });
    }

    const passedChecks = checkResults
        .filter(({ result }) => result.exitCode === 0)
        .map(({ check }) => check.name);
    const failedChecks = checkResults
        .filter(({ result }) => result.exitCode !== 0)
        .map(({ check, result }) => ({
            check: check.name,
            exitCode: result.exitCode,
            signal: result.signal,
            output: summarizeOutput([result.stdout, result.stderr].filter(Boolean).join('\n')),
        }));
    const status = failedChecks.length === 0 ? 'passed' : 'failed';

    return {
        status,
        checksRun: checkList.map(({ name }) => name),
        passedChecks,
        failedChecks,
        outputSummary: normalizeOutput(checkResults),
        changedFiles,
        verificationMessage: status === 'passed'
            ? 'All deterministic verification checks passed.'
            : 'One or more deterministic verification checks failed.',
        beforeState,
        currentState: getCurrentState(changedFiles, resolvedPaths),
    };
}

module.exports = { verifyTreatment, resolveWorkspace, resolveChangedPath };