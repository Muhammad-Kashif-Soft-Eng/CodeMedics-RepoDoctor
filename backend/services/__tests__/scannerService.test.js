'use strict';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../githubClient');
jest.mock('../classifyTree');
jest.mock('../analyzeContent');
jest.mock('../scoreHealth');
jest.mock('../../models/ScanResult');

const { getRepoTree, getFileContent, MAX_CONTENT_BYTES } = require('../githubClient');
const classifyTree           = require('../classifyTree');
const { analyzeContent }     = require('../analyzeContent');
const scoreHealth            = require('../scoreHealth');
const ScanResult             = require('../../models/ScanResult');
const { runScan }            = require('../scannerService');
const AppError               = require('../AppError');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REPO_INFO = {
  owner: 'acme', repo: 'my-repo', defaultBranch: 'main',
  repoUrl: 'https://github.com/acme/my-repo',
  description: 'A test repo', language: 'JavaScript', stars: 5, isPrivate: false,
};

const TREE_RESULT = {
  truncated: false,
  tree: [
    { path: 'README.md',    type: 'blob', size: 800 },
    { path: 'package.json', type: 'blob', size: 500 },
    { path: 'src/index.js', type: 'blob', size: 1200 },
    { path: 'src',          type: 'tree' },
  ],
};

const CLASSIFICATION = {
  truncated: false,
  structure: {
    totalFiles: 3, totalDirectories: 1, sourceFileCount: 1,
    testFileCount: 0, docFileCount: 1, configFileCount: 0,
    hasPackageJson: true, hasReadme: true, hasTests: false,
  },
  testingSignals: { testFileCount: 0, testFilePaths: [], testDirPaths: [] },
  docSignals: {
    readmePaths: ['README.md'],
    docFilePaths: ['README.md'],
    docFileCount: 1,
  },
  dependencySignals: {
    hasPackageJson: true,
    manifestPaths: ['package.json'],
  },
};

const FETCHED_FILES = [
  { path: 'README.md',    content: '# My Repo\n\nA repo.', size: 800 },
  { path: 'package.json', content: '{"name":"my-repo","scripts":{"test":"jest"}}', size: 500 },
  { path: 'src/index.js', content: 'console.log("hello"); // TODO: implement', size: 1200 },
];

const CONTENT_RESULT = {
  qualitySignals: {
    todoCount: 1, fixmeCount: 0, largeFileCount: 0,
    largeFilePaths: [], analyzedFileCount: 2, skippedFilePaths: [],
  },
  docSignals: {
    readmePresent: true, readmeNonEmpty: true, readmeCharCount: 22,
  },
  dependencySignals: {
    packageJsonValid: true, hasDependencies: false, hasDevDependencies: false,
    scripts: ['test'], hasTestScript: true,
  },
};

const HEALTH_SCORE = {
  testing: 0, documentation: 70, structure: 65,
  codeQuality: 95, dependencies: 55, overall: 52,
};

const SAVED_RECORD = {
  _id: 'saved-id-abc',
  owner: 'acme', repo: 'my-repo', defaultBranch: 'main',
  repoUrl: 'https://github.com/acme/my-repo',
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();

  getRepoTree.mockResolvedValue(TREE_RESULT);
  classifyTree.mockReturnValue(CLASSIFICATION);
  getFileContent.mockImplementation(async (_o, _r, path) => {
    return FETCHED_FILES.find((f) => f.path === path) ?? null;
  });
  analyzeContent.mockReturnValue(CONTENT_RESULT);
  scoreHealth.mockReturnValue(HEALTH_SCORE);
  ScanResult.create.mockResolvedValue(SAVED_RECORD);
});

// ── Helper ────────────────────────────────────────────────────────────────────

function defaultRun() {
  return runScan(REPO_INFO);
}

// ── 1. Successful end-to-end orchestration ────────────────────────────────────

describe('scannerService.runScan — successful orchestration', () => {
  test('returns a result with scanId from the persisted record', async () => {
    const result = await defaultRun();
    expect(result.scanId).toBe('saved-id-abc');
  });

  test('result contains owner, repo, defaultBranch, repoUrl', async () => {
    const result = await defaultRun();
    expect(result.owner).toBe('acme');
    expect(result.repo).toBe('my-repo');
    expect(result.defaultBranch).toBe('main');
    expect(result.repoUrl).toBe('https://github.com/acme/my-repo');
  });

  test('result contains description, language, stars from repoInfo', async () => {
    const result = await defaultRun();
    expect(result.description).toBe('A test repo');
    expect(result.language).toBe('JavaScript');
    expect(result.stars).toBe(5);
  });

  test('result contains all five signal groups', async () => {
    const result = await defaultRun();
    expect(result.structure).toBeDefined();
    expect(result.testingSignals).toBeDefined();
    expect(result.docSignals).toBeDefined();
    expect(result.qualitySignals).toBeDefined();
    expect(result.dependencySignals).toBeDefined();
  });

  test('result contains healthScore', async () => {
    const result = await defaultRun();
    expect(result.healthScore).toEqual(HEALTH_SCORE);
  });
});

// ── 2. Correct service call order ─────────────────────────────────────────────

describe('scannerService.runScan — service call order', () => {
  test('getRepoTree is called with correct owner, repo, branch', async () => {
    await defaultRun();
    expect(getRepoTree).toHaveBeenCalledWith('acme', 'my-repo', 'main');
  });

  test('classifyTree receives the tree result', async () => {
    await defaultRun();
    expect(classifyTree).toHaveBeenCalledWith(TREE_RESULT);
  });

  test('analyzeContent is called after getFileContent', async () => {
    const callOrder = [];
    getFileContent.mockImplementation(async (_o, _r, path) => {
      callOrder.push('fetch:' + path);
      return FETCHED_FILES.find((f) => f.path === path) ?? null;
    });
    analyzeContent.mockImplementation((...args) => {
      callOrder.push('analyze');
      return CONTENT_RESULT;
    });

    await defaultRun();

    const analyzeIdx = callOrder.indexOf('analyze');
    const lastFetchIdx = callOrder.reduce(
      (max, v, i) => (v.startsWith('fetch:') ? i : max), -1
    );
    expect(analyzeIdx).toBeGreaterThan(lastFetchIdx);
  });

  test('scoreHealth is called after analyzeContent', async () => {
    const callOrder = [];
    analyzeContent.mockImplementation(() => { callOrder.push('analyze'); return CONTENT_RESULT; });
    scoreHealth.mockImplementation(() => { callOrder.push('score'); return HEALTH_SCORE; });

    await defaultRun();

    expect(callOrder).toEqual(['analyze', 'score']);
  });

  test('ScanResult.create is called after scoreHealth', async () => {
    const callOrder = [];
    scoreHealth.mockImplementation(() => { callOrder.push('score'); return HEALTH_SCORE; });
    ScanResult.create.mockImplementation(async () => { callOrder.push('persist'); return SAVED_RECORD; });

    await defaultRun();

    expect(callOrder).toEqual(['score', 'persist']);
  });
});

// ── 3. Correct combination of scanner signals ─────────────────────────────────

describe('scannerService.runScan — signal merging', () => {
  test('docSignals passed to scoreHealth merges classifyTree docFileCount with content signals', async () => {
    await defaultRun();

    const [scoreArg] = scoreHealth.mock.calls[0];
    // From classifyTree: docFileCount, readmePaths, docFilePaths
    expect(scoreArg.docSignals.docFileCount).toBe(1);
    // From analyzeContent: readmePresent, readmeNonEmpty, readmeCharCount
    expect(scoreArg.docSignals.readmePresent).toBe(true);
    expect(scoreArg.docSignals.readmeNonEmpty).toBe(true);
  });

  test('dependencySignals passed to scoreHealth merges hasPackageJson with packageJsonValid', async () => {
    await defaultRun();

    const [scoreArg] = scoreHealth.mock.calls[0];
    // From classifyTree
    expect(scoreArg.dependencySignals.hasPackageJson).toBe(true);
    expect(scoreArg.dependencySignals.manifestPaths).toEqual(['package.json']);
    // From analyzeContent
    expect(scoreArg.dependencySignals.packageJsonValid).toBe(true);
    expect(scoreArg.dependencySignals.hasTestScript).toBe(true);
  });

  test('structure and testingSignals from classifyTree are passed to scoreHealth unchanged', async () => {
    await defaultRun();

    const [scoreArg] = scoreHealth.mock.calls[0];
    expect(scoreArg.structure).toEqual(CLASSIFICATION.structure);
    expect(scoreArg.testingSignals).toEqual(CLASSIFICATION.testingSignals);
  });
});

// ── 4. scoreHealth receives the expected signals ───────────────────────────────

describe('scannerService.runScan — scoreHealth input', () => {
  test('scoreHealth is called exactly once', async () => {
    await defaultRun();
    expect(scoreHealth).toHaveBeenCalledTimes(1);
  });

  test('scoreHealth receives qualitySignals from analyzeContent', async () => {
    await defaultRun();
    const [scoreArg] = scoreHealth.mock.calls[0];
    expect(scoreArg.qualitySignals).toEqual(CONTENT_RESULT.qualitySignals);
  });
});

// ── 5. ScanResult receives the calculated health score ─────────────────────────

describe('scannerService.runScan — persistence', () => {
  test('ScanResult.create is called with the healthScore from scoreHealth', async () => {
    await defaultRun();
    const [createArg] = ScanResult.create.mock.calls[0];
    expect(createArg.healthScore).toEqual(HEALTH_SCORE);
  });

  test('ScanResult.create is called with all signal fields', async () => {
    await defaultRun();
    const [createArg] = ScanResult.create.mock.calls[0];
    expect(createArg.structure).toBeDefined();
    expect(createArg.testingSignals).toBeDefined();
    expect(createArg.docSignals).toBeDefined();
    expect(createArg.qualitySignals).toBeDefined();
    expect(createArg.dependencySignals).toBeDefined();
  });

  test('ScanResult.create is called with owner, repo, defaultBranch, repoUrl', async () => {
    await defaultRun();
    const [createArg] = ScanResult.create.mock.calls[0];
    expect(createArg.owner).toBe('acme');
    expect(createArg.repo).toBe('my-repo');
    expect(createArg.defaultBranch).toBe('main');
    expect(createArg.repoUrl).toBe('https://github.com/acme/my-repo');
  });
});

// ── 7. Truncated tree is preserved ────────────────────────────────────────────

describe('scannerService.runScan — truncated tree', () => {
  test('result.truncated is true when the tree is truncated', async () => {
    getRepoTree.mockResolvedValue({ ...TREE_RESULT, truncated: true });
    classifyTree.mockReturnValue({ ...CLASSIFICATION, truncated: true });

    const result = await defaultRun();
    expect(result.truncated).toBe(true);
  });

  test('result.truncated is false for a normal tree', async () => {
    const result = await defaultRun();
    expect(result.truncated).toBe(false);
  });
});

// ── 8. File-content retrieval failure is handled gracefully ───────────────────

describe('scannerService.runScan — file fetch failures', () => {
  test('scan still completes when getFileContent returns null (binary/oversized)', async () => {
    getFileContent.mockResolvedValue(null);

    const result = await defaultRun();

    expect(result.scanId).toBe('saved-id-abc');
    expect(analyzeContent).toHaveBeenCalledTimes(1);
  });

  test('scan still completes when getFileContent throws for individual files', async () => {
    getFileContent.mockRejectedValue(new Error('network error on this file'));

    const result = await defaultRun();

    expect(result.scanId).toBe('saved-id-abc');
    // analyzeContent should still have been called (with empty fetchedFiles)
    expect(analyzeContent).toHaveBeenCalledTimes(1);
  });

  test('skipped paths are passed to analyzeContent', async () => {
    // Simulate one file returning null (skipped)
    getFileContent.mockImplementation(async (_o, _r, path) => {
      if (path === 'src/index.js') return null;
      return FETCHED_FILES.find((f) => f.path === path) ?? null;
    });

    await defaultRun();

    const [, , skippedArg] = analyzeContent.mock.calls[0];
    expect(skippedArg).toContain('src/index.js');
  });
});

// ── 9. GitHub failure (tree fetch) is propagated ──────────────────────────────

describe('scannerService.runScan — GitHub failures', () => {
  test('AppError from getRepoTree is re-thrown', async () => {
    getRepoTree.mockRejectedValue(
      new AppError('GITHUB_RATE_LIMITED', 429, 'Rate limit hit.')
    );

    await expect(defaultRun()).rejects.toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
      httpStatus: 429,
    });
  });

  test('AppError from ScanResult.create is re-thrown', async () => {
    ScanResult.create.mockRejectedValue(new Error('MongoDB write error'));

    await expect(defaultRun()).rejects.toThrow('MongoDB write error');
  });
});
