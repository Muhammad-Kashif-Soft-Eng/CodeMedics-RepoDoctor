'use strict';

const AppError = require('./AppError');

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

/**
 * Build the headers object for a GitHub API request.
 * The Authorization header is included only when GITHUB_TOKEN is set.
 *
 * @returns {Record<string, string>}
 */
function buildHeaders() {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Determine whether a GitHub 403 response is a rate-limit error.
 * GitHub signals rate limiting via:
 *   - x-ratelimit-remaining: 0  header, or
 *   - a body message containing "rate limit"
 *
 * @param {Response}  res  - The fetch Response object
 * @param {object}    body - The parsed JSON body (may be null)
 * @returns {boolean}
 */
function isRateLimited(res, body) {
  if (res.headers.get('x-ratelimit-remaining') === '0') return true;
  if (body && typeof body.message === 'string') {
    return body.message.toLowerCase().includes('rate limit');
  }
  return false;
}

/**
 * getRepoInfo(owner, repo)
 *
 * Fetches minimal public metadata for a GitHub repository.
 * Uses the authenticated rate limit (5 000 req/hr) when GITHUB_TOKEN is set,
 * otherwise falls back to 60 req/hr unauthenticated.
 *
 * @param  {string} owner - Repository owner login
 * @param  {string} repo  - Repository name
 * @returns {Promise<{
 *   owner: string,
 *   repo: string,
 *   defaultBranch: string,
 *   description: string|null,
 *   language: string|null,
 *   stars: number,
 *   isPrivate: boolean
 * }>}
 * @throws {AppError} on any expected failure
 */
async function getRepoInfo(owner, repo) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;

  let res;
  try {
    res = await fetch(url, { headers: buildHeaders() });
  } catch (networkErr) {
    throw new AppError(
      'GITHUB_UNAVAILABLE',
      502,
      'Could not reach GitHub. Please check your connection and try again.'
    );
  }

  // ── Parse body for all non-2xx paths that carry a message ────────────────────
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Body may be empty on some 5xx responses — tolerate parse failure
  }

  // ── 200 — success ────────────────────────────────────────────────────────────
  if (res.status === 200) {
    return {
      owner:         body.owner?.login   ?? owner,
      repo:          body.name           ?? repo,
      defaultBranch: body.default_branch ?? 'main',
      description:   body.description    ?? null,
      language:      body.language       ?? null,
      stars:         body.stargazers_count ?? 0,
      isPrivate:     body.private        ?? false,
    };
  }

  // ── 404 — repo not found (or private + unauthenticated) ──────────────────────
  if (res.status === 404) {
    throw new AppError(
      'REPO_NOT_FOUND',
      404,
      `Repository "${owner}/${repo}" was not found or is not publicly accessible.`
    );
  }

  // ── 403 — rate limited or private/restricted ─────────────────────────────────
  if (res.status === 403) {
    if (isRateLimited(res, body)) {
      throw new AppError(
        'GITHUB_RATE_LIMITED',
        429,
        'GitHub API rate limit reached. Add a GITHUB_TOKEN to increase the limit, or wait before retrying.'
      );
    }
    throw new AppError(
      'REPO_PRIVATE',
      403,
      `Access to "${owner}/${repo}" was denied. The repository may be private or restricted.`
    );
  }

  // ── 429 — explicit rate limit response ───────────────────────────────────────
  if (res.status === 429) {
    throw new AppError(
      'GITHUB_RATE_LIMITED',
      429,
      'GitHub API rate limit reached. Please wait before retrying.'
    );
  }

  // ── 5xx — GitHub server error ────────────────────────────────────────────────
  if (res.status >= 500 && res.status < 600) {
    throw new AppError(
      'GITHUB_UNAVAILABLE',
      502,
      'GitHub is currently unavailable. Please try again later.'
    );
  }

  // ── Unexpected status ────────────────────────────────────────────────────────
  throw new AppError(
    'GITHUB_UNAVAILABLE',
    502,
    `Unexpected response from GitHub (HTTP ${res.status}).`
  );
}

/**
 * getRepoTree(owner, repo, defaultBranch)
 *
 * Fetches the recursive file tree for a GitHub repository using the Git Trees API.
 * Returns a normalised representation containing only the fields needed by the
 * scanner stage — path, type, and size (when provided).
 *
 * GitHub may mark the response as truncated when the tree exceeds ~100 000 entries.
 * This is surfaced in the return value so the caller can decide how to handle it.
 *
 * @param  {string} owner         - Repository owner login
 * @param  {string} repo          - Repository name
 * @param  {string} defaultBranch - Branch/ref to fetch (e.g. 'main', 'master')
 * @returns {Promise<{
 *   truncated: boolean,
 *   tree: Array<{ path: string, type: string, size: number|undefined }>
 * }>}
 * @throws {AppError} on any expected failure
 */
async function getRepoTree(owner, repo, defaultBranch) {
  // encodeURIComponent handles branch names that contain '/' (e.g. 'release/1.0')
  const encodedBranch = encodeURIComponent(defaultBranch);
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodedBranch}?recursive=1`;

  let res;
  try {
    res = await fetch(url, { headers: buildHeaders() });
  } catch {
    throw new AppError(
      'GITHUB_UNAVAILABLE',
      502,
      'Could not reach GitHub. Please check your connection and try again.'
    );
  }

  // ── Parse body (needed for both success and error paths) ─────────────────────
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Tolerate empty body on some 5xx responses
  }

  // ── 200 — success ────────────────────────────────────────────────────────────
  if (res.status === 200) {
    const rawTree = Array.isArray(body?.tree) ? body.tree : [];
    return {
      truncated: body?.truncated === true,
      tree: rawTree.map((entry) => {
        const item = { path: entry.path, type: entry.type };
        // size is only present on blob (file) entries; omit it for trees/commits
        if (typeof entry.size === 'number') {
          item.size = entry.size;
        }
        return item;
      }),
    };
  }

  // ── 404 ───────────────────────────────────────────────────────────────────────
  if (res.status === 404) {
    throw new AppError(
      'REPO_NOT_FOUND',
      404,
      `Repository tree for "${owner}/${repo}" was not found.`
    );
  }

  // ── 403 — rate limited or restricted ─────────────────────────────────────────
  if (res.status === 403) {
    if (isRateLimited(res, body)) {
      throw new AppError(
        'GITHUB_RATE_LIMITED',
        429,
        'GitHub API rate limit reached. Add a GITHUB_TOKEN to increase the limit, or wait before retrying.'
      );
    }
    throw new AppError(
      'REPO_PRIVATE',
      403,
      `Access to "${owner}/${repo}" was denied. The repository may be private or restricted.`
    );
  }

  // ── 429 — explicit rate limit ─────────────────────────────────────────────────
  if (res.status === 429) {
    throw new AppError(
      'GITHUB_RATE_LIMITED',
      429,
      'GitHub API rate limit reached. Please wait before retrying.'
    );
  }

  // ── 5xx — GitHub server error ─────────────────────────────────────────────────
  if (res.status >= 500 && res.status < 600) {
    throw new AppError(
      'GITHUB_UNAVAILABLE',
      502,
      'GitHub is currently unavailable. Please try again later.'
    );
  }

  // ── Unexpected status ─────────────────────────────────────────────────────────
  throw new AppError(
    'GITHUB_UNAVAILABLE',
    502,
    `Unexpected response from GitHub (HTTP ${res.status}).`
  );
}

/**
 * Maximum file size in bytes that getFileContent will decode.
 * Files reported larger than this by the tree stage are skipped
 * (caller receives null) to avoid wasting rate-limit budget on
 * minified bundles, generated files, or vendored code.
 *
 * 100 KB comfortably covers any real source file or README while
 * excluding almost all build artefacts.
 */
const MAX_CONTENT_BYTES = 100 * 1024; // 100 KB

/**
 * getFileContent(owner, repo, path, ref)
 *
 * Retrieves the decoded text content of a single file using the
 * GitHub Contents API.  Returns null for files that GitHub reports
 * as binary (non-base64 encoding) or that exceed MAX_CONTENT_BYTES.
 *
 * The caller is expected to have already checked the file size from
 * the tree result before calling this function.  The size guard here
 * is a safety net, not the primary filter.
 *
 * @param  {string} owner - Repository owner login
 * @param  {string} repo  - Repository name
 * @param  {string} path  - File path relative to repo root
 * @param  {string} ref   - Branch or commit ref (e.g. 'main')
 * @returns {Promise<{ path: string, content: string, size: number }|null>}
 *          null when the file is binary or oversized
 * @throws {AppError} on network / API errors
 */
async function getFileContent(owner, repo, path, ref) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

  let res;
  try {
    res = await fetch(url, { headers: buildHeaders() });
  } catch {
    throw new AppError(
      'GITHUB_UNAVAILABLE',
      502,
      'Could not reach GitHub. Please check your connection and try again.'
    );
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // tolerate empty body on some 5xx responses
  }

  // ── 200 — success ────────────────────────────────────────────────────────────
  if (res.status === 200) {
    // GitHub only supports base64 for text files via the Contents API
    if (body?.encoding !== 'base64' || typeof body?.content !== 'string') {
      return null; // binary or unexpected encoding — skip silently
    }

    const size = typeof body.size === 'number' ? body.size : 0;
    if (size > MAX_CONTENT_BYTES) {
      return null; // oversized — skip silently
    }

    // GitHub wraps base64 lines with '\n'; strip them before decoding
    const decoded = Buffer.from(body.content.replace(/\n/g, ''), 'base64').toString('utf8');
    return { path, content: decoded, size };
  }

  // ── 404 ───────────────────────────────────────────────────────────────────────
  if (res.status === 404) {
    throw new AppError(
      'REPO_NOT_FOUND',
      404,
      `File "${path}" was not found in "${owner}/${repo}".`
    );
  }

  // ── 403 ───────────────────────────────────────────────────────────────────────
  if (res.status === 403) {
    if (isRateLimited(res, body)) {
      throw new AppError(
        'GITHUB_RATE_LIMITED',
        429,
        'GitHub API rate limit reached. Add a GITHUB_TOKEN to increase the limit, or wait before retrying.'
      );
    }
    throw new AppError(
      'REPO_PRIVATE',
      403,
      `Access to "${path}" in "${owner}/${repo}" was denied.`
    );
  }

  // ── 429 ───────────────────────────────────────────────────────────────────────
  if (res.status === 429) {
    throw new AppError(
      'GITHUB_RATE_LIMITED',
      429,
      'GitHub API rate limit reached. Please wait before retrying.'
    );
  }

  // ── 5xx ───────────────────────────────────────────────────────────────────────
  if (res.status >= 500 && res.status < 600) {
    throw new AppError(
      'GITHUB_UNAVAILABLE',
      502,
      'GitHub is currently unavailable. Please try again later.'
    );
  }

  throw new AppError(
    'GITHUB_UNAVAILABLE',
    502,
    `Unexpected response from GitHub (HTTP ${res.status}).`
  );
}

module.exports = { getRepoInfo, getRepoTree, getFileContent, MAX_CONTENT_BYTES };
