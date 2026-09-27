'use strict';

const { Router } = require('express');
const { applyTreatment } = require('../services/treatmentService');
const AppError = require('../services/AppError');

const router = Router();

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRequest(body) {
  if (!isRecord(body)) {
    throw new AppError('INVALID_TREATMENT_REQUEST', 400, 'A treatment request object is required.');
  }

  const findingInputs = [body.finding, body.selectedFinding, body.findings]
    .filter((value) => value !== undefined);
  if (findingInputs.length !== 1) {
    throw new AppError('INVALID_TREATMENT_REQUEST', 400, 'Supply exactly one selected finding.');
  }

  const [findingInput] = findingInputs;
  if (Array.isArray(findingInput)) {
    if (findingInput.length !== 1) {
      throw new AppError('INVALID_TREATMENT_REQUEST', 400, 'Only one finding may be treated at a time.');
    }
  }
  const finding = Array.isArray(findingInput) ? findingInput[0] : findingInput;
  if (!isRecord(finding)) {
    throw new AppError('INVALID_TREATMENT_REQUEST', 400, 'A single selected finding object is required.');
  }

  if (!isRecord(body.prescription)) {
    throw new AppError('INVALID_TREATMENT_REQUEST', 400, 'A single prescription object is required.');
  }
  if (body.approved !== true || (body.prescription.approved != null && body.prescription.approved !== true)) {
    throw new AppError(
      'PRESCRIPTION_NOT_APPROVED',
      400,
      'The prescription must be explicitly approved before treatment can proceed.'
    );
  }
  if (typeof body.workspacePath !== 'string' || !body.workspacePath.trim()) {
    throw new AppError('INVALID_TREATMENT_REQUEST', 400, 'A controlled workspace path is required.');
  }
  if (!isRecord(body.scanResult)) {
    throw new AppError('INVALID_TREATMENT_REQUEST', 400, 'Structured scan context is required.');
  }

  return {
    finding,
    prescription: { ...body.prescription, approved: true },
    workspacePath: body.workspacePath,
    scanResult: body.scanResult,
  };
}

function safeErrorMessage(error) {
  if (error.code === 'UNSAFE_PATH') return 'The requested workspace or file path is not permitted.';
  if (error.code === 'FILESYSTEM_ERROR') return 'The workspace could not be read or updated.';
  return error.message;
}

router.post('/', async (req, res) => {
  try {
    const input = validateRequest(req.body);
    const result = await applyTreatment(input);

    if (!isRecord(result) || !['applied', 'no_changes'].includes(result.status) || !Array.isArray(result.changedFiles)) {
      throw new AppError('INVALID_TREATMENT_RESULT', 502, 'The treatment service returned an invalid result.');
    }

    const treatmentResult = {
      status: result.status,
      changedFiles: result.changedFiles.filter((file) => typeof file === 'string'),
    };

    return res.status(200).json({
      scanId: input.scanResult.scanId ?? null,
      owner: input.scanResult.owner ?? null,
      repo: input.scanResult.repo ?? null,
      treatmentResult,
      changedFiles: treatmentResult.changedFiles,
      implementationStatus: treatmentResult.status,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.httpStatus).json({
        error: { code: err.code, message: safeErrorMessage(err) },
      });
    }
    console.error('[treat route] unexpected error:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  }
});

module.exports = router;