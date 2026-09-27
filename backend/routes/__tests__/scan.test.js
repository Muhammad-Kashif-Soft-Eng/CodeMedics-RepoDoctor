'use strict';

const request = require('supertest');

// ── Module mocks (declared before any require of app) ─────────────────────────
// Jest hoists jest.mock() calls, so these run before the modules are loaded.

jest.mock('../../services/parseRepoUrl');
jest.mock('../../services/githubClient');
jest.mock('../../services/scannerService');

const parseRepoUrl          = require('../../services/parseRepoUrl');
const { getRepoInfo }       = require('../../services/githubClient');
const { runScan }           = require('../../services/scannerService');
const AppError              = require('../../services/AppError');
const app                   = require('../../app');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const VALID_URL = 'https://github.com/acme/my-repo';
const PARSED    = { owner: 'acme', repo: 'my-repo' };

const REPO_INFO = {
  owner:         'acme',
  repo:          'my-repo',
  defaultBranch: 'main',
  description:   'A test repo',
  language:      'JavaScript',
  stars:         42,
  isPrivate:     false,
};

const HEALTH_SCORE = {
  testing: 70, documentation: 80, structure: 90,
  codeQuality: 100, dependencies: 85, overall: 85,
};

const SCAN_RESULT = {
  scanId:        'mock-scan-id-123',
  owner:         'acme',
  repo:          'my-repo',
  defaultBranch: 'main',
  repoUrl:       VALID_URL,
  description:   'A test repo',
  language:      'JavaScript',
  stars:         42,
  truncated:     false,
  structure: {
    totalFiles: 20, totalDirectories: 5, sourceFileCount: 10,
    testFileCount: 4, docFileCount: 3, configFileCount: 2,
    hasPackageJson: true, hasReadme: true, hasTests: true,
  },
  testingSignals:    { testFileCount: 4, testFilePaths: [], testDirPaths: [] },
  docSignals: {
    readmePaths: ['README.md'], docFilePaths: ['README.md'],
    docFileCount: 3, readmePresent: true, readmeNonEmpty: true, readmeCharCount: 650,
  },
  qualitySignals: {
    todoCount: 2, fixmeCount: 0, largeFileCount: 0,
    largeFilePaths: [], analyzedFileCount: 10, skippedFilePaths: [],
  },
  dependencySignals: {
    hasPackageJson: true, manifestPaths: ['package.json'],
    packageJsonValid: true, hasDependencies: true, hasDevDependencies: true,
    scripts: ['test', 'start', 'build'], hasTestScript: true,
  },
  healthScore: HEALTH_SCORE,
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Helper ────────────────────────────────────────────────────────────────────

function postScan(body) {
  return request(app).post('/api/scan').send(body);
}

// ── 1. Successful end-to-end scan orchestration ───────────────────────────────

describe('POST /api/scan — successful scan', () => {
  beforeEach(() => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockResolvedValue(SCAN_RESULT);
  });

  test('returns HTTP 200', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(200);
  });

  // ── 6. Successful response contains the expected fields ────────────────────

  test('response contains scanId', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.scanId).toBe('mock-scan-id-123');
  });

  test('response contains owner', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.owner).toBe('acme');
  });

  test('response contains repo', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.repo).toBe('my-repo');
  });

  test('response contains defaultBranch', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.defaultBranch).toBe('main');
  });

  test('response contains repoUrl', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.repoUrl).toBe(VALID_URL);
  });

  test('response contains healthScore with all six fields', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    const hs = res.body.healthScore;
    expect(hs).toBeDefined();
    expect(typeof hs.testing).toBe('number');
    expect(typeof hs.documentation).toBe('number');
    expect(typeof hs.structure).toBe('number');
    expect(typeof hs.codeQuality).toBe('number');
    expect(typeof hs.dependencies).toBe('number');
    expect(typeof hs.overall).toBe('number');
  });

  test('response contains structure signals', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.structure).toBeDefined();
    expect(res.body.structure.totalFiles).toBe(20);
  });

  test('response contains testingSignals', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.testingSignals).toBeDefined();
  });

  test('response contains docSignals', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.docSignals).toBeDefined();
  });

  test('response contains qualitySignals', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.qualitySignals).toBeDefined();
  });

  test('response contains dependencySignals', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.dependencySignals).toBeDefined();
  });
});

// ── 2. Correct service order ───────────────────────────────────────────────────

describe('POST /api/scan — service call order', () => {
  test('parseRepoUrl is called before getRepoInfo', async () => {
    const callOrder = [];
    parseRepoUrl.mockImplementation(() => { callOrder.push('parse'); return PARSED; });
    getRepoInfo.mockImplementation(async () => { callOrder.push('repoInfo'); return REPO_INFO; });
    runScan.mockResolvedValue(SCAN_RESULT);

    await postScan({ repoUrl: VALID_URL });

    expect(callOrder).toEqual(['parse', 'repoInfo']);
  });

  test('getRepoInfo is called before runScan', async () => {
    const callOrder = [];
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockImplementation(async () => { callOrder.push('repoInfo'); return REPO_INFO; });
    runScan.mockImplementation(async () => { callOrder.push('runScan'); return SCAN_RESULT; });

    await postScan({ repoUrl: VALID_URL });

    expect(callOrder).toEqual(['repoInfo', 'runScan']);
  });

  test('runScan is not called when getRepoInfo throws', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(new AppError('REPO_NOT_FOUND', 404, 'Not found.'));
    runScan.mockResolvedValue(SCAN_RESULT);

    await postScan({ repoUrl: VALID_URL });

    expect(runScan).not.toHaveBeenCalled();
  });
});

// ── 3. Correct combination of scanner signals ──────────────────────────────────

describe('POST /api/scan — signal combination', () => {
  test('runScan receives repoInfo plus repoUrl from the request', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockResolvedValue(SCAN_RESULT);

    await postScan({ repoUrl: VALID_URL });

    const [arg] = runScan.mock.calls[0];
    expect(arg.owner).toBe('acme');
    expect(arg.repo).toBe('my-repo');
    expect(arg.defaultBranch).toBe('main');
    expect(arg.repoUrl).toBe(VALID_URL);
  });

  test('response reflects the merged signals returned by runScan', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockResolvedValue(SCAN_RESULT);

    const res = await postScan({ repoUrl: VALID_URL });

    expect(res.body.docSignals.readmePresent).toBe(true);
    expect(res.body.docSignals.docFileCount).toBe(3);
    expect(res.body.dependencySignals.hasPackageJson).toBe(true);
    expect(res.body.dependencySignals.packageJsonValid).toBe(true);
  });
});

// ── 4. scoreHealth receives the expected signals ───────────────────────────────
// Tested via scannerService integration tests; here we verify the route passes
// through the healthScore that runScan returns without modification.

describe('POST /api/scan — healthScore passthrough', () => {
  test('route passes through healthScore exactly as returned by runScan', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockResolvedValue(SCAN_RESULT);

    const res = await postScan({ repoUrl: VALID_URL });

    expect(res.body.healthScore).toEqual(HEALTH_SCORE);
  });
});

// ── 5. ScanResult receives the calculated health score ─────────────────────────
// Persistence is the responsibility of scannerService; the route test verifies
// the response contains the persisted scanId returned by runScan.

describe('POST /api/scan — persistence confirmation', () => {
  test('response scanId matches the value returned by runScan', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockResolvedValue({ ...SCAN_RESULT, scanId: 'persisted-id-456' });

    const res = await postScan({ repoUrl: VALID_URL });

    expect(res.body.scanId).toBe('persisted-id-456');
  });
});

// ── 7. Truncated repository information is preserved ──────────────────────────

describe('POST /api/scan — truncated tree', () => {
  test('truncated flag is present and true when runScan returns it as true', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockResolvedValue({ ...SCAN_RESULT, truncated: true });

    const res = await postScan({ repoUrl: VALID_URL });

    expect(res.body.truncated).toBe(true);
  });

  test('truncated flag is false for a normal (non-truncated) scan', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockResolvedValue({ ...SCAN_RESULT, truncated: false });

    const res = await postScan({ repoUrl: VALID_URL });

    expect(res.body.truncated).toBe(false);
  });
});

// ── 8. File-content retrieval failure is handled correctly ─────────────────────
// When individual file fetches fail, runScan records them as skipped paths.
// The route must still return 200 with a valid (possibly degraded) scan result.

describe('POST /api/scan — partial content retrieval', () => {
  test('scan still succeeds and returns 200 when some files are skipped', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    const degradedResult = {
      ...SCAN_RESULT,
      qualitySignals: {
        ...SCAN_RESULT.qualitySignals,
        skippedFilePaths: ['src/big-file.js', 'src/other.js'],
        analyzedFileCount: 8,
      },
    };
    runScan.mockResolvedValue(degradedResult);

    const res = await postScan({ repoUrl: VALID_URL });

    expect(res.status).toBe(200);
    expect(res.body.qualitySignals.skippedFilePaths).toEqual(
      ['src/big-file.js', 'src/other.js']
    );
  });
});

// ── 9. GitHub failure is propagated correctly ─────────────────────────────────

describe('POST /api/scan — MISSING_URL', () => {
  test('returns 400 MISSING_URL when repoUrl is absent', async () => {
    parseRepoUrl.mockImplementation(() => {
      throw new AppError('MISSING_URL', 400, 'A repository URL is required.');
    });
    const res = await postScan({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_URL');
    expect(typeof res.body.error.message).toBe('string');
  });

  test('returns 400 MISSING_URL when repoUrl is empty string', async () => {
    parseRepoUrl.mockImplementation(() => {
      throw new AppError('MISSING_URL', 400, 'A repository URL is required.');
    });
    const res = await postScan({ repoUrl: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_URL');
  });
});

describe('POST /api/scan — INVALID_URL', () => {
  test('returns 400 INVALID_URL for a non-GitHub URL', async () => {
    parseRepoUrl.mockImplementation(() => {
      throw new AppError('INVALID_URL', 400, 'Only GitHub repositories are supported.');
    });
    const res = await postScan({ repoUrl: 'https://gitlab.com/owner/repo' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });
});

describe('POST /api/scan — REPO_NOT_FOUND', () => {
  test('returns 404 REPO_NOT_FOUND when GitHub returns 404', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(
      new AppError('REPO_NOT_FOUND', 404, 'Repository was not found.')
    );
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REPO_NOT_FOUND');
  });
});

describe('POST /api/scan — REPO_PRIVATE', () => {
  test('returns 403 REPO_PRIVATE for a private repository', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(
      new AppError('REPO_PRIVATE', 403, 'Access was denied.')
    );
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REPO_PRIVATE');
  });
});

describe('POST /api/scan — GITHUB_RATE_LIMITED', () => {
  test('returns 429 GITHUB_RATE_LIMITED when rate limited', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(
      new AppError('GITHUB_RATE_LIMITED', 429, 'Rate limit reached.')
    );
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('GITHUB_RATE_LIMITED');
  });
});

describe('POST /api/scan — GITHUB_UNAVAILABLE', () => {
  test('returns 502 GITHUB_UNAVAILABLE on network failure', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(
      new AppError('GITHUB_UNAVAILABLE', 502, 'Could not reach GitHub.')
    );
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GITHUB_UNAVAILABLE');
  });
});

describe('POST /api/scan — runScan GitHub failure propagation', () => {
  test('AppError thrown inside runScan propagates to the correct HTTP status', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockRejectedValue(
      new AppError('GITHUB_RATE_LIMITED', 429, 'Rate limit hit during tree fetch.')
    );
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('GITHUB_RATE_LIMITED');
  });
});

// ── 10. Unexpected failure returns the existing INTERNAL_ERROR contract ─────────

describe('POST /api/scan — INTERNAL_ERROR', () => {
  test('returns 500 INTERNAL_ERROR for an unexpected exception in getRepoInfo', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(new Error('Something exploded'));
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  test('returns 500 INTERNAL_ERROR for an unexpected exception in runScan', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    runScan.mockRejectedValue(new Error('DB write failed'));
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  test('does not leak internal error details in the response message', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(new Error('db connection string = secret'));
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.error.message).not.toContain('db connection string');
  });
});

// ── Error response shape ──────────────────────────────────────────────────────

describe('POST /api/scan — error response shape', () => {
  test('all AppError responses have { error: { code, message } } shape', async () => {
    const errorCases = [
      new AppError('MISSING_URL',         400, 'msg'),
      new AppError('INVALID_URL',         400, 'msg'),
      new AppError('REPO_NOT_FOUND',      404, 'msg'),
      new AppError('REPO_PRIVATE',        403, 'msg'),
      new AppError('GITHUB_RATE_LIMITED', 429, 'msg'),
      new AppError('GITHUB_UNAVAILABLE',  502, 'msg'),
    ];

    for (const appErr of errorCases) {
      parseRepoUrl.mockImplementation(() => { throw appErr; });
      const res = await postScan({ repoUrl: VALID_URL });
      expect(res.body).toHaveProperty('error.code', appErr.code);
      expect(res.body).toHaveProperty('error.message');
    }
  });
});
