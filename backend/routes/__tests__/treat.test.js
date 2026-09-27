'use strict';

const request = require('supertest');

jest.mock('../../services/treatmentService');

const { applyTreatment } = require('../../services/treatmentService');
const AppError = require('../../services/AppError');
const app = require('../../app');

const FINDING = {
  title: 'Limited tests',
  category: 'Testing',
  severity: 'High',
  evidence: 'One test file was detected.',
  affectedPath: 'tests/example.test.js',
  explanation: 'Sparse tests make changes harder to verify.',
};

const PRESCRIPTION = {
  title: 'Expand test coverage',
  reason: 'Important behavior has limited test coverage.',
  expectedOutcome: 'More behavior is covered by automated tests.',
  affectedPaths: ['tests/example.test.js'],
  treatmentSteps: ['Add focused tests.'],
  verificationPlan: 'Run the test suite.',
  riskNotes: null,
  approved: true,
};

const SCAN_RESULT = {
  scanId: 'scan-123',
  owner: 'acme',
  repo: 'widget',
  defaultBranch: 'main',
  healthScore: { overall: 60 },
  structure: { sourceFileCount: 8 },
  testingSignals: { testFileCount: 1, testFilePaths: ['tests/example.test.js'] },
  docSignals: { readmePaths: ['README.md'] },
  qualitySignals: { analyzedFileCount: 8 },
  dependencySignals: { hasPackageJson: true },
};

const VALID_BODY = {
  finding: FINDING,
  prescription: PRESCRIPTION,
  approved: true,
  workspacePath: 'K:\\controlled-workspace',
  scanResult: SCAN_RESULT,
};

const SERVICE_RESULT = {
  status: 'applied',
  workspacePath: 'K:\\controlled-workspace',
  changedFiles: ['tests/example.test.js'],
  beforeContent: { 'tests/example.test.js': 'old file contents' },
  proposedChanges: [{ relativePath: 'tests/example.test.js', content: 'new file contents' }],
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function postTreat(body) {
  return request(app).post('/api/treat').send(body);
}

describe('POST /api/treat', () => {
  test('successfully delegates an approved treatment request', async () => {
    applyTreatment.mockResolvedValue(SERVICE_RESULT);

    const response = await postTreat(VALID_BODY);

    expect(response.status).toBe(200);
    expect(applyTreatment).toHaveBeenCalledTimes(1);
    expect(applyTreatment).toHaveBeenCalledWith({
      finding: FINDING,
      prescription: PRESCRIPTION,
      workspacePath: VALID_BODY.workspacePath,
      scanResult: SCAN_RESULT,
    });
  });

  test('rejects a missing finding', async () => {
    const { finding: _finding, ...body } = VALID_BODY;

    const response = await postTreat(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_TREATMENT_REQUEST');
    expect(applyTreatment).not.toHaveBeenCalled();
  });

  test('rejects multiple findings', async () => {
    const response = await postTreat({ ...VALID_BODY, finding: [FINDING, FINDING] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_TREATMENT_REQUEST');
    expect(applyTreatment).not.toHaveBeenCalled();
  });

  test('rejects a missing prescription', async () => {
    const { prescription: _prescription, ...body } = VALID_BODY;

    const response = await postTreat(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_TREATMENT_REQUEST');
    expect(applyTreatment).not.toHaveBeenCalled();
  });

  test('rejects a prescription that is not approved', async () => {
    const response = await postTreat({
      ...VALID_BODY,
      approved: false,
      prescription: { ...PRESCRIPTION, approved: false },
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PRESCRIPTION_NOT_APPROVED');
    expect(applyTreatment).not.toHaveBeenCalled();
  });

  test('rejects an invalid treatment request body', async () => {
    const response = await request(app)
      .post('/api/treat')
      .set('Content-Type', 'application/json')
      .send('');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_TREATMENT_REQUEST');
    expect(applyTreatment).not.toHaveBeenCalled();
  });

  test('preserves service unsafe-path errors without exposing path details', async () => {
    applyTreatment.mockRejectedValue(new AppError('UNSAFE_PATH', 400, 'Traversal at K:\\secret\\path'));

    const response = await postTreat(VALID_BODY);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNSAFE_PATH');
    expect(response.body.error.message).not.toContain('K:\\secret');
  });

  test('preserves provider failure errors', async () => {
    applyTreatment.mockRejectedValue(new AppError('AI_PROVIDER_ERROR', 502, 'The treatment provider could not complete the request.'));

    const response = await postTreat(VALID_BODY);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_PROVIDER_ERROR');
  });

  test('preserves invalid treatment response errors', async () => {
    applyTreatment.mockRejectedValue(new AppError('AI_INVALID_RESPONSE', 502, 'The treatment provider returned an invalid response.'));

    const response = await postTreat(VALID_BODY);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_INVALID_RESPONSE');
  });

  test('preserves filesystem failures without exposing filesystem details', async () => {
    applyTreatment.mockRejectedValue(new AppError('FILESYSTEM_ERROR', 500, 'Could not write K:\\private\\file.js'));

    const response = await postTreat(VALID_BODY);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('FILESYSTEM_ERROR');
    expect(response.body.error.message).not.toContain('K:\\private');
  });

  test('returns the structured response without exposing file contents or claiming verification', async () => {
    applyTreatment.mockResolvedValue(SERVICE_RESULT);

    const response = await postTreat(VALID_BODY);

    expect(response.body).toMatchObject({
      scanId: 'scan-123',
      owner: 'acme',
      repo: 'widget',
      treatmentResult: { status: 'applied', changedFiles: ['tests/example.test.js'] },
      changedFiles: ['tests/example.test.js'],
      implementationStatus: 'applied',
    });
    expect(response.body).not.toHaveProperty('verified');
    expect(JSON.stringify(response.body)).not.toContain('old file contents');
    expect(JSON.stringify(response.body)).not.toContain('new file contents');
    expect(JSON.stringify(response.body)).not.toContain(VALID_BODY.workspacePath);
  });

  test('returns a safe unexpected-error response', async () => {
    applyTreatment.mockRejectedValue(new Error('secret key and filesystem path K:\\secret'));

    const response = await postTreat(VALID_BODY);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).not.toContain('secret');
    expect(response.body.error.message).not.toContain('K:\\secret');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });
});