'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

jest.mock('../../services/verificationService');

const { verifyTreatment } = require('../../services/verificationService');
const AppError = require('../../services/AppError');
const app = require('../../app');

let workspacePath;

const CHANGED_FILES = ['src/changed.js'];
const TREATMENT_RESULT = {
  status: 'applied',
  changedFiles: CHANGED_FILES,
  workspacePath: 'K:\\server\\private-workspace',
  beforeContent: { 'src/changed.js': 'source before treatment' },
  proposedChanges: [{ relativePath: 'src/changed.js', content: 'source after treatment' }],
};
const PROJECT_INFO = {
  language: 'JavaScript',
  packageManager: 'npm',
  scripts: ['test'],
  hasPackageJson: true,
};
const VALID_BODY = {
  workspacePath: '',
  changedFiles: CHANGED_FILES,
  treatmentResult: TREATMENT_RESULT,
  projectInfo: PROJECT_INFO,
};
const PASSED_RESULT = {
  status: 'passed',
  checksRun: ['node --test'],
  passedChecks: ['node --test'],
  failedChecks: [],
  outputSummary: 'Tests passed. API_KEY=route-test-secret K:\\server\\private-workspace\\src\\changed.js',
  changedFiles: CHANGED_FILES,
  verificationMessage: 'All deterministic verification checks passed.',
  beforeState: {
    'src/changed.js': { exists: true, sizeBytes: 22, sha256: 'a'.repeat(64), content: 'hidden before source' },
  },
  currentState: {
    'src/changed.js': { exists: true, sizeBytes: 23, sha256: 'b'.repeat(64), content: 'hidden current source' },
  },
};

beforeEach(() => {
  jest.resetAllMocks();
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'repodoctor-verify-route-'));
  VALID_BODY.workspacePath = workspacePath;
  process.env.ROUTE_TEST_API_KEY = 'route-test-secret';
  verifyTreatment.mockResolvedValue(PASSED_RESULT);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(workspacePath, { recursive: true, force: true });
  delete process.env.ROUTE_TEST_API_KEY;
  jest.restoreAllMocks();
});

function postVerify(body) {
  return request(app).post('/api/verify').send(body);
}

describe('POST /api/verify', () => {
  test('delegates safe verification context and returns a passed result', async () => {
    const response = await postVerify(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('passed');
    expect(verifyTreatment).toHaveBeenCalledTimes(1);
    expect(verifyTreatment).toHaveBeenCalledWith({
      workspacePath,
      changedFiles: CHANGED_FILES,
      treatmentResult: {
        status: 'applied',
        changedFiles: CHANGED_FILES,
        beforeContent: TREATMENT_RESULT.beforeContent,
      },
      projectInfo: PROJECT_INFO,
    });
  });

  test('returns a normalized failed verification result', async () => {
    verifyTreatment.mockResolvedValue({
      ...PASSED_RESULT,
      status: 'failed',
      checksRun: ['node --test'],
      passedChecks: [],
      failedChecks: [{ check: 'node --test', exitCode: 1, output: 'Assertion failed.' }],
      verificationMessage: 'One or more checks failed.',
    });

    const response = await postVerify(VALID_BODY);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('failed');
    expect(response.body.failedChecks[0].exitCode).toBe(1);
  });

  test('rejects malformed request bodies before calling the service', async () => {
    const response = await postVerify([]);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_VERIFICATION_REQUEST');
    expect(verifyTreatment).not.toHaveBeenCalled();
  });

  test('propagates unsafe workspace errors using the AppError contract', async () => {
    verifyTreatment.mockRejectedValue(new AppError('UNSAFE_WORKSPACE', 400, 'outside path detail'));

    const response = await postVerify(VALID_BODY);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: 'UNSAFE_WORKSPACE', message: 'The workspace is outside the permitted verification area.' },
    });
  });

  test('rejects a missing treatment result', async () => {
    const { treatmentResult: _treatmentResult, ...body } = VALID_BODY;

    const response = await postVerify(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_VERIFICATION_REQUEST');
    expect(verifyTreatment).not.toHaveBeenCalled();
  });

  test('rejects arbitrary command fields and command-like project information', async () => {
    const topLevelCommand = await postVerify({ ...VALID_BODY, command: 'rm -rf /' });
    expect(topLevelCommand.status).toBe(400);
    const projectCommand = await postVerify({
      ...VALID_BODY,
      projectInfo: { ...PROJECT_INFO, command: 'node arbitrary.js' },
    });

    expect(projectCommand.status).toBe(400);
    expect(verifyTreatment).not.toHaveBeenCalled();
  });

  test('propagates deterministic verification service failures safely', async () => {
    verifyTreatment.mockRejectedValue(new AppError(
      'UNSUPPORTED_VERIFICATION_COMMAND', 400, 'provider or filesystem secret detail'
    ));

    const response = await postVerify(VALID_BODY);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNSUPPORTED_VERIFICATION_COMMAND');
    expect(response.body.error.message).not.toContain('secret');
  });

  test('does not return source contents from before state, current state, or treatment changes', async () => {
    const response = await postVerify(VALID_BODY);
    const json = JSON.stringify(response.body);

    expect(response.body.beforeState['src/changed.js']).toEqual({
      exists: true, sizeBytes: 22, sha256: 'a'.repeat(64),
    });
    expect(json).not.toContain('source before treatment');
    expect(json).not.toContain('source after treatment');
    expect(json).not.toContain('hidden before source');
    expect(json).not.toContain('hidden current source');
  });

  test('does not return absolute filesystem paths', async () => {
    const response = await postVerify(VALID_BODY);
    const json = JSON.stringify(response.body);

    expect(json).not.toContain(workspacePath);
    expect(json).not.toContain('K:\\server\\private-workspace');
    expect(response.body.changedFiles).toEqual(CHANGED_FILES);
  });

  test('redacts credential values from verification output', async () => {
    const response = await postVerify(VALID_BODY);

    expect(JSON.stringify(response.body)).not.toContain('route-test-secret');
    expect(response.body.output).toContain('[redacted]');
  });
});