'use strict';

const { diagnoseRepository } = require('../diagnosisService');
const AppError = require('../AppError');

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
    testDirPaths: ['test'],
  },
  docSignals: {
    readmePaths: ['README.md'], docFilePaths: ['README.md', 'docs/guide.md'],
    docFileCount: 2, readmePresent: true, readmeNonEmpty: true, readmeCharCount: 300,
  },
  qualitySignals: {
    todoCount: 4, fixmeCount: 1, largeFileCount: 1,
    analyzedFileCount: 10, largeFilePaths: ['src/large.js'], skippedFilePaths: [],
  },
  dependencySignals: {
    hasPackageJson: true, manifestPaths: ['package.json'], packageJsonValid: true,
    hasDependencies: true, hasDevDependencies: true, hasTestScript: true,
    scripts: ['test', 'build'],
  },
  sourceFiles: [{ path: 'secret.js', content: 'must not be sent' }],
  repoUrl: 'https://github.com/acme/widget',
};

function finding(overrides = {}) {
  return {
    title: 'Limited automated test coverage',
    category: 'Testing',
    severity: 'High',
    evidence: 'One test file was detected for ten source files.',
    affectedPath: 'test/widget.test.js',
    explanation: 'Sparse automated tests make behavior changes harder to verify.',
    ...overrides,
  };
}

function providerResponse(content) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function mockFetch(content) {
  return jest.fn().mockResolvedValue(providerResponse(JSON.stringify(content)));
}

const originalEnv = {};

beforeAll(() => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL', 'AI_TIMEOUT_MS']) {
    originalEnv[key] = process.env[key];
  }
});

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'unit-test-key';
  process.env.OPENAI_MODEL = 'unit-test-model';
  process.env.OPENAI_BASE_URL = 'https://provider.example/v1/';
  delete process.env.AI_TIMEOUT_MS;
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('diagnosisService.diagnoseRepository', () => {
  test('returns a normalized valid diagnosis response', async () => {
    const fetchImpl = mockFetch({ findings: [finding({ title: '  Limited tests  ' })] });

    const result = await diagnoseRepository(SCAN_RESULT, { fetchImpl });

    expect(result).toEqual([finding({ title: 'Limited tests' })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://provider.example/v1/chat/completions');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('unit-test-model');
  });

  test('returns multiple findings but never more than five', async () => {
    const findings = Array.from({ length: 6 }, (_, index) => finding({ title: `Finding ${index + 1}` }));
    const result = await diagnoseRepository(SCAN_RESULT, { fetchImpl: mockFetch({ findings }) });

    expect(result).toHaveLength(5);
    expect(result[0].title).toBe('Finding 1');
  });

  test('accepts an empty findings array', async () => {
    await expect(diagnoseRepository(SCAN_RESULT, { fetchImpl: mockFetch({ findings: [] }) })).resolves.toEqual([]);
  });

  test('rejects invalid model JSON with a controlled application error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(providerResponse('not-json'));

    await expect(diagnoseRepository(SCAN_RESULT, { fetchImpl })).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE', httpStatus: 502,
    });
  });

  test('rejects findings missing required fields', async () => {
    await expect(diagnoseRepository(SCAN_RESULT, {
      fetchImpl: mockFetch({ findings: [{ title: 'Missing other required fields' }] }),
    })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('rejects an invalid category', async () => {
    await expect(diagnoseRepository(SCAN_RESULT, {
      fetchImpl: mockFetch({ findings: [finding({ category: 'Security' })] }),
    })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('rejects an invalid severity', async () => {
    await expect(diagnoseRepository(SCAN_RESULT, {
      fetchImpl: mockFetch({ findings: [finding({ severity: 'Urgent' })] }),
    })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('maps provider failures to a controlled application error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(diagnoseRepository(SCAN_RESULT, { fetchImpl })).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR', httpStatus: 502,
    });
  });

  test('aborts timed out provider requests with a controlled timeout error', async () => {
    const fetchImpl = jest.fn((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));

    await expect(diagnoseRepository(SCAN_RESULT, { fetchImpl, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'AI_TIMEOUT', httpStatus: 504,
    });
  });

  test('limits the provider payload to selected evidence and excludes file contents', async () => {
    const fetchImpl = mockFetch({ findings: [] });

    await diagnoseRepository(SCAN_RESULT, { fetchImpl });

    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const sentEvidence = JSON.parse(request.messages[1].content);
    expect(sentEvidence.repository).toEqual({ owner: 'acme', name: 'widget', defaultBranch: 'main' });
    expect(sentEvidence.testingSignals.testFilePaths).toEqual(['test/widget.test.js']);
    expect(sentEvidence.healthScore.overall).toBe(51);
    expect(request.messages[1].content).not.toContain('must not be sent');
    expect(request.messages[1].content).not.toContain('repoUrl');
  });

  test('rejects an affected path that is not present in supplied evidence', async () => {
    await expect(diagnoseRepository(SCAN_RESULT, {
      fetchImpl: mockFetch({ findings: [finding({ affectedPath: 'src/imaginary.js' })] }),
    })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  test('allows evidence-limited empty diagnosis', async () => {
    const sparseScan = { owner: 'acme', repo: 'empty', healthScore: {} };
    const result = await diagnoseRepository(sparseScan, { fetchImpl: mockFetch({ findings: [] }) });

    expect(result).toEqual([]);
  });

  test('reports missing provider configuration without making a request', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchImpl = jest.fn();

    await expect(diagnoseRepository(SCAN_RESULT, { fetchImpl })).rejects.toBeInstanceOf(AppError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});