'use strict';

const { Router } = require('express');
const { prescribeForFinding } = require('../services/prescriptionService');
const AppError                = require('../services/AppError');

const router = Router();

/**
 * POST /api/prescribe
 *
 * Body:
 *   {
 *     selectedFinding: { title, category, severity, evidence, affectedPath, explanation },
 *     // scan-result context fields (owner, repo, defaultBranch, scanId,
 *     //   structure, testingSignals, docSignals, qualitySignals,
 *     //   dependencySignals, healthScore, …)
 *     owner, repo, scanId, defaultBranch, healthScore, structure,
 *     testingSignals, docSignals, qualitySignals, dependencySignals
 *   }
 *
 * 1. Validate that the body is a plain object.
 * 2. Validate that exactly one finding object is present.
 * 3. Delegate to prescriptionService.prescribeForFinding().
 * 4. Return the normalised prescription alongside repository identity.
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    // ── 1. Body must be a plain object ─────────────────────────────────────────
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AppError('INVALID_FINDING', 400, 'A single selected finding object is required.');
    }

    // ── 2. Exactly one finding — reject arrays and missing values ───────────────
    if (Array.isArray(body.selectedFinding)) {
      throw new AppError(
        'INVALID_FINDING',
        400,
        'Only one finding may be selected. Supply a single finding object, not an array.'
      );
    }

    if (!body.selectedFinding || typeof body.selectedFinding !== 'object') {
      throw new AppError('INVALID_FINDING', 400, 'A single selected finding object is required.');
    }

    // ── 3. Delegate — service validates finding fields and evidence deeply ───────
    // The body doubles as the scanResult context (same shape as /api/scan response).
    const prescription = await prescribeForFinding(body, body.selectedFinding);

    // ── 4. Respond ──────────────────────────────────────────────────────────────
    return res.status(200).json({
      scanId:       body.scanId       ?? null,
      owner:        body.owner        ?? null,
      repo:         body.repo         ?? null,
      prescription,
    });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.httpStatus).json({
        error: { code: err.code, message: err.message },
      });
    }
    // Unexpected error — do not leak internals
    console.error('[prescribe route] unexpected error:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  }
});

module.exports = router;
