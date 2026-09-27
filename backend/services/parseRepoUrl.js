'use strict';

const AppError = require('./AppError');

/**
 * GitHub identifier rules (owner and repo names).
 *
 * GitHub allows: alphanumeric characters, hyphens (-), underscores (_), and dots (.)
 * with the following constraints:
 *   - 1 to 100 characters
 *   - cannot start or end with a hyphen
 *   - cannot contain consecutive dots (..)
 *
 * This regex is intentionally conservative — anything rejected here would
 * either produce a 404 from GitHub or is clearly not a real repository name.
 */
const SEGMENT_RE = /^(?!-)[a-zA-Z0-9._-]{1,100}(?<!-)$/;

/**
 * parseRepoUrl(repoUrl)
 *
 * Validates and parses a GitHub repository URL.
 * Returns { owner, repo } on success.
 * Throws AppError (MISSING_URL or INVALID_URL) on any invalid input.
 *
 * Accepted forms:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/
 *   https://github.com/owner/repo.git
 *
 * Rejected forms:
 *   anything non-string or empty
 *   http:// (insecure)
 *   SSH git@ URLs
 *   Any host other than github.com
 *   Sub-paths (e.g. /owner/repo/tree/main)
 *   Query strings or fragments
 *   Blank owner or repo segments
 *   Segments with disallowed characters
 *   Consecutive dots in any segment
 *
 * @param  {*}      repoUrl - Value from the request body
 * @returns {{ owner: string, repo: string }}
 * @throws {AppError}
 */
function parseRepoUrl(repoUrl) {
  // ── 1. Presence check ────────────────────────────────────────────────────────
  if (repoUrl == null || (typeof repoUrl === 'string' && repoUrl.trim() === '')) {
    throw new AppError(
      'MISSING_URL',
      400,
      'A repository URL is required.'
    );
  }

  if (typeof repoUrl !== 'string') {
    throw new AppError(
      'INVALID_URL',
      400,
      'The repository URL must be a string.'
    );
  }

  // ── 2. Parse with the built-in URL constructor ────────────────────────────────
  let parsed;
  try {
    parsed = new URL(repoUrl.trim());
  } catch {
    throw new AppError(
      'INVALID_URL',
      400,
      'The repository URL is not a valid URL.'
    );
  }

  // ── 3. Protocol must be https ─────────────────────────────────────────────────
  if (parsed.protocol !== 'https:') {
    throw new AppError(
      'INVALID_URL',
      400,
      'The repository URL must use HTTPS (https://github.com/owner/repo).'
    );
  }

  // ── 4. Host must be exactly github.com ───────────────────────────────────────
  if (parsed.hostname !== 'github.com') {
    throw new AppError(
      'INVALID_URL',
      400,
      'Only GitHub repositories are supported (github.com).'
    );
  }

  // ── 5. No query string or fragment ───────────────────────────────────────────
  if (parsed.search || parsed.hash) {
    throw new AppError(
      'INVALID_URL',
      400,
      'The repository URL must not contain a query string or fragment.'
    );
  }

  // ── 6. Normalise pathname: strip trailing slash and .git suffix ───────────────
  let pathname = parsed.pathname;
  if (pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  if (pathname.endsWith('.git')) {
    pathname = pathname.slice(0, -4);
  }
  // Strip any remaining trailing slash after .git removal
  if (pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // ── 7. Split into segments and verify exactly owner + repo ───────────────────
  // pathname starts with '/', so split produces ['', owner, repo, ...extra]
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length !== 2) {
    throw new AppError(
      'INVALID_URL',
      400,
      'The repository URL must point to a repository root: https://github.com/owner/repo'
    );
  }

  const [owner, repo] = segments;

  // ── 8. Validate owner and repo character rules ───────────────────────────────
  if (!SEGMENT_RE.test(owner)) {
    throw new AppError(
      'INVALID_URL',
      400,
      `Invalid repository owner name: "${owner}".`
    );
  }

  if (!SEGMENT_RE.test(repo)) {
    throw new AppError(
      'INVALID_URL',
      400,
      `Invalid repository name: "${repo}".`
    );
  }

  // ── 9. Reject consecutive dots in either segment ─────────────────────────────
  if (owner.includes('..') || repo.includes('..')) {
    throw new AppError(
      'INVALID_URL',
      400,
      'Repository owner and name must not contain consecutive dots.'
    );
  }

  return { owner, repo };
}

module.exports = parseRepoUrl;
