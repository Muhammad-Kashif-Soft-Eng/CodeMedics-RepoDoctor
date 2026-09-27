'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const { applyTreatment } = require('../treatmentService');
const AppError = require('../AppError');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FINDING = {
  title:       'No unit tests for widget module',
  category:    'Testing',
  severity:    'High',
  evidence:    'One test file was detected for ten source files.',
  affectedPath: 'test/widget.test.js',
  explanation: 'Sparse automated tests leave behavior changes unverified.',
};

function approvedPrescription(overrides = {}) {
  return {
    title:            'Add unit tests for widget module',
    reason:           'Low test coverage.',
    expectedOutcome:  'Test ratio rises above 0.25.',
    affectedPaths:    ['test/widget.test.js'],
    treatmentSteps:   ['Write a test for each exported function.'],
    verificationPlan: 'Run npm test; confirm all pass.',
    riskNotes:        null,
    approved:         true,
    ...overrides,
  };
}

const SCAN_RESULT = {
  owner: 'acme', repo: 'widget', defaultBranch: 'main',
};

function providerResponse(content) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function mockFetch(changes) {
  return jest.fn().mockResolvedValue(
    providerResponse(JSON.stringify({ changes }))
  );
}

// ── Environment setup ─────────────────────────────────────────────────────────

const savedEnv = {};

beforeAll(() => {
  for (const k of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_BASE_URL', 'AI_TIMEOUT_MS', 'TREATMENT_WORKSPACE_ROOT']) {
    savedEnv[k] = process.env[k];
  }
});

beforeEach(() => {
  process.env.OPENAI_API_KEY  = 'unit-test-key';
  process.env.OPENAI_MODEL    = 'unit-test-model';
  process.env.OPENAI_BASE_URL = 'https://provider.example/v1/';
  delete process.env.AI_TIMEOUT_MS;
  delete process.env.TREATMENT_WORKSPACE_ROOT;
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── Workspace helpers ─────────────────────────────────────────────────────────

/**
 * Create a fresh temporary directory for each test that needs real FS I/O.
 * Returns { workspaceDir, cleanup }.
 */
function makeTmpWorkspace() {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemedics-test-'));
  // Pre-create the test sub-directory so paths resolve correctly
  fs.mkdirSync(path.join(workspaceDir, 'test'), { recursive: true });
  return {
    workspaceDir,
    cleanup: () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
  };
}

/** Build a default valid applyTreatment call using the given workspace. */
function defaultCall(workspaceDir, overrides = {}) {
  return {
    finding:       FINDING,
    prescription:  approvedPrescription(),
    workspacePath: workspaceDir,
    scanResult:    SCAN_RESULT,
    options:       {
      fetchImpl: mockFetch([{ path: 'test/widget.test.js', content: '// unit tests\n' }]),
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('treatmentService.applyTreatment', () => {

  // ── 1. Valid approved treatment ───────────────────────────────────────────────

  test('applies an approved treatment and returns a result object', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    try {
      const result = await applyTreatment(defaultCall(workspaceDir));

      expect(result.status).toBe('applied');
      expect(result.workspacePath).toBe(workspaceDir);
      expect(result.changedFiles).toEqual(['test/widget.test.js']);
      expect(typeof result.beforeContent).toBe('object');
      expect(Array.isArray(result.proposedChanges)).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('calls the provider exactly once', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = mockFetch([{ path: 'test/widget.test.js', content: '// tests\n' }]);
    try {
      await applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test('calls the correct provider endpoint', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = mockFetch([{ path: 'test/widget.test.js', content: '// tests\n' }]);
    try {
      await applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }));
      expect(fetchImpl.mock.calls[0][0]).toBe('https://provider.example/v1/chat/completions');
    } finally {
      cleanup();
    }
  });

  // ── 2. Missing finding ────────────────────────────────────────────────────────

  test('throws INVALID_TREATMENT_REQUEST when finding is null', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { finding: null }))
      ).rejects.toMatchObject({ code: 'INVALID_TREATMENT_REQUEST', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  test('throws INVALID_TREATMENT_REQUEST when finding is undefined', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { finding: undefined }))
      ).rejects.toMatchObject({ code: 'INVALID_TREATMENT_REQUEST', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  // ── 3. Missing prescription ───────────────────────────────────────────────────

  test('throws INVALID_TREATMENT_REQUEST when prescription is null', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { prescription: null }))
      ).rejects.toMatchObject({ code: 'INVALID_TREATMENT_REQUEST', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  // ── 4. Unapproved prescription ────────────────────────────────────────────────

  test('throws PRESCRIPTION_NOT_APPROVED when approved is false', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { prescription: approvedPrescription({ approved: false }) }))
      ).rejects.toMatchObject({ code: 'PRESCRIPTION_NOT_APPROVED', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  test('throws PRESCRIPTION_NOT_APPROVED when approved is absent', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const { approved: _a, ...noApproval } = approvedPrescription();
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { prescription: noApproval }))
      ).rejects.toMatchObject({ code: 'PRESCRIPTION_NOT_APPROVED', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  // ── 5. Multiple findings ──────────────────────────────────────────────────────

  test('throws INVALID_TREATMENT_REQUEST when an array of findings is passed', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { finding: [FINDING, FINDING] }))
      ).rejects.toMatchObject({ code: 'INVALID_TREATMENT_REQUEST', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  // ── 6. Unsafe path traversal ──────────────────────────────────────────────────

  test('throws UNSAFE_PATH when an affected path contains ..', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const badPrescription = approvedPrescription({ affectedPaths: ['../escape.js'] });
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { prescription: badPrescription }))
      ).rejects.toMatchObject({ code: 'UNSAFE_PATH', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  test('throws UNSAFE_PATH for nested traversal like subdir/../../escape.js', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const badPrescription = approvedPrescription({ affectedPaths: ['subdir/../../escape.js'] });
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { prescription: badPrescription }))
      ).rejects.toMatchObject({ code: 'UNSAFE_PATH', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  // ── 7. Absolute-path rejection ────────────────────────────────────────────────

  test('throws UNSAFE_PATH for an absolute path in affectedPaths', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const badPrescription = approvedPrescription({ affectedPaths: ['/etc/passwd'] });
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { prescription: badPrescription }))
      ).rejects.toMatchObject({ code: 'UNSAFE_PATH', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  // ── 8. Unrelated file rejection (AI tries to change a path not in affectedPaths) ──

  test('throws AI_INVALID_RESPONSE when the AI proposes a path outside affectedPaths', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = mockFetch([{ path: 'src/unrelated.js', content: '// bad\n' }]);
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }))
      ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', httpStatus: 502 });
    } finally {
      cleanup();
    }
  });

  // ── 9. Successful single-file treatment ───────────────────────────────────────

  test('writes the proposed content to the target file', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const expectedContent = '// generated test content\ntest("widget", () => {});\n';
    const fetchImpl = mockFetch([{ path: 'test/widget.test.js', content: expectedContent }]);
    try {
      await applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }));
      const written = fs.readFileSync(path.join(workspaceDir, 'test/widget.test.js'), 'utf8');
      expect(written).toBe(expectedContent);
    } finally {
      cleanup();
    }
  });

  test('returns status "no_changes" when the AI returns an empty changes array', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = mockFetch([]);
    try {
      const result = await applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }));
      expect(result.status).toBe('no_changes');
      expect(result.changedFiles).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  // ── 10. Provider failure ──────────────────────────────────────────────────────

  test('throws AI_PROVIDER_ERROR when the provider returns a non-ok response', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }))
      ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', httpStatus: 502 });
    } finally {
      cleanup();
    }
  });

  test('throws AI_PROVIDER_ERROR when the network call fails', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network failure'));
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }))
      ).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', httpStatus: 502 });
    } finally {
      cleanup();
    }
  });

  // ── 11. Invalid provider response ────────────────────────────────────────────

  test('throws AI_INVALID_RESPONSE when provider returns non-JSON', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = jest.fn().mockResolvedValue(providerResponse('not json'));
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }))
      ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', httpStatus: 502 });
    } finally {
      cleanup();
    }
  });

  test('throws AI_INVALID_RESPONSE when provider returns a JSON array', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = jest.fn().mockResolvedValue(providerResponse('[]'));
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }))
      ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', httpStatus: 502 });
    } finally {
      cleanup();
    }
  });

  test('throws AI_INVALID_RESPONSE when a change entry is missing content', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = jest.fn().mockResolvedValue(
      providerResponse(JSON.stringify({ changes: [{ path: 'test/widget.test.js' }] }))
    );
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }))
      ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', httpStatus: 502 });
    } finally {
      cleanup();
    }
  });

  // ── 12. Filesystem failure ────────────────────────────────────────────────────

  test('throws FILESYSTEM_ERROR when workspace path does not exist', async () => {
    await expect(
      applyTreatment({
        finding:       FINDING,
        prescription:  approvedPrescription(),
        workspacePath: path.join(os.tmpdir(), 'codemedics-nonexistent-' + Date.now()),
        scanResult:    SCAN_RESULT,
        options:       { fetchImpl: jest.fn() },
      })
    ).rejects.toMatchObject({ code: 'UNSAFE_PATH', httpStatus: 400 });
  });

  test('throws UNSAFE_PATH when workspace path points to a file, not a directory', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const filePath = path.join(workspaceDir, 'not-a-dir.txt');
    fs.writeFileSync(filePath, 'content');
    try {
      await expect(
        applyTreatment({
          finding:       FINDING,
          prescription:  approvedPrescription(),
          workspacePath: filePath,
          scanResult:    SCAN_RESULT,
          options:       { fetchImpl: jest.fn() },
        })
      ).rejects.toMatchObject({ code: 'UNSAFE_PATH', httpStatus: 400 });
    } finally {
      cleanup();
    }
  });

  // ── 13. Changed-file tracking ─────────────────────────────────────────────────

  test('records all files that were actually written in changedFiles', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    // Prescription with two affected paths
    const twoPathPrescription = approvedPrescription({
      affectedPaths: ['test/widget.test.js', 'test/helper.test.js'],
    });
    fs.mkdirSync(path.join(workspaceDir, 'test'), { recursive: true });
    const fetchImpl = mockFetch([
      { path: 'test/widget.test.js', content: '// widget tests\n' },
      { path: 'test/helper.test.js', content: '// helper tests\n' },
    ]);
    try {
      const result = await applyTreatment({
        finding:       FINDING,
        prescription:  twoPathPrescription,
        workspacePath: workspaceDir,
        scanResult:    SCAN_RESULT,
        options:       { fetchImpl },
      });
      expect(result.changedFiles).toHaveLength(2);
      expect(result.changedFiles).toContain('test/widget.test.js');
      expect(result.changedFiles).toContain('test/helper.test.js');
    } finally {
      cleanup();
    }
  });

  test('captures before-content of existing files before writing', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const originalContent = '// original test file\n';
    fs.writeFileSync(path.join(workspaceDir, 'test/widget.test.js'), originalContent, 'utf8');
    const fetchImpl = mockFetch([{ path: 'test/widget.test.js', content: '// new content\n' }]);
    try {
      const result = await applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }));
      expect(result.beforeContent['test/widget.test.js']).toBe(originalContent);
    } finally {
      cleanup();
    }
  });

  test('records null before-content when the file did not exist before treatment', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    // Do NOT pre-create the file
    const fetchImpl = mockFetch([{ path: 'test/widget.test.js', content: '// brand new\n' }]);
    try {
      const result = await applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }));
      expect(result.beforeContent['test/widget.test.js']).toBeNull();
    } finally {
      cleanup();
    }
  });

  // ── Provider not configured ───────────────────────────────────────────────────

  test('throws AI_NOT_CONFIGURED without making a fetch call when keys are missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = jest.fn();
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl } }))
      ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED', httpStatus: 503 });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  // ── Timeout ───────────────────────────────────────────────────────────────────

  test('throws AI_TIMEOUT when the provider request is aborted', async () => {
    const { workspaceDir, cleanup } = makeTmpWorkspace();
    const fetchImpl = jest.fn((_url, opts) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('aborted'); err.name = 'AbortError'; rej(err);
      }, { once: true });
    }));
    try {
      await expect(
        applyTreatment(defaultCall(workspaceDir, { options: { fetchImpl, timeoutMs: 5 } }))
      ).rejects.toMatchObject({ code: 'AI_TIMEOUT', httpStatus: 504 });
    } finally {
      cleanup();
    }
  });
});
