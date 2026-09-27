'use strict';

const { prescribeForFinding } = require('../prescriptionService');
const AppError = require('../AppError');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SCAN_RESULT = {
  owner: 'acme',
  repo: 'widget',
  defaultBranch: 'main',
  truncated: false,
  healthScore: {
    testing: 20, documentation: 30, structure: 75,
    codeQuality: 80, dependencies: 60, overall: 51,
  },
  structure: {
    totalFiles: 18, totalDirectories: 4, sourceFileCount: 10,
    testFileCount: 1, docFileCount: 2, configFileCount: 1,
    hasPackageJson: true, hasReadme: true, hasTests: true,
  },
  testingSignals: {
    testFileCount: 1,
    testFilePaths: ['test/widget.test.js'],
    testDirPaths:  ['test'],
  },
  docSignals: {
    readmePaths:  ['README.md'],
    docFilePaths: ['README.md', 'docs/guide.md'],
    docFileCount: 2, readmePresent: true, readmeNonEmpty: true, readmeCharCount: 300,
  },
  qualitySignals: {
    todoCount: 4, fixmeCount: 1, largeFileCount: 1,
    analyzedFileCount: 10,
    largeFilePaths:   ['src/large.js'],
    skippedFilePaths: [],
  },
  dependencySignals: {
    hasPackageJson: true, manifestPaths: ['package.json'], packageJsonValid: true,
    hasDependencies: true, hasDevDependencies: true, hasTestScript: true,
    scripts: ['test', 'build'],
  },
  // This field must NOT be forwarded to the AI
  sourceFiles: [{ path: 'secret.js', content: 'must not be sent' }],
};

/** A fully valid selected finding referencing a supported path. */
function finding(overrides = {}) {
  return {
    title:       'Limited automated test coverage',
    category:    'Testing',
    severity:    'High',
    evidence:    'One test file was detected for ten source files.',
    affectedPath: 'test/widget.test.js',
    explanation: 'Sparse automated tests make behavior changes harder to verify.',
    ...overrides,
  };
}

/** A fully valid prescription returned by the provider. */
function validPrescription(overrides = {}) {
  return {
    title:            'Increase unit test coverage for widget module',
    reason:           'One test file for ten source files leaves most logic unverified.',
    expectedOutcome:  'Test-to-source ratio rises above 0.25, improving the Testing health score.',
    affectedPaths:    ['test/widget.test.js'],
    treatmentSteps:   ['Add unit tests for each exported function in the source files.'],
    verificationPlan: 'Run the test suite; confirm the test count increases and all tests pass.',
    riskNotes:        null,
    ...overrides,
  };
}

function providerResponse(content) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function mockFetch(prescription) {
  return jest.fn().mockResolvedValue(
    providerResponse(JSON.stringify(prescription))
  );
}

// ── Environment setup ─────────────────────────────────────────────────────────

const originalEnv = {};

beforeAll(() => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL', 'AI_TIMEOUT_MS']) {
    originalEnv[key] = process.env[key];
  }
});

beforeEach(() => {
  process.env.OPENAI_API_KEY   = 'unit-test-key';
  process.env.OPENAI_MODEL     = 'unit-test-model';
  process.env.OPENAI_BASE_URL  = 'https://provider.example/v1/';
  delete process.env.AI_TIMEOUT_MS;
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe('prescriptionService.prescribeForFinding', () => {

  // ── 1. Valid prescription ────────────────────────────────────────────────────

  test('returns a normalized valid prescription', async () => {
    const fetchImpl = mockFetch(validPrescription());
    const result = await prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl });

    expect(result.title).toBe('Increase unit test coverage for widget module');
    expect(result.reason).toBe('One test file for ten source files leaves most logic unverified.');
    expect(result.expectedOutcome).toContain('Testing health score');
    expect(result.affectedPaths).toEqual(['test/widget.test.js']);
    expect(Array.isArray(result.treatmentSteps)).toBe(true);
    expect(result.treatmentSteps.length).toBeGreaterThan(0);
    expect(typeof result.verificationPlan).toBe('string');
    expect(result.riskNotes).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('calls the correct endpoint with the correct model', async () => {
    const fetchImpl = mockFetch(validPrescription());
    await prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe('https://provider.example/v1/chat/completions');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('unit-test-model');
  });

  // ── 2. One selected finding ───────────────────────────────────────────────────

  test('forwards exactly the selected finding and scan evidence to the provider', async () => {
    const fetchImpl = mockFetch(validPrescription());
    await prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl });

    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const userContent = JSON.parse(requestBody.messages[1].content);

    expect(userContent.selectedFinding.title).toBe('Limited automated test coverage');
    expect(userContent.selectedFinding.category).toBe('Testing');
    expect(userContent.scanEvidence.repository.owner).toBe('acme');
  });

  test('does not forward raw file content or sourceFiles to the provider', async () => {
    const fetchImpl = mockFetch(validPrescription());
    await prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl });

    const bodyStr = fetchImpl.mock.calls[0][1].body;
    expect(bodyStr).not.toContain('must not be sent');
    expect(bodyStr).not.toContain('sourceFiles');
  });

  // ── 3. Missing selected finding ───────────────────────────────────────────────

  test('throws INVALID_FINDING when selectedFinding is null', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, null, { fetchImpl: jest.fn() })
    ).rejects.toMatchObject({ code: 'INVALID_FINDING', httpStatus: 400 });
  });

  test('throws INVALID_FINDING when selectedFinding is undefined', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, undefined, { fetchImpl: jest.fn() })
    ).rejects.toMatchObject({ code: 'INVALID_FINDING', httpStatus: 400 });
  });

  test('throws INVALID_FINDING when selectedFinding is missing required fields', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, { title: 'Incomplete' }, { fetchImpl: jest.fn() })
    ).rejects.toMatchObject({ code: 'INVALID_FINDING', httpStatus: 400 });
  });

  // ── 4. Multiple findings rejected ────────────────────────────────────────────

  test('throws INVALID_FINDING when an array of findings is passed instead of one', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, [finding(), finding()], { fetchImpl: jest.fn() })
    ).rejects.toMatchObject({ code: 'INVALID_FINDING', httpStatus: 400 });
  });

  // ── 5. Invalid category ───────────────────────────────────────────────────────

  test('throws INVALID_FINDING for a finding with an unrecognised category', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, finding({ category: 'Security' }), { fetchImpl: jest.fn() })
    ).rejects.toMatchObject({ code: 'INVALID_FINDING', httpStatus: 400 });
  });

  // ── 6. Invalid severity ───────────────────────────────────────────────────────

  test('throws INVALID_FINDING for a finding with an unrecognised severity', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, finding({ severity: 'Urgent' }), { fetchImpl: jest.fn() })
    ).rejects.toMatchObject({ code: 'INVALID_FINDING', httpStatus: 400 });
  });

  // ── 7. Unsupported affected path ──────────────────────────────────────────────

  test('throws INVALID_FINDING when finding.affectedPath is not in the scan evidence', async () => {
    await expect(
      prescribeForFinding(
        SCAN_RESULT,
        finding({ affectedPath: 'src/imaginary.js' }),
        { fetchImpl: jest.fn() }
      )
    ).rejects.toMatchObject({ code: 'INVALID_FINDING', httpStatus: 400 });
  });

  test('accepts a finding with null affectedPath', async () => {
    const fetchImpl = mockFetch(validPrescription({ affectedPaths: [] }));
    const result = await prescribeForFinding(SCAN_RESULT, finding({ affectedPath: null }), { fetchImpl });
    expect(result.affectedPaths).toEqual([]);
  });

  test('throws AI_INVALID_RESPONSE when prescription affectedPaths contains a path not in evidence', async () => {
    const fetchImpl = mockFetch(validPrescription({ affectedPaths: ['src/imaginary.js'] }));
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', httpStatus: 502 });
  });

  // ── 8. Malformed AI JSON ──────────────────────────────────────────────────────

  test('throws AI_INVALID_RESPONSE when provider returns non-JSON', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(providerResponse('not valid json'));
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', httpStatus: 502 });
  });

  test('throws AI_INVALID_RESPONSE when provider returns a JSON array instead of an object', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(providerResponse('[]'));
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', httpStatus: 502 });
  });

  // ── 9. Missing required prescription field ────────────────────────────────────

  test('throws AI_INVALID_RESPONSE when prescription is missing title', async () => {
    const { title: _t, ...noTitle } = validPrescription();
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl: mockFetch(noTitle) })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('throws AI_INVALID_RESPONSE when prescription is missing reason', async () => {
    const { reason: _r, ...noReason } = validPrescription();
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl: mockFetch(noReason) })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('throws AI_INVALID_RESPONSE when prescription is missing expectedOutcome', async () => {
    const { expectedOutcome: _e, ...noOutcome } = validPrescription();
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl: mockFetch(noOutcome) })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('throws AI_INVALID_RESPONSE when prescription is missing verificationPlan', async () => {
    const { verificationPlan: _v, ...noVerify } = validPrescription();
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl: mockFetch(noVerify) })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('throws AI_INVALID_RESPONSE when treatmentSteps is empty', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl: mockFetch(validPrescription({ treatmentSteps: [] })) })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('throws AI_INVALID_RESPONSE when treatmentSteps is not an array', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl: mockFetch(validPrescription({ treatmentSteps: 'do things' })) })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('throws AI_INVALID_RESPONSE when affectedPaths is not an array', async () => {
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl: mockFetch(validPrescription({ affectedPaths: null })) })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('accepts null riskNotes', async () => {
    const fetchImpl = mockFetch(validPrescription({ riskNotes: null }));
    const result = await prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl });
    expect(result.riskNotes).toBeNull();
  });

  test('accepts a string riskNotes', async () => {
    const fetchImpl = mockFetch(validPrescription({ riskNotes: 'Adding tests may reveal existing bugs.' }));
    const result = await prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl });
    expect(result.riskNotes).toBe('Adding tests may reveal existing bugs.');
  });

  // ── 10. Provider error ────────────────────────────────────────────────────────

  test('throws AI_PROVIDER_ERROR when provider returns a non-ok response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl })
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', httpStatus: 502 });
  });

  test('throws AI_PROVIDER_ERROR when the fetch call rejects with a network error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network failure'));
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl })
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', httpStatus: 502 });
  });

  // ── 11. Timeout ───────────────────────────────────────────────────────────────

  test('throws AI_TIMEOUT when the provider request is aborted', async () => {
    const fetchImpl = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));

    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl, timeoutMs: 5 })
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT', httpStatus: 504 });
  });

  // ── 12. Evidence-only behaviour ───────────────────────────────────────────────

  test('does not make a provider call when finding validation fails before fetch', async () => {
    const fetchImpl = jest.fn();
    await expect(
      prescribeForFinding(SCAN_RESULT, null, { fetchImpl })
    ).rejects.toMatchObject({ code: 'INVALID_FINDING' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('does not make a provider call when AI is not configured', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchImpl = jest.fn();
    await expect(
      prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl })
    ).rejects.toBeInstanceOf(AppError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('sends only sanitised evidence — never raw file content', async () => {
    const fetchImpl = mockFetch(validPrescription());
    await prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl });

    const bodyStr = fetchImpl.mock.calls[0][1].body;
    expect(bodyStr).not.toContain('must not be sent');
    expect(bodyStr).not.toContain('repoUrl');
    expect(bodyStr).not.toContain('sourceFiles');
  });

  test('truncates treatment steps at 10 even if the model returns more', async () => {
    const elevenSteps = Array.from({ length: 11 }, (_, i) => `Step ${i + 1}.`);
    const fetchImpl = mockFetch(validPrescription({ treatmentSteps: elevenSteps }));
    const result = await prescribeForFinding(SCAN_RESULT, finding(), { fetchImpl });
    expect(result.treatmentSteps.length).toBeLessThanOrEqual(10);
  });

  test('works with a sparse scan result that has minimal signals', async () => {
    const sparseScan = { owner: 'acme', repo: 'empty', healthScore: {} };
    const fetchImpl  = mockFetch(validPrescription({ affectedPaths: [] }));
    const result = await prescribeForFinding(
      sparseScan,
      finding({ affectedPath: null }),
      { fetchImpl }
    );
    expect(result.title).toBeTruthy();
  });
});
