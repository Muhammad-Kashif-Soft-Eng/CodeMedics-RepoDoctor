'use strict';

const request = require('supertest');

// ── Module mocks (hoisted before any require of app) ─────────────────────────

jest.mock('../../services/prescriptionService');

const { prescribeForFinding } = require('../../services/prescriptionService');
const AppError                = require('../../services/AppError');
const app                     = require('../../app');

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal valid scan-result context (mirrors POST /api/scan response shape). */
const SCAN_CONTEXT = {
  scanId:        'scan-xyz-456',
  owner:         'acme',
  repo:          'my-repo',
  defaultBranch: 'main',
  truncated:     false,
  structure: {
    totalFiles: 20, totalDirectories: 5, sourceFileCount: 10,
    testFileCount: 4, docFileCount: 3, configFileCount: 2,
    hasPackageJson: true, hasReadme: true, hasTests: true,
  },
  testingSignals:    { testFileCount: 4, testFilePaths: ['tests/foo.test.js'], testDirPaths: [] },
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

/** One valid finding. */
const FINDING = {
  title:       'No unit tests for core logic',
  category:    'Testing',
  severity:    'High',
  evidence:    'testFileCount is 4 out of 10 source files (ratio 0.4).',
  affectedPath: null,
  explanation: 'Low test coverage leaves core logic unverified.',
};

/** A fully valid prescription returned by the mocked service. */
const PRESCRIPTION = {
  title:            'Increase unit test coverage',
  reason:           'Low test-to-source ratio leaves logic unverified.',
  expectedOutcome:  'Test ratio rises above 0.25, improving the Testing health score.',
  affectedPaths:    [],
  treatmentSteps:   ['Add tests for each exported function in src/.'],
  verificationPlan: 'Run the test suite; confirm test count and pass rate improve.',
  riskNotes:        null,
};

/** Full valid request body: scan context + selectedFinding. */
const VALID_BODY = { ...SCAN_CONTEXT, selectedFinding: FINDING };

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Helper ────────────────────────────────────────────────────────────────────

function postPrescribe(body) {
  return request(app).post('/api/prescribe').send(body);
}

// ── 1. Successful prescription ────────────────────────────────────────────────

describe('POST /api/prescribe — successful prescription', () => {
  beforeEach(() => {
    prescribeForFinding.mockResolvedValue(PRESCRIPTION);
  });

  test('returns HTTP 200', async () => {
    const res = await postPrescribe(VALID_BODY);
    expect(res.status).toBe(200);
  });

  test('calls prescribeForFinding exactly once', async () => {
    await postPrescribe(VALID_BODY);
    expect(prescribeForFinding).toHaveBeenCalledTimes(1);
  });

  test('passes the body as scanResult and selectedFinding as the finding', async () => {
    await postPrescribe(VALID_BODY);
    const [scanArg, findingArg] = prescribeForFinding.mock.calls[0];
    expect(scanArg.owner).toBe('acme');
    expect(scanArg.scanId).toBe('scan-xyz-456');
    expect(findingArg).toEqual(FINDING);
  });
});

// ── 9. Successful response shape ──────────────────────────────────────────────

describe('POST /api/prescribe — response shape', () => {
  beforeEach(() => {
    prescribeForFinding.mockResolvedValue(PRESCRIPTION);
  });

  test('response contains scanId', async () => {
    const res = await postPrescribe(VALID_BODY);
    expect(res.body.scanId).toBe('scan-xyz-456');
  });

  test('response contains owner', async () => {
    const res = await postPrescribe(VALID_BODY);
    expect(res.body.owner).toBe('acme');
  });

  test('response contains repo', async () => {
    const res = await postPrescribe(VALID_BODY);
    expect(res.body.repo).toBe('my-repo');
  });

  test('response contains prescription object', async () => {
    const res = await postPrescribe(VALID_BODY);
    expect(res.body.prescription).toEqual(PRESCRIPTION);
  });

  test('prescription contains all required fields', async () => {
    const res = await postPrescribe(VALID_BODY);
    const p = res.body.prescription;
    expect(p).toHaveProperty('title');
    expect(p).toHaveProperty('reason');
    expect(p).toHaveProperty('expectedOutcome');
    expect(p).toHaveProperty('affectedPaths');
    expect(p).toHaveProperty('treatmentSteps');
    expect(p).toHaveProperty('verificationPlan');
    expect(p).toHaveProperty('riskNotes');
  });

  test('scanId is null when not provided in the body', async () => {
    const { scanId: _s, ...noId } = VALID_BODY;
    const res = await postPrescribe(noId);
    expect(res.body.scanId).toBeNull();
  });

  test('owner and repo are null when not provided in the body', async () => {
    const { owner: _o, repo: _r, ...minimal } = VALID_BODY;
    const res = await postPrescribe(minimal);
    expect(res.body.owner).toBeNull();
    expect(res.body.repo).toBeNull();
  });

  test('success response does not contain an error field', async () => {
    const res = await postPrescribe(VALID_BODY);
    expect(res.body).not.toHaveProperty('error');
  });
});

// ── 2. Missing finding ────────────────────────────────────────────────────────

describe('POST /api/prescribe — missing finding', () => {
  test('returns 400 INVALID_FINDING when selectedFinding is absent', async () => {
    const { selectedFinding: _f, ...noFinding } = VALID_BODY;
    const res = await postPrescribe(noFinding);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });

  test('returns 400 INVALID_FINDING when selectedFinding is null', async () => {
    const res = await postPrescribe({ ...VALID_BODY, selectedFinding: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });

  test('returns 400 INVALID_FINDING when body is empty', async () => {
    const res = await request(app)
      .post('/api/prescribe')
      .set('Content-Type', 'application/json')
      .send('');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });

  test('returns 400 INVALID_FINDING when body is an array', async () => {
    const res = await postPrescribe([VALID_BODY]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });

  test('does not call prescribeForFinding when selectedFinding is missing', async () => {
    const { selectedFinding: _f, ...noFinding } = VALID_BODY;
    await postPrescribe(noFinding);
    expect(prescribeForFinding).not.toHaveBeenCalled();
  });
});

// ── 3. Multiple findings rejected ─────────────────────────────────────────────

describe('POST /api/prescribe — multiple findings rejected', () => {
  test('returns 400 INVALID_FINDING when selectedFinding is an array', async () => {
    const res = await postPrescribe({ ...VALID_BODY, selectedFinding: [FINDING, FINDING] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });

  test('does not call prescribeForFinding when an array of findings is supplied', async () => {
    await postPrescribe({ ...VALID_BODY, selectedFinding: [FINDING] });
    expect(prescribeForFinding).not.toHaveBeenCalled();
  });
});

// ── 4. Invalid finding (service-level validation) ─────────────────────────────

describe('POST /api/prescribe — invalid finding', () => {
  test('returns 400 INVALID_FINDING when the service rejects the finding shape', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('INVALID_FINDING', 400, 'The selected finding is missing required fields.')
    );
    const res = await postPrescribe(VALID_BODY);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });

  test('returns 400 INVALID_FINDING for invalid category', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('INVALID_FINDING', 400, 'Invalid finding category: "Security".')
    );
    const res = await postPrescribe({ ...VALID_BODY, selectedFinding: { ...FINDING, category: 'Security' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });

  test('returns 400 INVALID_FINDING for invalid severity', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('INVALID_FINDING', 400, 'Invalid finding severity: "Urgent".')
    );
    const res = await postPrescribe({ ...VALID_BODY, selectedFinding: { ...FINDING, severity: 'Urgent' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });

  test('returns 400 INVALID_FINDING for unsupported affected path', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('INVALID_FINDING', 400, 'The finding\'s affectedPath is not in the scan evidence.')
    );
    const res = await postPrescribe({
      ...VALID_BODY,
      selectedFinding: { ...FINDING, affectedPath: 'src/imaginary.js' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FINDING');
  });
});

// ── 5. Provider/configuration failure ────────────────────────────────────────

describe('POST /api/prescribe — configuration failure', () => {
  test('returns 503 AI_NOT_CONFIGURED when the provider is not configured', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('AI_NOT_CONFIGURED', 503, 'The prescription provider is not configured.')
    );
    const res = await postPrescribe(VALID_BODY);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
  });
});

// ── 6. Provider failure ───────────────────────────────────────────────────────

describe('POST /api/prescribe — provider failure', () => {
  test('returns 502 AI_PROVIDER_ERROR when the provider call fails', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('AI_PROVIDER_ERROR', 502, 'The prescription provider could not complete the request.')
    );
    const res = await postPrescribe(VALID_BODY);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_PROVIDER_ERROR');
  });
});

// ── 7. Timeout ────────────────────────────────────────────────────────────────

describe('POST /api/prescribe — timeout', () => {
  test('returns 504 AI_TIMEOUT when the provider request times out', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('AI_TIMEOUT', 504, 'The prescription provider request timed out.')
    );
    const res = await postPrescribe(VALID_BODY);
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
  });
});

// ── 8. Invalid prescription response ─────────────────────────────────────────

describe('POST /api/prescribe — invalid AI response', () => {
  test('returns 502 AI_INVALID_RESPONSE when the provider returns an invalid prescription', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('AI_INVALID_RESPONSE', 502, 'The prescription provider returned an invalid response.')
    );
    const res = await postPrescribe(VALID_BODY);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_RESPONSE');
  });
});

// ── 10. Unexpected error ──────────────────────────────────────────────────────

describe('POST /api/prescribe — unexpected error', () => {
  test('returns 500 INTERNAL_ERROR for an unexpected exception', async () => {
    prescribeForFinding.mockRejectedValue(new Error('Something exploded'));
    const res = await postPrescribe(VALID_BODY);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  test('does not leak internal error details in the response', async () => {
    prescribeForFinding.mockRejectedValue(new Error('secret api key = abc123'));
    const res = await postPrescribe(VALID_BODY);
    expect(res.body.error.message).not.toContain('secret api key');
    expect(res.body.error.message).not.toContain('abc123');
  });

  test('does not expose a stack trace in the response', async () => {
    prescribeForFinding.mockRejectedValue(new Error('internal boom'));
    const res = await postPrescribe(VALID_BODY);
    expect(JSON.stringify(res.body)).not.toContain('at Object.');
  });
});

// ── Error response contract ────────────────────────────────────────────────────

describe('POST /api/prescribe — error response contract', () => {
  test('all AppError responses have { error: { code, message } } shape', async () => {
    const errorCases = [
      new AppError('INVALID_FINDING',     400, 'msg'),
      new AppError('INVALID_SCAN_EVIDENCE', 400, 'msg'),
      new AppError('AI_NOT_CONFIGURED',   503, 'msg'),
      new AppError('AI_PROVIDER_ERROR',   502, 'msg'),
      new AppError('AI_INVALID_RESPONSE', 502, 'msg'),
      new AppError('AI_TIMEOUT',          504, 'msg'),
    ];

    for (const appErr of errorCases) {
      prescribeForFinding.mockRejectedValue(appErr);
      const res = await postPrescribe(VALID_BODY);
      expect(res.body).toHaveProperty('error.code', appErr.code);
      expect(res.body).toHaveProperty('error.message');
      expect(typeof res.body.error.message).toBe('string');
    }
  });

  test('error response does not contain a prescription field', async () => {
    prescribeForFinding.mockRejectedValue(
      new AppError('AI_NOT_CONFIGURED', 503, 'Not configured.')
    );
    const res = await postPrescribe(VALID_BODY);
    expect(res.body).not.toHaveProperty('prescription');
  });
});
