'use strict';

const { getRepoInfo } = require('../githubClient');
const AppError        = require('../AppError');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal fetch Response mock.
 *
 * @param {number}          status
 * @param {object|null}     body          - Will be returned by res.json()
 * @param {Record<string,string>} headers - Optional response headers
 */
function mockResponse(status, body = null, headers = {}) {
  return {
    status,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
    json: () =>
      body !== null
        ? Promise.resolve(body)
        : Promise.reject(new SyntaxError('Unexpected end of JSON input')),
  };
}

/** Minimal GitHub repo body that represents a public repository. */
const GITHUB_REPO_BODY = {
  owner:           { login: 'acme' },
  name:            'my-repo',
  default_branch:  'main',
  description:     'A test repo',
  language:        'JavaScript',
  stargazers_count: 42,
  private:         false,
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

let fetchSpy;

beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
  // Remove any token that might leak between tests
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.GITHUB_TOKEN;
});

// ── 1. Successful metadata mapping ───────────────────────────────────────────
describe('getRepoInfo — success', () => {
  test('returns the normalised metadata object on HTTP 200', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_REPO_BODY));

    const result = await getRepoInfo('acme', 'my-repo');

    expect(result).toEqual({
      owner:         'acme',
      repo:          'my-repo',
      defaultBranch: 'main',
      description:   'A test repo',
      language:      'JavaScript',
      stars:         42,
      isPrivate:     false,
    });
  });

  test('falls back gracefully when optional fields are null/absent', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(200, {
        owner:           { login: 'acme' },
        name:            'sparse-repo',
        default_branch:  'master',
        description:     null,
        language:        null,
        stargazers_count: 0,
        private:         false,
      })
    );

    const result = await getRepoInfo('acme', 'sparse-repo');

    expect(result.description).toBeNull();
    expect(result.language).toBeNull();
    expect(result.stars).toBe(0);
    expect(result.defaultBranch).toBe('master');
  });

  test('returns exactly the seven expected keys', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_REPO_BODY));

    const result = await getRepoInfo('acme', 'my-repo');

    expect(Object.keys(result).sort()).toEqual(
      ['defaultBranch', 'description', 'isPrivate', 'language', 'owner', 'repo', 'stars']
    );
  });
});

// ── 2. 404 — repository not found ────────────────────────────────────────────
describe('getRepoInfo — 404', () => {
  test('throws AppError REPO_NOT_FOUND on HTTP 404', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(404, { message: 'Not Found' })
    );

    await expect(getRepoInfo('acme', 'missing')).rejects.toThrow(AppError);

    try {
      await getRepoInfo('acme', 'missing');
    } catch (err) {
      expect(err.code).toBe('REPO_NOT_FOUND');
      expect(err.httpStatus).toBe(404);
    }
  });
});

// ── 3. Rate limiting ──────────────────────────────────────────────────────────
describe('getRepoInfo — rate limiting', () => {
  test('throws GITHUB_RATE_LIMITED when x-ratelimit-remaining is 0 on 403', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(
        403,
        { message: 'API rate limit exceeded for ...' },
        { 'x-ratelimit-remaining': '0' }
      )
    );

    try {
      await getRepoInfo('acme', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_RATE_LIMITED');
      expect(err.httpStatus).toBe(429);
    }
  });

  test('throws GITHUB_RATE_LIMITED when body message contains "rate limit" on 403', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(403, { message: 'API rate limit exceeded' })
    );

    try {
      await getRepoInfo('acme', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_RATE_LIMITED');
    }
  });

  test('throws GITHUB_RATE_LIMITED on explicit HTTP 429', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(429, { message: 'Too many requests' })
    );

    try {
      await getRepoInfo('acme', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_RATE_LIMITED');
      expect(err.httpStatus).toBe(429);
    }
  });
});

// ── 4. Private / restricted repository ───────────────────────────────────────
describe('getRepoInfo — private/restricted', () => {
  test('throws REPO_PRIVATE on 403 without rate-limit signals', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(403, { message: 'Must have push access to view collaborator activity' })
    );

    try {
      await getRepoInfo('acme', 'private-repo');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('REPO_PRIVATE');
      expect(err.httpStatus).toBe(403);
    }
  });
});

// ── 5. GitHub 5xx ─────────────────────────────────────────────────────────────
describe('getRepoInfo — 5xx server errors', () => {
  test('throws GITHUB_UNAVAILABLE on HTTP 500', async () => {
    fetchSpy.mockResolvedValue(mockResponse(500, null));

    try {
      await getRepoInfo('acme', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
      expect(err.httpStatus).toBe(502);
    }
  });

  test('throws GITHUB_UNAVAILABLE on HTTP 503', async () => {
    fetchSpy.mockResolvedValue(mockResponse(503, { message: 'Service Unavailable' }));

    try {
      await getRepoInfo('acme', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
    }
  });
});

// ── 6. Network / fetch failure ────────────────────────────────────────────────
describe('getRepoInfo — network failure', () => {
  test('throws GITHUB_UNAVAILABLE when fetch rejects', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    try {
      await getRepoInfo('acme', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
      expect(err.httpStatus).toBe(502);
    }
  });

  test('throws GITHUB_UNAVAILABLE on ECONNREFUSED', async () => {
    const netErr = new Error('connect ECONNREFUSED');
    netErr.code = 'ECONNREFUSED';
    fetchSpy.mockRejectedValue(netErr);

    try {
      await getRepoInfo('acme', 'repo');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
    }
  });
});

// ── 7. Authorization header present when token is set ────────────────────────
describe('getRepoInfo — Authorization header', () => {
  test('includes Authorization header when GITHUB_TOKEN is set', async () => {
    process.env.GITHUB_TOKEN = 'ghp_testtoken123';
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_REPO_BODY));

    await getRepoInfo('acme', 'my-repo');

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer ghp_testtoken123');
  });

  test('calls the correct GitHub API URL', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_REPO_BODY));

    await getRepoInfo('acme', 'my-repo');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/my-repo');
  });
});

// ── 8. Authorization header absent when token is not set ─────────────────────
describe('getRepoInfo — no Authorization header', () => {
  test('omits Authorization header when GITHUB_TOKEN is not set', async () => {
    // GITHUB_TOKEN is deleted in beforeEach — confirm it is absent
    expect(process.env.GITHUB_TOKEN).toBeUndefined();
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_REPO_BODY));

    await getRepoInfo('acme', 'my-repo');

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });

  test('always includes Accept and X-GitHub-Api-Version headers', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_REPO_BODY));

    await getRepoInfo('acme', 'my-repo');

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Accept']).toBe('application/vnd.github+json');
    expect(options.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getRepoTree tests
// ═══════════════════════════════════════════════════════════════════════════════

const { getRepoTree } = require('../githubClient');

/** Minimal GitHub Git Trees API response body. */
const GITHUB_TREE_BODY = {
  sha:       'abc123',
  truncated: false,
  tree: [
    { path: 'README.md',          type: 'blob', mode: '100644', sha: 'aaa', size: 512 },
    { path: 'src',                type: 'tree', mode: '040000', sha: 'bbb'            },
    { path: 'src/index.js',       type: 'blob', mode: '100644', sha: 'ccc', size: 1024 },
    { path: 'src/utils.js',       type: 'blob', mode: '100644', sha: 'ddd', size: 256  },
    { path: '.github/workflows',  type: 'tree', mode: '040000', sha: 'eee'            },
  ],
};

const TRUNCATED_TREE_BODY = { ...GITHUB_TREE_BODY, truncated: true };

// ── 1. Successful recursive tree response ─────────────────────────────────────
describe('getRepoTree — success', () => {
  test('returns an object with truncated and tree keys', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    const result = await getRepoTree('acme', 'my-repo', 'main');

    expect(result).toHaveProperty('truncated');
    expect(result).toHaveProperty('tree');
    expect(Object.keys(result).sort()).toEqual(['tree', 'truncated']);
  });

  test('tree is an array', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    const result = await getRepoTree('acme', 'my-repo', 'main');

    expect(Array.isArray(result.tree)).toBe(true);
    expect(result.tree).toHaveLength(5);
  });
});

// ── 2. Normalization of tree entries ─────────────────────────────────────────
describe('getRepoTree — entry normalization', () => {
  test('each entry has path and type', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    const { tree } = await getRepoTree('acme', 'my-repo', 'main');

    for (const entry of tree) {
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.type).toBe('string');
    }
  });

  test('blob entries include size', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    const { tree } = await getRepoTree('acme', 'my-repo', 'main');
    const blob = tree.find((e) => e.path === 'README.md');

    expect(blob.size).toBe(512);
  });

  test('tree (directory) entries do NOT include size', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    const { tree } = await getRepoTree('acme', 'my-repo', 'main');
    const dir = tree.find((e) => e.path === 'src');

    expect(dir).toBeDefined();
    expect(dir).not.toHaveProperty('size');
  });

  test('raw GitHub fields sha and mode are stripped from entries', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    const { tree } = await getRepoTree('acme', 'my-repo', 'main');

    for (const entry of tree) {
      expect(entry).not.toHaveProperty('sha');
      expect(entry).not.toHaveProperty('mode');
    }
  });

  test('returns empty tree array when GitHub tree is empty', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, { sha: 'abc', truncated: false, tree: [] }));

    const result = await getRepoTree('acme', 'empty-repo', 'main');

    expect(result.tree).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

// ── 3. truncated: false ───────────────────────────────────────────────────────
describe('getRepoTree — truncated false', () => {
  test('truncated is false when GitHub reports false', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    const result = await getRepoTree('acme', 'my-repo', 'main');

    expect(result.truncated).toBe(false);
  });
});

// ── 4. truncated: true ────────────────────────────────────────────────────────
describe('getRepoTree — truncated true', () => {
  test('truncated is true when GitHub reports true', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, TRUNCATED_TREE_BODY));

    const result = await getRepoTree('acme', 'large-repo', 'main');

    expect(result.truncated).toBe(true);
  });

  test('tree entries are still returned when truncated', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, TRUNCATED_TREE_BODY));

    const result = await getRepoTree('acme', 'large-repo', 'main');

    expect(result.tree.length).toBeGreaterThan(0);
  });
});

// ── 5. URL encoding of the default branch ────────────────────────────────────
describe('getRepoTree — URL encoding', () => {
  test('uses the correct Git Trees API endpoint', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    await getRepoTree('acme', 'my-repo', 'main');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/acme/my-repo/git/trees/main?recursive=1'
    );
  });

  test('URL-encodes a branch name containing a slash', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    await getRepoTree('acme', 'my-repo', 'release/1.0');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('release%2F1.0');
    expect(url).not.toContain('release/1.0');
  });

  test('URL-encodes a branch name containing a space', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    await getRepoTree('acme', 'my-repo', 'my branch');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('my%20branch');
  });

  test('includes recursive=1 query parameter', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    await getRepoTree('acme', 'my-repo', 'main');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('?recursive=1');
  });
});

// ── 6. 404 ────────────────────────────────────────────────────────────────────
describe('getRepoTree — 404', () => {
  test('throws AppError REPO_NOT_FOUND on HTTP 404', async () => {
    fetchSpy.mockResolvedValue(mockResponse(404, { message: 'Not Found' }));

    await expect(getRepoTree('acme', 'gone', 'main')).rejects.toThrow(AppError);

    try {
      await getRepoTree('acme', 'gone', 'main');
    } catch (err) {
      expect(err.code).toBe('REPO_NOT_FOUND');
      expect(err.httpStatus).toBe(404);
    }
  });
});

// ── 7. Rate limiting ──────────────────────────────────────────────────────────
describe('getRepoTree — rate limiting', () => {
  test('throws GITHUB_RATE_LIMITED when x-ratelimit-remaining is 0 on 403', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' })
    );

    try {
      await getRepoTree('acme', 'my-repo', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_RATE_LIMITED');
      expect(err.httpStatus).toBe(429);
    }
  });

  test('throws GITHUB_RATE_LIMITED on explicit HTTP 429', async () => {
    fetchSpy.mockResolvedValue(mockResponse(429, { message: 'Too many requests' }));

    try {
      await getRepoTree('acme', 'my-repo', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_RATE_LIMITED');
    }
  });
});

// ── 8. GitHub server failure ──────────────────────────────────────────────────
describe('getRepoTree — server failure', () => {
  test('throws GITHUB_UNAVAILABLE on HTTP 500', async () => {
    fetchSpy.mockResolvedValue(mockResponse(500, null));

    try {
      await getRepoTree('acme', 'my-repo', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
      expect(err.httpStatus).toBe(502);
    }
  });

  test('throws GITHUB_UNAVAILABLE on HTTP 503', async () => {
    fetchSpy.mockResolvedValue(mockResponse(503, { message: 'Service Unavailable' }));

    try {
      await getRepoTree('acme', 'my-repo', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
    }
  });
});

// ── 9. Network failure ────────────────────────────────────────────────────────
describe('getRepoTree — network failure', () => {
  test('throws GITHUB_UNAVAILABLE when fetch rejects', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    try {
      await getRepoTree('acme', 'my-repo', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
      expect(err.httpStatus).toBe(502);
    }
  });
});

// ── 10. Authorization header behavior ────────────────────────────────────────
describe('getRepoTree — Authorization header', () => {
  test('includes Authorization header when GITHUB_TOKEN is set', async () => {
    process.env.GITHUB_TOKEN = 'ghp_treetoken456';
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    await getRepoTree('acme', 'my-repo', 'main');

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer ghp_treetoken456');
  });

  test('omits Authorization header when GITHUB_TOKEN is not set', async () => {
    expect(process.env.GITHUB_TOKEN).toBeUndefined();
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    await getRepoTree('acme', 'my-repo', 'main');

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });

  test('always sends Accept and X-GitHub-Api-Version headers', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, GITHUB_TREE_BODY));

    await getRepoTree('acme', 'my-repo', 'main');

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Accept']).toBe('application/vnd.github+json');
    expect(options.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getFileContent tests
// ═══════════════════════════════════════════════════════════════════════════════

const { getFileContent, MAX_CONTENT_BYTES } = require('../githubClient');

/** Encode text as a base64 string the way GitHub wraps it (newlines every 60 chars). */
function toBase64(text) {
  const raw = Buffer.from(text, 'utf8').toString('base64');
  // GitHub wraps every 60 characters with \n
  return raw.match(/.{1,60}/g).join('\n') + '\n';
}

/** Minimal GitHub Contents API response for a text file. */
function contentsBody(content, size) {
  return {
    name:     'file.js',
    path:     'src/file.js',
    encoding: 'base64',
    size:     size ?? Buffer.byteLength(content, 'utf8'),
    content:  toBase64(content),
  };
}

// ── Successful content decoding ───────────────────────────────────────────────
describe('getFileContent — success', () => {
  test('returns decoded text content on HTTP 200', async () => {
    const src = 'const x = 1;\n// TODO: improve this\n';
    fetchSpy.mockResolvedValue(mockResponse(200, contentsBody(src)));

    const result = await getFileContent('acme', 'repo', 'src/file.js', 'main');

    expect(result).not.toBeNull();
    expect(result.content).toBe(src);
    expect(result.path).toBe('src/file.js');
  });

  test('returned object contains path, content, and size', async () => {
    const src = 'hello world';
    fetchSpy.mockResolvedValue(mockResponse(200, contentsBody(src)));

    const result = await getFileContent('acme', 'repo', 'src/file.js', 'main');

    expect(typeof result.path).toBe('string');
    expect(typeof result.content).toBe('string');
    expect(typeof result.size).toBe('number');
  });

  test('calls the correct GitHub Contents API URL', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, contentsBody('x')));

    await getFileContent('acme', 'repo', 'src/index.js', 'main');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/repo/contents/src/index.js?ref=main');
  });

  test('URL-encodes path segments containing special characters', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, contentsBody('x')));

    await getFileContent('acme', 'repo', 'my folder/file name.js', 'main');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('my%20folder/file%20name.js');
  });

  test('URL-encodes the ref', async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, contentsBody('x')));

    await getFileContent('acme', 'repo', 'src/file.js', 'release/1.0');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('ref=release%2F1.0');
  });

  test('returns null for a non-base64 encoded response (binary file)', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(200, { encoding: 'none', content: '', size: 10 })
    );

    const result = await getFileContent('acme', 'repo', 'image.png', 'main');

    expect(result).toBeNull();
  });

  test('returns null when file size exceeds MAX_CONTENT_BYTES', async () => {
    const oversizeBody = {
      encoding: 'base64',
      content:  toBase64('x'),
      size:     MAX_CONTENT_BYTES + 1,
    };
    fetchSpy.mockResolvedValue(mockResponse(200, oversizeBody));

    const result = await getFileContent('acme', 'repo', 'big.js', 'main');

    expect(result).toBeNull();
  });

  test('file exactly at MAX_CONTENT_BYTES is NOT skipped', async () => {
    const body = {
      encoding: 'base64',
      content:  toBase64('x'),
      size:     MAX_CONTENT_BYTES,
    };
    fetchSpy.mockResolvedValue(mockResponse(200, body));

    const result = await getFileContent('acme', 'repo', 'border.js', 'main');

    expect(result).not.toBeNull();
  });
});

// ── Authorization header behavior ─────────────────────────────────────────────
describe('getFileContent — Authorization header', () => {
  test('includes Authorization header when GITHUB_TOKEN is set', async () => {
    process.env.GITHUB_TOKEN = 'ghp_filetoken789';
    fetchSpy.mockResolvedValue(mockResponse(200, contentsBody('x')));

    await getFileContent('acme', 'repo', 'src/file.js', 'main');

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer ghp_filetoken789');
  });

  test('omits Authorization header when GITHUB_TOKEN is not set', async () => {
    expect(process.env.GITHUB_TOKEN).toBeUndefined();
    fetchSpy.mockResolvedValue(mockResponse(200, contentsBody('x')));

    await getFileContent('acme', 'repo', 'src/file.js', 'main');

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers['Authorization']).toBeUndefined();
  });
});

// ── 404 — missing file ────────────────────────────────────────────────────────
describe('getFileContent — 404', () => {
  test('throws AppError REPO_NOT_FOUND on HTTP 404', async () => {
    fetchSpy.mockResolvedValue(mockResponse(404, { message: 'Not Found' }));

    await expect(
      getFileContent('acme', 'repo', 'missing.js', 'main')
    ).rejects.toThrow(AppError);

    try {
      await getFileContent('acme', 'repo', 'missing.js', 'main');
    } catch (err) {
      expect(err.code).toBe('REPO_NOT_FOUND');
      expect(err.httpStatus).toBe(404);
    }
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('getFileContent — rate limiting', () => {
  test('throws GITHUB_RATE_LIMITED on 403 with rate-limit header', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' })
    );

    try {
      await getFileContent('acme', 'repo', 'src/file.js', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_RATE_LIMITED');
      expect(err.httpStatus).toBe(429);
    }
  });

  test('throws GITHUB_RATE_LIMITED on explicit HTTP 429', async () => {
    fetchSpy.mockResolvedValue(mockResponse(429, { message: 'Too many requests' }));

    try {
      await getFileContent('acme', 'repo', 'src/file.js', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_RATE_LIMITED');
    }
  });
});

// ── GitHub unavailable ────────────────────────────────────────────────────────
describe('getFileContent — GitHub unavailable', () => {
  test('throws GITHUB_UNAVAILABLE on HTTP 500', async () => {
    fetchSpy.mockResolvedValue(mockResponse(500, null));

    try {
      await getFileContent('acme', 'repo', 'src/file.js', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
      expect(err.httpStatus).toBe(502);
    }
  });
});

// ── Network failure ───────────────────────────────────────────────────────────
describe('getFileContent — network failure', () => {
  test('throws GITHUB_UNAVAILABLE when fetch rejects', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    try {
      await getFileContent('acme', 'repo', 'src/file.js', 'main');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('GITHUB_UNAVAILABLE');
      expect(err.httpStatus).toBe(502);
    }
  });
});
