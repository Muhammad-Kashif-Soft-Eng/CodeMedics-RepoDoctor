'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

jest.mock('../githubClient', () => ({
    MAX_CONTENT_BYTES: 100 * 1024,
    getRepoTree: jest.fn(),
    getFileContent: jest.fn(),
}));
jest.mock('../../models/ScanResult', () => ({ create: jest.fn() }));

const { getRepoTree, getFileContent } = require('../githubClient');
const ScanResult = require('../../models/ScanResult');
const { runScan } = require('../scannerService');
const { applyTreatment } = require('../treatmentService');
const { verifyTreatment } = require('../verificationService');
const { compareBeforeAfter } = require('../beforeAfterService');

function readWorkspaceTree(workspaceDir) {
    const entries = [];
    const visit = (directory, relativeDirectory = '') => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const relativePath = relativeDirectory
                ? path.posix.join(relativeDirectory, entry.name)
                : entry.name;
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                entries.push({ path: relativePath, type: 'tree' });
                visit(absolutePath, relativePath);
            } else if (entry.isFile()) {
                entries.push({ path: relativePath, type: 'blob', size: fs.statSync(absolutePath).size });
            }
        }
    };
    visit(workspaceDir);
    return entries;
}

function providerResponse(changes) {
    return {
        ok: true,
        json: async () => ({
            choices: [{ message: { content: JSON.stringify({ changes }) } }],
        }),
    };
}

describe('treatment, verification, and before/after integration', () => {
    test('scans, applies an approved treatment, verifies it, and compares health', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoctor-treatment-flow-'));
        const workspaceDir = path.join(tempRoot, 'demo-project');
        fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true });

        const envNames = [
            'OPENAI_API_KEY',
            'OPENAI_MODEL',
            'TREATMENT_WORKSPACE_ROOT',
            'VERIFICATION_WORKSPACE_ROOT',
        ];
        const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

        try {
            process.env.OPENAI_API_KEY = 'integration-test-key';
            process.env.OPENAI_MODEL = 'integration-test-model';
            process.env.TREATMENT_WORKSPACE_ROOT = tempRoot;
            process.env.VERIFICATION_WORKSPACE_ROOT = tempRoot;

            fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({
                name: 'temporary-demo-project',
                version: '1.0.0',
                main: 'src/index.js',
            }, null, 2));
            fs.writeFileSync(
                path.join(workspaceDir, 'src', 'index.js'),
                '// TODO: replace placeholder\n// TODO: add input validation\n' +
                'function greet(name) { return `Hello, ${name}`; }\n' +
                'module.exports = { greet };\n'
            );

            getRepoTree.mockImplementation(async () => ({
                truncated: false,
                tree: readWorkspaceTree(workspaceDir),
            }));
            getFileContent.mockImplementation(async (_owner, _repo, relativePath) => {
                const absolutePath = path.join(workspaceDir, ...relativePath.split('/'));
                return {
                    path: relativePath,
                    content: fs.readFileSync(absolutePath, 'utf8'),
                    size: fs.statSync(absolutePath).size,
                };
            });
            ScanResult.create.mockImplementation(async (record) => ({
                _id: `temporary-scan-${ScanResult.create.mock.calls.length}`,
                owner: record.owner,
                repo: record.repo,
                defaultBranch: record.defaultBranch,
                repoUrl: record.repoUrl,
            }));

            const repoInfo = {
                owner: 'local',
                repo: 'temporary-demo-project',
                defaultBranch: 'main',
                repoUrl: 'https://example.invalid/local/temporary-demo-project',
                description: null,
                language: 'JavaScript',
                stars: 0,
                isPrivate: false,
            };
            const beforeScan = await runScan(repoInfo);

            const finding = {
                title: 'Remove TODO markers from the demo module',
                category: 'Code Quality',
                severity: 'Medium',
                evidence: 'The source module contains unfinished TODO markers.',
                affectedPath: 'src/index.js',
                explanation: 'Resolve the two outstanding implementation markers.',
            };
            const prescription = {
                title: 'Remove resolved TODO markers',
                reason: 'The demo implementation is complete.',
                expectedOutcome: 'The source module has no TODO markers.',
                affectedPaths: ['src/index.js'],
                treatmentSteps: ['Remove the two TODO comment lines.'],
                verificationPlan: 'Run the JavaScript syntax check.',
                approved: true,
            };
            const treatmentResult = await applyTreatment({
                finding,
                prescription,
                workspacePath: workspaceDir,
                scanResult: beforeScan,
                options: {
                    fetchImpl: jest.fn().mockResolvedValue(providerResponse([{
                        path: 'src/index.js',
                        content: 'function greet(name) { return `Hello, ${name}`; }\n' +
                            'module.exports = { greet };\n',
                    }])),
                },
            });

            const verificationResult = await verifyTreatment({
                workspacePath: workspaceDir,
                changedFiles: treatmentResult.changedFiles,
                treatmentResult,
                projectInfo: { language: 'JavaScript', hasPackageJson: true },
            });
            const afterScan = await runScan(repoInfo);
            const comparison = compareBeforeAfter({
                beforeHealthResult: beforeScan,
                afterHealthResult: afterScan,
                treatmentResult,
                verificationResult,
            });

            expect(treatmentResult.status).toBe('applied');
            expect(treatmentResult.changedFiles).toEqual(['src/index.js']);
            expect(fs.readFileSync(path.join(workspaceDir, 'src', 'index.js'), 'utf8')).not.toContain('TODO');
            expect(verificationResult.status).toBe('passed');
            expect(verificationResult.checksRun).toEqual(['node --check src/index.js']);
            expect(comparison.changedFiles).toEqual(['src/index.js']);
            expect(comparison.beforeScore).toBe(beforeScan.healthScore.overall);
            expect(comparison.afterScore).toBe(afterScan.healthScore.overall);
            expect(comparison.scoreDelta).toBe(afterScan.healthScore.overall - beforeScan.healthScore.overall);
            expect(comparison.scoreDelta).toBe(2);
            expect(comparison.improved).toBe(comparison.scoreDelta > 0 && verificationResult.status === 'passed');
            expect(comparison.improved).toBe(true);
        } finally {
            for (const [name, value] of Object.entries(previousEnv)) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });
});