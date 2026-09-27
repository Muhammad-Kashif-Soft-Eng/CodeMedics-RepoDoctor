'use strict';

const { Router } = require('express');
const { diagnoseRepository } = require('../services/diagnosisService');
const AppError = require('../services/AppError');

const router = Router();
const REQUIRED_EVIDENCE_GROUPS = [
  'healthScore',
  'structure',
  'testingSignals',
  'docSignals',
  'qualitySignals',
  'dependencySignals',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateScanEvidence(body) {
  if (!isRecord(body)) {
    throw new AppError('INVALID_SCAN_EVIDENCE', 400, 'Structured scan evidence is required.');
  }

  const hasEvidenceGroups = REQUIRED_EVIDENCE_GROUPS.every((key) => isRecord(body[key]));
  const hasValidIdentity = ['owner', 'repo', 'defaultBranch'].every(
    (key) => body[key] == null || (typeof body[key] === 'string' && body[key].trim().length > 0)
  );

  if (!hasEvidenceGroups || !hasValidIdentity) {
    throw new AppError('INVALID_SCAN_EVIDENCE', 400, 'Structured scan evidence is incomplete or invalid.');
  }
}

/**
 * POST /api/diagnose
 *
 * Body: the full scan-result payload returned by POST /api/scan
 *   (owner, repo, defaultBranch, scanId, structure, testingSignals,
 *    docSignals, qualitySignals, dependencySignals, healthScore, …)
 *
 * 1. Validate that a non-null object body was supplied.
 * 2. Delegate to diagnosisService.diagnoseRepository().
 * 3. Return structured findings alongside repository identity.
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    validateScanEvidence(body);

    const findings = await diagnoseRepository(body);

    return res.status(200).json({
      scanId: body.scanId ?? null,
      owner: body.owner ?? null,
      repo: body.repo ?? null,
      defaultBranch: body.defaultBranch ?? null,
      findings: findings.slice(0, 5),
    });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.httpStatus).json({
        error: { code: err.code, message: err.message },
      });
    }
    // Unexpected error — do not leak internals
    console.error('[diagnose route] unexpected error:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  }
});

module.exports = router;
