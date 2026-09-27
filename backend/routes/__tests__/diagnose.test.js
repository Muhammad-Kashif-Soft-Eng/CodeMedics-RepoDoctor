'use strict';

const request = require('supertest');

// ── Module mocks (hoisted before any require of app) ─────────────────────────

jest.mock('../../services/diagnosisService');

const { diagnoseRepository } = require('../../services/diagnosisService');
const AppError = require('../../services/AppError');
const app = require('../../app');

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal valid scan-result payload (mirrors POST /api/scan response shape). */
const VALID_SCAN = {
  scanId: 'scan-abc-123',
  owner: 'acme',
  repo: 'my-repo',
  defaultBranch: 'main',
  repoUrl: 'https://github.com/acme/my-repo',
  truncated: false,
  structure: {
    totalFiles: 20, totalDirectories: 5, sourceFileCount: 10,
    testFileCount: 4, docFileCount: 3, configFileCount: 2,
    hasPackageJson: true, hasReadme: true, hasTests: true,
  },
  testingSignals: { testFileCount: 4, testFilePaths: ['tests/foo.test.js'], testDirPaths: [] },
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
  healthScore: {
    testing: 70, documentation: 80, structure: 90,
    codeQuality: 100, dependencies: 85, overall: 85,
  },
};

/** One well-formed finding. */
const FINDING = {
  title: 'No unit tests for core logic',
  category: 'Testing',
  severity: 'High',
  evidence: 'testFileCount is 4 out of 10 source files (ratio 0.4).',
  affectedPath: null,
  explanation: 'Low test coverage leaves core logic unverified.',
};

/** Five distinct findings (maximum allowed). */
const FIVE_FINDINGS = Array.from({ length: 5 }, (_, i) => ({
  ...FINDING,
  title: `Finding ${i + 1}`,
}));
const SIX_FINDINGS = Array.from({ length: 6 }, (_, i) => ({
  ...FINDING,
  title: `Finding ${i + 1}`,
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Helper ────────────────────────────────────────────────────────────────────

function postDiagnose(body) {
  return request(app).post('/api/diagnose').send(body);
}

// ── 1. Successful diagnosis ───────────────────────────────────────────────────

describe('POST /api/diagnose — successful diagnosis', () => {
  beforeEach(() => {
    diagnoseRepository.mockResolvedValue([FINDING]);
  });

  test('returns HTTP 200', async () => {
    const res = await postDiagnose(VALID_SCAN);
    expect(res.status).toBe(200);
  });

  test('calls diagnoseRepository with the request body', async () => {
    await postDiagnose(VALID_SCAN);
    expect(diagnoseRepository).toHaveBeenCalledTimes(1);
    const [arg] = diagnoseRepository.mock.calls[0];
    expect(arg.scanId).toBe('scan-abc-123');
    expect(arg.owner).toBe('acme');
  });

  test('diagnoseRepository is called exactly once per request', async () => {
    await postDiagnose(VALID_SCAN);
    expect(diagnoseRepository).toHaveBeenCalledTimes(1);
  });
});

// ── 6. Successful response shape ──────────────────────────────────────────────

describe('POST /api/diagnose — response shape', () => {
  beforeEach(() => {
    diagnoseRepository.mockResolvedValue([FINDING]);
  });

  test('response contains scanId', async () => {
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body.scanId).toBe('scan-abc-123');
  });

  test('response contains owner', async () => {
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body.owner).toBe('acme');
  });

  test('response contains repo', async () => {
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body.repo).toBe('my-repo');
  });

  test('response contains the default branch', async () => {
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body.defaultBranch).toBe('main');
  });

  test('response contains a findings array', async () => {
    const res = await postDiagnose(VALID_SCAN);
    expect(Array.isArray(res.body.findings)).toBe(true);
  });

  test('finding shape contains all required fields', async () => {
    const res = await postDiagnose(VALID_SCAN);
    const finding = res.body.findings[0];
    expect(finding).toHaveProperty('title');
    expect(finding).toHaveProperty('category');
    expect(finding).toHaveProperty('severity');
    expect(finding).toHaveProperty('evidence');
    expect(finding).toHaveProperty('affectedPath');
    expect(finding).toHaveProperty('explanation');
  });

  test('scanId is null when not present in body', async () => {
    const { scanId: _s, ...withoutId } = VALID_SCAN;
    const res = await postDiagnose(withoutId);
    expect(res.body.scanId).toBeNull();
  });

  test('owner and repo are null when not present in body', async () => {
    const { owner: _o, repo: _r, ...minimal } = VALID_SCAN;
    const res = await postDiagnose(minimal);
    expect(res.body.owner).toBeNull();
    expect(res.body.repo).toBeNull();
  });
});

// ── 7. Maximum finding count ──────────────────────────────────────────────────

describe('POST /api/diagnose — finding count', () => {
  test('returns no more than five findings when diagnoseRepository returns more', async () => {
    diagnoseRepository.mockResolvedValue(SIX_FINDINGS);
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body.findings).toHaveLength(5);
    expect(res.body.findings[4].title).toBe('Finding 5');
  });

  test('returns zero findings when diagnoseRepository returns empty array', async () => {
    diagnoseRepository.mockResolvedValue([]);
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body.findings).toHaveLength(0);
  });

  test('returns one finding when diagnoseRepository returns one', async () => {
    diagnoseRepository.mockResolvedValue([FINDING]);
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body.findings).toHaveLength(1);
  });
});

// ── 2. Missing input ──────────────────────────────────────────────────────────

describe('POST /api/diagnose — missing input', () => {
  test('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/diagnose')
      .set('Content-Type', 'application/json')
      .send('');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCAN_EVIDENCE');
  });

  test('returns 400 when body is an array', async () => {
    const res = await postDiagnose([VALID_SCAN]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCAN_EVIDENCE');
  });

  test('rejects an object missing scan evidence groups before calling the service', async () => {
    const res = await postDiagnose({ owner: 'acme', repo: 'my-repo' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCAN_EVIDENCE');
    expect(diagnoseRepository).not.toHaveBeenCalled();
  });

  test('rejects malformed optional repository identity fields', async () => {
    const res = await postDiagnose({ ...VALID_SCAN, owner: 42 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCAN_EVIDENCE');
    expect(diagnoseRepository).not.toHaveBeenCalled();
  });
});

// ── 3. Invalid input (service-level validation) ───────────────────────────────

describe('POST /api/diagnose — invalid input', () => {
  test('returns 400 INVALID_SCAN_EVIDENCE when diagnosisService rejects the payload', async () => {
    diagnoseRepository.mockRejectedValue(
      new AppError('INVALID_SCAN_EVIDENCE', 400, 'Structured scan evidence is required.')
    );
    const res = await postDiagnose({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SCAN_EVIDENCE');
  });
});

// ── 4. Diagnosis service failures ────────────────────────────────────────────

describe('POST /api/diagnose — service failures', () => {
  test('returns 503 AI_NOT_CONFIGURED when provider is not configured', async () => {
    diagnoseRepository.mockRejectedValue(
      new AppError('AI_NOT_CONFIGURED', 503, 'The diagnosis provider is not configured.')
    );
    const res = await postDiagnose(VALID_SCAN);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  test('returns 502 AI_PROVIDER_ERROR when provider call fails', async () => {
    diagnoseRepository.mockRejectedValue(
      new AppError('AI_PROVIDER_ERROR', 502, 'The diagnosis provider could not complete the request.')
    );
    const res = await postDiagnose(VALID_SCAN);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_PROVIDER_ERROR');
  });

  test('returns 502 AI_INVALID_RESPONSE when provider returns invalid JSON', async () => {
    diagnoseRepository.mockRejectedValue(
      new AppError('AI_INVALID_RESPONSE', 502, 'The diagnosis provider returned an invalid response.')
    );
    const res = await postDiagnose(VALID_SCAN);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_RESPONSE');
  });

  test('returns 504 AI_TIMEOUT when provider request times out', async () => {
    diagnoseRepository.mockRejectedValue(
      new AppError('AI_TIMEOUT', 504, 'The diagnosis provider request timed out.')
    );
    const res = await postDiagnose(VALID_SCAN);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
  });
});

// ── 5. Unexpected error ───────────────────────────────────────────────────────

describe('POST /api/diagnose — unexpected error', () => {
  test('returns 500 INTERNAL_ERROR for an unexpected exception', async () => {
    diagnoseRepository.mockRejectedValue(new Error('Something exploded'));
    const res = await postDiagnose(VALID_SCAN);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  test('does not leak internal error details in the response', async () => {
    diagnoseRepository.mockRejectedValue(new Error('secret api key = abc123'));
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body.error.message).not.toContain('secret api key');
    expect(res.body.error.message).not.toContain('abc123');
  });

  test('does not expose a stack trace in the response', async () => {
    diagnoseRepository.mockRejectedValue(new Error('internal boom'));
    const res = await postDiagnose(VALID_SCAN);
    expect(JSON.stringify(res.body)).not.toContain('at Object.');
  });
});

// ── 8. Error response contract ────────────────────────────────────────────────

describe('POST /api/diagnose — error response contract', () => {
  test('all AppError responses have { error: { code, message } } shape', async () => {
    const errorCases = [
      new AppError('INVALID_SCAN_EVIDENCE', 400, 'msg'),
      new AppError('AI_NOT_CONFIGURED', 503, 'msg'),
      new AppError('AI_PROVIDER_ERROR', 502, 'msg'),
      new AppError('AI_INVALID_RESPONSE', 502, 'msg'),
      new AppError('AI_TIMEOUT', 504, 'msg'),
    ];

    for (const appErr of errorCases) {
      diagnoseRepository.mockRejectedValue(appErr);
      const res = await postDiagnose(VALID_SCAN);
      expect(res.body).toHaveProperty('error.code', appErr.code);
      expect(res.body).toHaveProperty('error.message');
      expect(typeof res.body.error.message).toBe('string');
    }
  });

  test('error response does not contain a findings field', async () => {
    diagnoseRepository.mockRejectedValue(
      new AppError('AI_NOT_CONFIGURED', 503, 'Not configured.')
    );
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body).not.toHaveProperty('findings');
  });

  test('success response does not contain an error field', async () => {
    diagnoseRepository.mockResolvedValue([FINDING]);
    const res = await postDiagnose(VALID_SCAN);
    expect(res.body).not.toHaveProperty('error');
  });
});
