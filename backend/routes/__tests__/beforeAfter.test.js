'use strict';

const request = require('supertest');

jest.mock('../../services/beforeAfterService');

const { compareBeforeAfter } = require('../../services/beforeAfterService');
const AppError = require('../../services/AppError');
const app = require('../../app');

const BEFORE_HEALTH = {
  healthScore: {
    overall: 61, testing: 35, documentation: 65, structure: 70, codeQuality: 72, dependencies: 68,
  },
};
const AFTER_HEALTH = {
  healthScore: {
    overall: 76, testing: 60, documentation: 65, structure: 70, codeQuality: 74, dependencies: 68,
  },
};
const TREATMENT_RESULT = { status: 'applied', changedFiles: ['src/module.js', 'src/treatment-only.js'] };
const VERIFICATION_RESULT = {
  status: 'passed',
  changedFiles: ['src/module.js', 'src/verification-only.js'],
  checksRun: ['node --test'],
  passedChecks: ['node --test'],
  failedChecks: [],
};
const VALID_BODY = {
  beforeHealthResult: BEFORE_HEALTH,
  afterHealthResult: AFTER_HEALTH,
  treatmentResult: TREATMENT_RESULT,
  verificationResult: VERIFICATION_RESULT,
};

function comparison(overrides = {}) {
  return {
    beforeScore: 61,
    afterScore: 76,
    scoreDelta: 15,
    beforeCategories: {
      testing: 35, documentation: 65, structure: 70, codeQuality: 72, dependencies: 68,
    },
    afterCategories: {
      testing: 60, documentation: 65, structure: 70, codeQuality: 74, dependencies: 68,
    },
    changedFiles: ['src/module.js'],
    verificationStatus: 'passed',
    verificationChecks: {
      checksRun: ['node --test'], passedChecks: ['node --test'], failedChecks: [],
    },
    improved: true,
    summary: 'Health improved by 15 points and verification passed. One approved changed file was confirmed.',
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  compareBeforeAfter.mockResolvedValue(comparison());
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function postBeforeAfter(body) {
  return request(app).post('/api/before-after').send(body);
}

describe('POST /api/before-after', () => {
  test('returns a normalized comparison and delegates only required data', async () => {
    const response = await postBeforeAfter(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(comparison());
    expect(compareBeforeAfter).toHaveBeenCalledWith(VALID_BODY);
  });

  test('preserves score improvement from the service result', async () => {
    compareBeforeAfter.mockResolvedValue(comparison({ scoreDelta: 8, improved: true }));

    const response = await postBeforeAfter(VALID_BODY);

    expect(response.body.scoreDelta).toBe(8);
    expect(response.body.improved).toBe(true);
  });

  test('preserves an unchanged score', async () => {
    compareBeforeAfter.mockResolvedValue(comparison({ afterScore: 61, scoreDelta: 0, improved: false }));

    const response = await postBeforeAfter(VALID_BODY);

    expect(response.body.scoreDelta).toBe(0);
    expect(response.body.improved).toBe(false);
  });

  test('preserves a score regression', async () => {
    compareBeforeAfter.mockResolvedValue(comparison({ afterScore: 55, scoreDelta: -6, improved: false }));

    const response = await postBeforeAfter(VALID_BODY);

    expect(response.body.scoreDelta).toBe(-6);
    expect(response.body.improved).toBe(false);
  });

  test('preserves failed verification and never marks it improved', async () => {
    compareBeforeAfter.mockResolvedValue(comparison({
      verificationStatus: 'failed',
      verificationChecks: {
        checksRun: ['node --test'],
        passedChecks: [],
        failedChecks: [{ check: 'node --test', exitCode: 1 }],
      },
      improved: false,
    }));

    const response = await postBeforeAfter(VALID_BODY);

    expect(response.body.verificationStatus).toBe('failed');
    expect(response.body.improved).toBe(false);
    expect(response.body.verificationChecks.failedChecks[0].exitCode).toBe(1);
  });

  test('rejects malformed request objects before calling the service', async () => {
    const response = await postBeforeAfter([]);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_BEFORE_AFTER_REQUEST');
    expect(compareBeforeAfter).not.toHaveBeenCalled();
  });

  test('rejects a missing before health result', async () => {
    const { beforeHealthResult: _before, ...body } = VALID_BODY;

    const response = await postBeforeAfter(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_BEFORE_AFTER_REQUEST');
    expect(compareBeforeAfter).not.toHaveBeenCalled();
  });

  test('rejects a missing after health result', async () => {
    const { afterHealthResult: _after, ...body } = VALID_BODY;

    const response = await postBeforeAfter(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_BEFORE_AFTER_REQUEST');
    expect(compareBeforeAfter).not.toHaveBeenCalled();
  });

  test('passes both changed-file lists to the service and returns its intersection', async () => {
    const response = await postBeforeAfter(VALID_BODY);

    expect(compareBeforeAfter).toHaveBeenCalledWith(expect.objectContaining({
      treatmentResult: TREATMENT_RESULT,
      verificationResult: VERIFICATION_RESULT,
    }));
    expect(response.body.changedFiles).toEqual(['src/module.js']);
  });

  test('rejects forbidden source contents and extra command/workspace fields', async () => {
    const withContents = await postBeforeAfter({
      ...VALID_BODY,
      treatmentResult: { ...TREATMENT_RESULT, beforeContent: { 'src/module.js': 'source' } },
    });
    const withCommand = await postBeforeAfter({ ...VALID_BODY, command: 'node arbitrary.js' });
    const withWorkspace = await postBeforeAfter({ ...VALID_BODY, workspacePath: 'C:\\private\\repo' });

    expect(withContents.status).toBe(400);
    expect(withCommand.status).toBe(400);
    expect(withWorkspace.status).toBe(400);
    expect(compareBeforeAfter).not.toHaveBeenCalled();
  });

  test('projects only normalized response fields and does not expose source content', async () => {
    compareBeforeAfter.mockResolvedValue({
      ...comparison(),
      sourceContents: 'secret source text',
      beforeContent: 'secret before content',
      apiKey: 'secret-api-key',
      output: 'raw command output',
      workspacePath: 'C:\\private\\repo',
    });

    const response = await postBeforeAfter(VALID_BODY);
    const responseText = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'afterCategories', 'afterScore', 'beforeCategories', 'beforeScore', 'changedFiles',
      'improved', 'scoreDelta', 'summary', 'verificationChecks', 'verificationStatus',
    ].sort());
    expect(responseText).not.toContain('secret source text');
    expect(responseText).not.toContain('secret before content');
    expect(responseText).not.toContain('secret-api-key');
    expect(responseText).not.toContain('raw command output');
    expect(responseText).not.toContain('C:\\private\\repo');
  });

  test('rejects absolute paths in normalized changed files', async () => {
    compareBeforeAfter.mockResolvedValue(comparison({ changedFiles: ['C:\\private\\repo\\file.js'] }));

    const response = await postBeforeAfter(VALID_BODY);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_BEFORE_AFTER_REQUEST');
    expect(JSON.stringify(response.body)).not.toContain('C:\\private');
  });

  test('propagates service AppError using the backend error contract', async () => {
    compareBeforeAfter.mockRejectedValue(new AppError('INVALID_BEFORE_AFTER_INPUT', 400, 'Invalid comparison input.'));

    const response = await postBeforeAfter(VALID_BODY);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: 'INVALID_BEFORE_AFTER_INPUT', message: 'Invalid comparison input.' },
    });
  });
});