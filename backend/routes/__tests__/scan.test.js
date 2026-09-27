'use strict';

const request = require('supertest');

// ── Module mocks (declared before any require of app) ─────────────────────────
// Jest hoists jest.mock() calls, so these run before the modules are loaded.

jest.mock('../../services/parseRepoUrl');
jest.mock('../../services/githubClient');
jest.mock('../../models/ScanResult');

const parseRepoUrl    = require('../../services/parseRepoUrl');
const { getRepoInfo } = require('../../services/githubClient');
const ScanResult      = require('../../models/ScanResult');
const AppError        = require('../../services/AppError');
const app             = require('../../app');

// ── Shared fixtures ───────────────────────────────────────────────────────────

const VALID_URL   = 'https://github.com/acme/my-repo';
const PARSED      = { owner: 'acme', repo: 'my-repo' };
const REPO_INFO   = {
  owner:         'acme',
  repo:          'my-repo',
  defaultBranch: 'main',
  description:   'A test repo',
  language:      'JavaScript',
  stars:         42,
  isPrivate:     false,
};
const SAVED_DOC = {
  _id:           'mock-scan-id-123',
  repoUrl:       VALID_URL,
  owner:         'acme',
  repo:          'my-repo',
  defaultBranch: 'main',
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  // Suppress expected console.error output from the INTERNAL_ERROR path
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Helper ────────────────────────────────────────────────────────────────────

function postScan(body) {
  return request(app).post('/api/scan').send(body);
}

// ── 1 & 9. Successful scan → 200 with required fields ────────────────────────
describe('POST /api/scan — success', () => {
  beforeEach(() => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    ScanResult.create.mockResolvedValue(SAVED_DOC);
  });

  test('returns HTTP 200', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(200);
  });

  test('response body contains scanId', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.scanId).toBe('mock-scan-id-123');
  });

  test('response body contains owner', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.owner).toBe('acme');
  });

  test('response body contains repo', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.repo).toBe('my-repo');
  });

  test('response body contains defaultBranch', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.defaultBranch).toBe('main');
  });

  test('response body contains repoUrl', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.body.repoUrl).toBe(VALID_URL);
  });

  test('response body contains exactly the five expected keys', async () => {
    const res = await postScan({ repoUrl: VALID_URL });
    expect(Object.keys(res.body).sort()).toEqual(
      ['defaultBranch', 'owner', 'repo', 'repoUrl', 'scanId']
    );
  });
});

// ── 10. ScanResult.create called with correct data ────────────────────────────
describe('POST /api/scan — persistence', () => {
  test('calls ScanResult.create with owner, repo, defaultBranch, repoUrl, and zeroed healthScore', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockResolvedValue(REPO_INFO);
    ScanResult.create.mockResolvedValue(SAVED_DOC);

    await postScan({ repoUrl: VALID_URL });

    expect(ScanResult.create).toHaveBeenCalledTimes(1);
    const [arg] = ScanResult.create.mock.calls[0];
    expect(arg.owner).toBe('acme');
    expect(arg.repo).toBe('my-repo');
    expect(arg.defaultBranch).toBe('main');
    expect(arg.repoUrl).toBe(VALID_URL);
    expect(arg.healthScore).toEqual({
      testing: 0, documentation: 0, structure: 0,
      codeQuality: 0, dependencies: 0, overall: 0,
    });
  });
});

// ── 2. Missing URL → 400 MISSING_URL ─────────────────────────────────────────
describe('POST /api/scan — MISSING_URL', () => {
  test('returns 400 with MISSING_URL when repoUrl is absent from body', async () => {
    parseRepoUrl.mockImplementation(() => {
      throw new AppError('MISSING_URL', 400, 'A repository URL is required.');
    });

    const res = await postScan({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_URL');
    expect(typeof res.body.error.message).toBe('string');
  });

  test('returns 400 with MISSING_URL when repoUrl is empty string', async () => {
    parseRepoUrl.mockImplementation(() => {
      throw new AppError('MISSING_URL', 400, 'A repository URL is required.');
    });

    const res = await postScan({ repoUrl: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_URL');
  });
});

// ── 3. Invalid URL → 400 INVALID_URL ─────────────────────────────────────────
describe('POST /api/scan — INVALID_URL', () => {
  test('returns 400 with INVALID_URL for a non-GitHub URL', async () => {
    parseRepoUrl.mockImplementation(() => {
      throw new AppError('INVALID_URL', 400, 'Only GitHub repositories are supported.');
    });

    const res = await postScan({ repoUrl: 'https://gitlab.com/owner/repo' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });
});

// ── 4. Repository not found → 404 REPO_NOT_FOUND ─────────────────────────────
describe('POST /api/scan — REPO_NOT_FOUND', () => {
  test('returns 404 with REPO_NOT_FOUND when GitHub returns 404', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(
      new AppError('REPO_NOT_FOUND', 404, 'Repository was not found.')
    );

    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REPO_NOT_FOUND');
  });
});

// ── 5. Private/restricted → 403 REPO_PRIVATE ─────────────────────────────────
describe('POST /api/scan — REPO_PRIVATE', () => {
  test('returns 403 with REPO_PRIVATE for a private repository', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(
      new AppError('REPO_PRIVATE', 403, 'Access was denied.')
    );

    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REPO_PRIVATE');
  });
});

// ── 6. GitHub rate limit → 429 GITHUB_RATE_LIMITED ───────────────────────────
describe('POST /api/scan — GITHUB_RATE_LIMITED', () => {
  test('returns 429 with GITHUB_RATE_LIMITED when rate limited', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(
      new AppError('GITHUB_RATE_LIMITED', 429, 'Rate limit reached.')
    );

    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('GITHUB_RATE_LIMITED');
  });
});

// ── 7. GitHub unavailable → 502 GITHUB_UNAVAILABLE ───────────────────────────
describe('POST /api/scan — GITHUB_UNAVAILABLE', () => {
  test('returns 502 with GITHUB_UNAVAILABLE on network failure', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(
      new AppError('GITHUB_UNAVAILABLE', 502, 'Could not reach GitHub.')
    );

    const res = await postScan({ repoUrl: VALID_URL });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GITHUB_UNAVAILABLE');
  });
});

// ── 8. Unexpected error → 500 INTERNAL_ERROR ─────────────────────────────────
describe('POST /api/scan — INTERNAL_ERROR', () => {
  test('returns 500 with INTERNAL_ERROR for an unexpected exception', async () => {
    parseRepoUrl.mockReturnValue(PARSED);
    getRepoInfo.mockRejectedValue(new Error('Something exploded'));

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
  test('all error responses have { error: { code, message } } shape', async () => {
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
