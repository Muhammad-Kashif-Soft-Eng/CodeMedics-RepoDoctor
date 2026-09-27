'use strict';

const parseRepoUrl = require('../parseRepoUrl');
const AppError     = require('../AppError');

// ── Helper ────────────────────────────────────────────────────────────────────
/**
 * Assert that parseRepoUrl(input) throws an AppError with the given code.
 */
function expectError(input, expectedCode) {
  expect(() => parseRepoUrl(input)).toThrow(AppError);
  try {
    parseRepoUrl(input);
  } catch (err) {
    expect(err.code).toBe(expectedCode);
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
    expect(typeof err.httpStatus).toBe('number');
  }
}

// ── MISSING_URL ───────────────────────────────────────────────────────────────
describe('parseRepoUrl — missing/empty input', () => {
  test('throws MISSING_URL for undefined', () => {
    expectError(undefined, 'MISSING_URL');
  });

  test('throws MISSING_URL for null', () => {
    expectError(null, 'MISSING_URL');
  });

  test('throws MISSING_URL for empty string', () => {
    expectError('', 'MISSING_URL');
  });

  test('throws MISSING_URL for whitespace-only string', () => {
    expectError('   ', 'MISSING_URL');
  });
});

// ── INVALID_URL — non-string types ───────────────────────────────────────────
describe('parseRepoUrl — non-string types', () => {
  test('throws INVALID_URL for a number', () => {
    expectError(42, 'INVALID_URL');
  });

  test('throws INVALID_URL for an object', () => {
    expectError({}, 'INVALID_URL');
  });

  test('throws INVALID_URL for an array', () => {
    expectError([], 'INVALID_URL');
  });
});

// ── INVALID_URL — protocol ───────────────────────────────────────────────────
describe('parseRepoUrl — wrong protocol', () => {
  test('throws INVALID_URL for http://', () => {
    expectError('http://github.com/owner/repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for git@github.com SSH form', () => {
    expectError('git@github.com:owner/repo.git', 'INVALID_URL');
  });

  test('throws INVALID_URL for a bare string without protocol', () => {
    expectError('github.com/owner/repo', 'INVALID_URL');
  });
});

// ── INVALID_URL — wrong host ─────────────────────────────────────────────────
describe('parseRepoUrl — wrong host', () => {
  test('throws INVALID_URL for gitlab.com', () => {
    expectError('https://gitlab.com/owner/repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for bitbucket.org', () => {
    expectError('https://bitbucket.org/owner/repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for a subdomain of github.com', () => {
    expectError('https://raw.github.com/owner/repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for github.com.evil.example', () => {
    expectError('https://github.com.evil.example/owner/repo', 'INVALID_URL');
  });
});

// ── INVALID_URL — sub-paths ──────────────────────────────────────────────────
describe('parseRepoUrl — sub-paths', () => {
  test('throws INVALID_URL for /owner/repo/tree/main', () => {
    expectError('https://github.com/owner/repo/tree/main', 'INVALID_URL');
  });

  test('throws INVALID_URL for /owner/repo/blob/main/README.md', () => {
    expectError('https://github.com/owner/repo/blob/main/README.md', 'INVALID_URL');
  });

  test('throws INVALID_URL for /owner only (no repo)', () => {
    expectError('https://github.com/owner', 'INVALID_URL');
  });

  test('throws INVALID_URL for root path only', () => {
    expectError('https://github.com/', 'INVALID_URL');
  });

  test('throws INVALID_URL for bare hostname', () => {
    expectError('https://github.com', 'INVALID_URL');
  });
});

// ── INVALID_URL — query string and fragment ───────────────────────────────────
describe('parseRepoUrl — query string and fragment', () => {
  test('throws INVALID_URL when query string is present', () => {
    expectError('https://github.com/owner/repo?tab=readme', 'INVALID_URL');
  });

  test('throws INVALID_URL when fragment is present', () => {
    expectError('https://github.com/owner/repo#readme', 'INVALID_URL');
  });
});

// ── INVALID_URL — bad segment characters ─────────────────────────────────────
describe('parseRepoUrl — invalid segment characters', () => {
  test('throws INVALID_URL for owner starting with hyphen', () => {
    expectError('https://github.com/-owner/repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for repo starting with hyphen', () => {
    expectError('https://github.com/owner/-repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for owner ending with hyphen', () => {
    expectError('https://github.com/owner-/repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for owner with consecutive dots', () => {
    expectError('https://github.com/ow..ner/repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for repo with consecutive dots', () => {
    expectError('https://github.com/owner/re..po', 'INVALID_URL');
  });

  test('throws INVALID_URL for owner with spaces', () => {
    expectError('https://github.com/ow ner/repo', 'INVALID_URL');
  });

  test('throws INVALID_URL for owner with special characters', () => {
    expectError('https://github.com/ow#ner/repo', 'INVALID_URL');
  });
});

// ── Success cases ─────────────────────────────────────────────────────────────
describe('parseRepoUrl — valid inputs', () => {
  test('parses a plain URL', () => {
    const result = parseRepoUrl('https://github.com/owner/repo');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  test('strips trailing slash', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  test('strips .git suffix', () => {
    const result = parseRepoUrl('https://github.com/owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  test('strips .git suffix and trailing slash', () => {
    const result = parseRepoUrl('https://github.com/owner/repo.git/');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  test('accepts hyphens in owner and repo', () => {
    const result = parseRepoUrl('https://github.com/my-org/my-repo');
    expect(result).toEqual({ owner: 'my-org', repo: 'my-repo' });
  });

  test('accepts underscores in repo name', () => {
    const result = parseRepoUrl('https://github.com/owner/my_repo');
    expect(result).toEqual({ owner: 'owner', repo: 'my_repo' });
  });

  test('accepts dots in owner (org name)', () => {
    const result = parseRepoUrl('https://github.com/my.org/repo');
    expect(result).toEqual({ owner: 'my.org', repo: 'repo' });
  });

  test('accepts numeric owner and repo', () => {
    const result = parseRepoUrl('https://github.com/123/456');
    expect(result).toEqual({ owner: '123', repo: '456' });
  });

  test('accepts mixed-case owner and repo', () => {
    const result = parseRepoUrl('https://github.com/MyOrg/MyRepo');
    expect(result).toEqual({ owner: 'MyOrg', repo: 'MyRepo' });
  });

  test('returned object has exactly owner and repo keys', () => {
    const result = parseRepoUrl('https://github.com/owner/repo');
    expect(Object.keys(result).sort()).toEqual(['owner', 'repo']);
  });

  test('does not make any network requests', () => {
    // Confirm the function is pure — jest would surface any fetch call
    // because fetch is not defined in the Node test environment unless polyfilled.
    // If this test passes, no network call was attempted.
    const spy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called in parseRepoUrl');
    });
    parseRepoUrl('https://github.com/owner/repo');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
