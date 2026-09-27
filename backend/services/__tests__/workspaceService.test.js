'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

jest.mock('../githubClient', () => ({
    getRepoInfo: jest.fn(),
    getRepoTree: jest.fn(),
    getFileContent: jest.fn(),
    MAX_CONTENT_BYTES: 100 * 1024,
}));

const { getRepoInfo, getRepoTree, getFileContent } = require('../githubClient');
const AppError = require('../AppError');
const { createWorkspace, runInWorkspace, cleanupWorkspace } = require('../workspaceService');

const PROCESS_METHODS = ['spawn', 'exec', 'execFile', 'fork', 'execSync', 'execFileSync'];
const FILES = {
    'package.json': JSON.stringify({ name: 'workspace-demo', scripts: { test: 'node --test' } }),
    'src/index.js': 'module.exports = "private source sentinel";\n',
    'README.md': '# Not needed by treatment or verification\n',
    'test/example.test.js': 'throw new Error("must not be materialized");\n',
};

let tempRoot;
let previousEnvironment;
let processSpies;
let originalFetch;

function request(overrides = {}) {
    return {
        scanResult: {
            scanId: 'scan-result-123',
            owner: 'scanned-owner',
            repo: 'demo-project',
            defaultBranch: 'release/workspace-test',
        },
        prescription: {
            approved: true,
            affectedPaths: ['src/index.js'],
        },
        ...overrides,
    };
}

function configureGithub() {
    getRepoInfo.mockResolvedValue({
        owner: 'Scanned-Owner',
        repo: 'Demo-Project',
        defaultBranch: 'main',
        isPrivate: false,
    });
    getRepoTree.mockResolvedValue({
        truncated: false,
        tree: [
            { path: 'package.json', type: 'blob', size: Buffer.byteLength(FILES['package.json']) },
            { path: 'src', type: 'tree' },
            { path: 'src/index.js', type: 'blob', size: Buffer.byteLength(FILES['src/index.js']) },
            { path: 'README.md', type: 'blob', size: Buffer.byteLength(FILES['README.md']) },
            { path: 'test', type: 'tree' },
            { path: 'test/example.test.js', type: 'blob', size: Buffer.byteLength(FILES['test/example.test.js']) },
        ],
    });
    getFileContent.mockImplementation(async (_owner, _repo, filePath) => ({
        path: filePath,
        content: FILES[filePath],
        size: Buffer.byteLength(FILES[filePath]),
    }));
}

beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoctor-workspace-service-'));
    previousEnvironment = Object.fromEntries([
        'TREATMENT_WORKSPACE_ROOT',
        'GITHUB_TOKEN',
        'OPENAI_API_KEY',
    ].map((name) => [name, process.env[name]]));
    process.env.TREATMENT_WORKSPACE_ROOT = path.join(tempRoot, 'workspaces');
    process.env.GITHUB_TOKEN = 'github-secret-for-test';
    process.env.OPENAI_API_KEY = 'llm-secret-for-test';

    originalFetch = global.fetch;
    global.fetch = jest.fn();
    processSpies = PROCESS_METHODS.map((method) => jest.spyOn(childProcess, method));
    jest.clearAllMocks();
    configureGithub();
});

afterEach(() => {
    for (const spy of processSpies) spy.mockRestore();
    if (originalFetch === undefined) delete global.fetch;
    else global.fetch = originalFetch;
    for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('workspaceService', () => {
    test('creates a generated workspace beneath the configured root with only required files', async () => {
        const result = await createWorkspace(request());
        const workspaceRoot = fs.realpathSync(process.env.TREATMENT_WORKSPACE_ROOT);

        expect(result).toEqual({
            workspaceId: expect.stringMatching(/^repodoctor-/),
            repository: {
                owner: 'Scanned-Owner',
                repo: 'Demo-Project',
                defaultBranch: 'release/workspace-test',
            },
            materializedFiles: ['package.json', 'src/index.js'],
        });
        expect(await runInWorkspace(result.workspaceId, (workspacePath) => {
            expect(path.dirname(workspacePath)).toBe(workspaceRoot);
            expect(fs.readFileSync(path.join(workspacePath, 'src', 'index.js'), 'utf8')).toBe(FILES['src/index.js']);
            expect(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf8')).toBe(FILES['package.json']);
            expect(fs.existsSync(path.join(workspacePath, 'README.md'))).toBe(false);
            expect(fs.existsSync(path.join(workspacePath, 'test', 'example.test.js'))).toBe(false);
            return true;
        })).toBe(true);
    });

    test('uses the scanned repository identity and branch while validating public metadata', async () => {
        const result = await createWorkspace(request());

        expect(getRepoInfo).toHaveBeenCalledWith('scanned-owner', 'demo-project');
        expect(getRepoTree).toHaveBeenCalledWith('scanned-owner', 'demo-project', 'release/workspace-test');
        expect(getFileContent).toHaveBeenCalledWith(
            'scanned-owner', 'demo-project', 'package.json', 'release/workspace-test'
        );
        expect(getFileContent).toHaveBeenCalledWith(
            'scanned-owner', 'demo-project', 'src/index.js', 'release/workspace-test'
        );
        await cleanupWorkspace(result.workspaceId);
    });

    test('rejects private repositories', async () => {
        getRepoInfo.mockResolvedValue({
            owner: 'scanned-owner', repo: 'demo-project', defaultBranch: 'main', isPrivate: true,
        });

        await expect(createWorkspace(request())).rejects.toMatchObject({ code: 'REPO_PRIVATE', httpStatus: 403 });
        expect(getRepoTree).not.toHaveBeenCalled();
        expect(fs.existsSync(process.env.TREATMENT_WORKSPACE_ROOT)).toBe(false);
    });

    test.each([
        ['../outside.js'],
        ['src/../outside.js'],
        ['/outside.js'],
        ['C:\\outside.js'],
        ['\\\\server\\share\\outside.js'],
    ])('rejects unsafe approved path %s before contacting GitHub', async (affectedPath) => {
        await expect(createWorkspace(request({
            prescription: { approved: true, affectedPaths: [affectedPath] },
        }))).rejects.toMatchObject({ code: 'UNSAFE_PATH' });

        expect(getRepoInfo).not.toHaveBeenCalled();
    });

    test('rejects client-supplied workspace paths instead of accepting filesystem locations', async () => {
        await expect(createWorkspace({
            ...request(),
            workspacePath: path.join(tempRoot, 'client-selected'),
        })).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_REQUEST' });

        expect(fs.existsSync(path.join(tempRoot, 'client-selected'))).toBe(false);
    });

    test('rejects missing scan identity and unapproved prescriptions', async () => {
        await expect(createWorkspace(request({ scanResult: { scanId: 'scan-result-123' } })))
            .rejects.toMatchObject({ code: 'INVALID_WORKSPACE_REQUEST' });
        await expect(createWorkspace(request({ prescription: { approved: false, affectedPaths: ['src/index.js'] } })))
            .rejects.toMatchObject({ code: 'INVALID_WORKSPACE_REQUEST' });

        expect(getRepoInfo).not.toHaveBeenCalled();
    });

    test('rejects a workspace root that is a file', async () => {
        const rootFile = path.join(tempRoot, 'not-a-directory');
        fs.writeFileSync(rootFile, 'keep');
        process.env.TREATMENT_WORKSPACE_ROOT = rootFile;

        await expect(createWorkspace(request())).rejects.toMatchObject({ code: 'WORKSPACE_ROOT_INVALID' });
        expect(fs.readFileSync(rootFile, 'utf8')).toBe('keep');
    });

    test('rejects incomplete trees and approved files absent from the scanned repository', async () => {
        getRepoTree.mockResolvedValueOnce({ truncated: true, tree: [] });
        await expect(createWorkspace(request())).rejects.toMatchObject({ code: 'REPOSITORY_TREE_UNAVAILABLE' });

        getRepoTree.mockResolvedValueOnce({ truncated: false, tree: [] });
        await expect(createWorkspace(request())).rejects.toMatchObject({ code: 'WORKSPACE_FILE_NOT_FOUND' });
        expect(fs.existsSync(process.env.TREATMENT_WORKSPACE_ROOT)).toBe(false);
    });

    test('propagates GitHub AppErrors without leaving a workspace behind', async () => {
        getRepoTree.mockRejectedValueOnce(new AppError('GITHUB_UNAVAILABLE', 502, 'GitHub is unavailable.'));

        await expect(createWorkspace(request())).rejects.toMatchObject({ code: 'GITHUB_UNAVAILABLE' });
        expect(fs.existsSync(process.env.TREATMENT_WORKSPACE_ROOT)).toBe(false);
    });

    test('fails when a required file cannot be read from GitHub', async () => {
        getFileContent.mockResolvedValueOnce(null);

        await expect(createWorkspace(request())).rejects.toMatchObject({ code: 'WORKSPACE_FILE_UNAVAILABLE' });
        expect(fs.existsSync(process.env.TREATMENT_WORKSPACE_ROOT)).toBe(false);
    });

    test('runs existing backend work inside the generated workspace and cleans it up', async () => {
        const result = await createWorkspace(request());
        const cleanup = await cleanupWorkspace(result.workspaceId);

        expect(cleanup).toEqual({ workspaceId: result.workspaceId, removed: true });
        await expect(runInWorkspace(result.workspaceId, () => null)).rejects.toMatchObject({
            code: 'WORKSPACE_NOT_FOUND',
        });
    });

    test('rejects cleanup identifiers that could escape the configured root', async () => {
        const outsideDir = path.join(tempRoot, 'outside');
        const marker = path.join(outsideDir, 'keep.txt');
        fs.mkdirSync(outsideDir);
        fs.writeFileSync(marker, 'must remain');

        await expect(cleanupWorkspace('../outside')).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_ID' });
        await expect(cleanupWorkspace(outsideDir)).rejects.toMatchObject({ code: 'INVALID_WORKSPACE_ID' });
        expect(fs.readFileSync(marker, 'utf8')).toBe('must remain');
    });

    test('refuses a generated workspace redirected outside its root', async () => {
        const result = await createWorkspace(request());
        const workspacePath = path.join(process.env.TREATMENT_WORKSPACE_ROOT, result.workspaceId);
        const outsideDir = path.join(tempRoot, 'outside-redirect');
        const marker = path.join(outsideDir, 'keep.txt');
        fs.mkdirSync(outsideDir);
        fs.writeFileSync(marker, 'must remain');
        fs.rmSync(workspacePath, { recursive: true, force: true });

        try {
            fs.symlinkSync(outsideDir, workspacePath, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
            if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return;
            throw error;
        }

        await expect(cleanupWorkspace(result.workspaceId)).rejects.toMatchObject({ code: 'UNSAFE_WORKSPACE_PATH' });
        expect(fs.readFileSync(marker, 'utf8')).toBe('must remain');
    });

    test('uses a controlled temporary fallback when no root is configured', async () => {
        delete process.env.TREATMENT_WORKSPACE_ROOT;
        const tmpdirSpy = jest.spyOn(os, 'tmpdir').mockReturnValue(tempRoot);

        const result = await createWorkspace(request());
        const expectedRoot = path.join(tempRoot, 'repodoctor-workspaces');
        expect(await runInWorkspace(result.workspaceId, (workspacePath) => path.dirname(workspacePath)))
            .toBe(fs.realpathSync(expectedRoot));
        await cleanupWorkspace(result.workspaceId);
        tmpdirSpy.mockRestore();
    });

    test('returns no absolute paths, contents, credentials, or execution side effects', async () => {
        const result = await createWorkspace(request());
        const serialized = JSON.stringify(result);

        expect(serialized).not.toContain(tempRoot);
        expect(serialized).not.toContain('private source sentinel');
        expect(serialized).not.toContain('github-secret-for-test');
        expect(serialized).not.toContain('llm-secret-for-test');
        expect(global.fetch).not.toHaveBeenCalled();
        for (const spy of processSpies) expect(spy).not.toHaveBeenCalled();

        await cleanupWorkspace(result.workspaceId);
    });
});