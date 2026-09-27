'use strict';

const { Router } = require('express');
const parseRepoUrl       = require('../services/parseRepoUrl');
const { getRepoInfo }    = require('../services/githubClient');
const { runScan }        = require('../services/scannerService');
const AppError           = require('../services/AppError');

const router = Router();

/**
 * POST /api/scan
 *
 * Body: { repoUrl: string }
 *
 * 1. Validate and parse the repository URL.
 * 2. Retrieve repository metadata.
 * 3. Delegate the full scan pipeline to scannerService.runScan().
 * 4. Return the structured scan result.
 */
router.post('/', async (req, res) => {
  try {
    // ── 1. Parse and validate URL ───────────────────────────────────────────────
    const { owner, repo } = parseRepoUrl(req.body?.repoUrl);

    // ── 2. Confirm repository existence via GitHub API ──────────────────────────
    const repoInfo = await getRepoInfo(owner, repo);

    // ── 3. Run full scan pipeline ───────────────────────────────────────────────
    const result = await runScan({
      ...repoInfo,
      repoUrl: req.body.repoUrl.trim(),
    });

    // ── 4. Respond ──────────────────────────────────────────────────────────────
    return res.status(200).json(result);
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
