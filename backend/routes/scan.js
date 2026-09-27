'use strict';

const { Router } = require('express');
const parseRepoUrl           = require('../services/parseRepoUrl');
const { getRepoInfo }        = require('../services/githubClient');
const AppError               = require('../services/AppError');
const ScanResult             = require('../models/ScanResult');

const router = Router();

/**
 * POST /api/scan
 *
 * Body: { repoUrl: string }
 *
 * 1. Validate and parse the repository URL.
 * 2. Confirm the repository exists on GitHub.
 * 3. Persist an empty ScanResult document (signal fields populated later).
 * 4. Return the scanId and repository identity so the frontend can proceed.
 */
router.post('/', async (req, res) => {
  try {
    // ── 1. Parse and validate URL ───────────────────────────────────────────────
    // parseRepoUrl throws AppError(MISSING_URL) or AppError(INVALID_URL) on failure
    const { owner, repo } = parseRepoUrl(req.body?.repoUrl);

    // ── 2. Confirm repository existence via GitHub API ──────────────────────────
    // getRepoInfo throws AppError on 404 / 403 / rate-limit / network failure
    const repoInfo = await getRepoInfo(owner, repo);

    // ── 3. Persist an empty ScanResult ─────────────────────────────────────────
    // Signal fields default to {} and healthScore is zeroed.
    // Downstream scanner stages update this document by _id.
    const scanResult = await ScanResult.create({
      repoUrl:       req.body.repoUrl.trim(),
      owner:         repoInfo.owner,
      repo:          repoInfo.repo,
      defaultBranch: repoInfo.defaultBranch,
      healthScore: {
        testing:       0,
        documentation: 0,
        structure:     0,
        codeQuality:   0,
        dependencies:  0,
        overall:       0,
      },
    });

    // ── 4. Respond ──────────────────────────────────────────────────────────────
    return res.status(200).json({
      scanId:        scanResult._id,
      owner:         scanResult.owner,
      repo:          scanResult.repo,
      defaultBranch: scanResult.defaultBranch,
      repoUrl:       scanResult.repoUrl,
    });
  } catch (err) {
    // ── Error serialisation ─────────────────────────────────────────────────────
    if (err instanceof AppError) {
      return res.status(err.httpStatus).json({
        error: { code: err.code, message: err.message },
      });
    }
    // Unexpected error — do not leak internals
    console.error('[scan route] unexpected error:', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  }
});

module.exports = router;
