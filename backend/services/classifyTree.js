'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Top-level directory names that are canonical test roots.
 * Matched case-insensitively against the first path segment.
 */
const TEST_DIR_NAMES = new Set(['test', 'tests', '__tests__']);

/**
 * File extensions treated as JavaScript source files for the MVP.
 */
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

/**
 * File extensions treated as TypeScript source files.
 * Counted separately so callers can make their own decisions.
 */
const TS_EXTENSIONS = new Set(['.ts', '.tsx']);

/**
 * Dependency manifest filenames (exact, case-sensitive).
 */
const DEPENDENCY_MANIFESTS = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

/**
 * Common configuration filenames/patterns (base filename, case-insensitive).
 */
const CONFIG_BASENAMES = new Set([
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'prettier.config.cjs',
  '.babelrc',
  '.babelrc.js',
  '.babelrc.json',
  'babel.config.js',
  'babel.config.cjs',
  'babel.config.json',
  'jest.config.js',
  'jest.config.cjs',
  'jest.config.ts',
  'jest.config.json',
  'vitest.config.js',
  'vitest.config.ts',
  'vite.config.js',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.base.json',
  '.nvmrc',
  '.node-version',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  'dockerfile',           // matched lower-cased
  'docker-compose.yml',
  'docker-compose.yaml',
  '.dockerignore',
  'makefile',             // matched lower-cased
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the lowercased file extension including the dot (e.g. '.js').
 * Returns '' if the basename has no extension.
 *
 * @param {string} p - File path
 * @returns {string}
 */
function extOf(p) {
  const base = p.split('/').pop();         // last path segment
  const dot  = base.lastIndexOf('.');
  if (dot <= 0) return '';                 // dot at position 0 = hidden file, no ext
  return base.slice(dot).toLowerCase();
}

/**
 * Return the lowercased basename of a path.
 *
 * @param {string} p
 * @returns {string}
 */
function baseName(p) {
  return p.split('/').pop().toLowerCase();
}

/**
 * Return the lowercased first path segment (top-level directory or file name).
 *
 * @param {string} p
 * @returns {string}
 */
function firstSegment(p) {
  return p.split('/')[0].toLowerCase();
}

/**
 * Return true if the file lives inside a canonical test directory at any nesting level.
 *
 * @param {string} p - Full path from repo root
 * @returns {boolean}
 */
function isInsideTestDir(p) {
  const segments = p.split('/');
  // Check every intermediate directory segment (skip the last which is the file)
  for (let i = 0; i < segments.length - 1; i++) {
    if (TEST_DIR_NAMES.has(segments[i].toLowerCase())) return true;
  }
  return false;
}

/**
 * Return true if the filename matches a test-file pattern:
 *   *.test.js  *.test.jsx  *.test.ts  *.test.tsx
 *   *.spec.js  *.spec.jsx  *.spec.ts  *.spec.tsx
 *
 * @param {string} p
 * @returns {boolean}
 */
function isTestFilename(p) {
  const base = baseName(p);
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(base);
}

/**
 * Return true if the entry is a README file.
 * Matches README, README.md, README.rst, README.txt, etc., case-insensitively.
 *
 * @param {string} p
 * @returns {boolean}
 */
function isReadme(p) {
  return /^readme(\.|$)/i.test(p.split('/').pop());
}

/**
 * Return true if the path is a documentation file or lives in a doc directory.
 *
 * @param {string} p
 * @returns {boolean}
 */
function isDocFile(p) {
  if (isReadme(p)) return true;
  const segments = p.split('/');
  // Check directory segments for doc directories
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i].toLowerCase();
    if (seg === 'docs' || seg === 'doc' || seg === 'documentation') return true;
  }
  // Markdown / RST / text files outside source dirs are treated as docs
  const ext = extOf(p);
  if (['.md', '.rst', '.txt'].includes(ext)) return true;
  return false;
}

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * classifyTree({ tree, truncated })
 *
 * Accepts the normalized tree returned by getRepoTree() and produces a
 * structured classification consumed by the health-scoring stage.
 *
 * No network calls, database calls, or file-content reads are made.
 * The result is deterministic for a given input.
 *
 * @param {{ tree: Array<{path: string, type: string, size?: number}>, truncated: boolean }} treeResult
 * @returns {{
 *   truncated: boolean,
 *   structure: {
 *     totalFiles:        number,
 *     totalDirectories:  number,
 *     sourceFileCount:   number,
 *     testFileCount:     number,
 *     docFileCount:      number,
 *     configFileCount:   number,
 *     hasPackageJson:    boolean,
 *     hasReadme:         boolean,
 *     hasTests:          boolean,
 *   },
 *   testingSignals: {
 *     testFileCount:     number,
 *     testFilePaths:     string[],
 *     testDirPaths:      string[],
 *   },
 *   docSignals: {
 *     readmePaths:       string[],
 *     docFilePaths:      string[],
 *     docFileCount:      number,
 *   },
 *   dependencySignals: {
 *     hasPackageJson:    boolean,
 *     manifestPaths:     string[],
 *   },
 * }}
 */
function classifyTree({ tree = [], truncated = false } = {}) {
  // ── Accumulators ─────────────────────────────────────────────────────────────
  const blobs = [];         // all file entries
  const dirs  = [];         // all directory entries

  const sourcePaths    = [];
  const testPaths      = [];
  const docPaths       = [];
  const configPaths    = [];
  const manifestPaths  = [];
  const readmePaths    = [];
  const testDirSet     = new Set();   // unique test-directory paths

  // ── Classify each entry ───────────────────────────────────────────────────────
  for (const entry of tree) {
    const { path, type } = entry;

    if (type === 'tree') {
      dirs.push(path);
      // Track canonical test directories
      const name = firstSegment(path);
      if (TEST_DIR_NAMES.has(name)) {
        testDirSet.add(path.split('/')[0]);
      }
      continue;
    }

    // Everything else is treated as a file (blob / commit)
    blobs.push(path);

    const ext  = extOf(path);
    const base = baseName(path);

    // ── Documentation ────────────────────────────────────────────────────────
    if (isReadme(path)) {
      readmePaths.push(path);
      docPaths.push(path);
      continue;                         // README is doc, not source
    }

    if (isDocFile(path)) {
      docPaths.push(path);
      continue;
    }

    // ── Dependency manifests ─────────────────────────────────────────────────
    if (DEPENDENCY_MANIFESTS.has(base)) {
      manifestPaths.push(path);
      continue;
    }

    // ── Configuration ────────────────────────────────────────────────────────
    if (CONFIG_BASENAMES.has(base)) {
      configPaths.push(path);
      continue;
    }

    // ── Test files ───────────────────────────────────────────────────────────
    if (isTestFilename(path) || isInsideTestDir(path)) {
      testPaths.push(path);
      continue;
    }

    // ── JS/TS source files ───────────────────────────────────────────────────
    if (SOURCE_EXTENSIONS.has(ext) || TS_EXTENSIONS.has(ext)) {
      sourcePaths.push(path);
      continue;
    }

    // All other files are uncategorised — counted in totals but not collected
  }

  // ── Assemble result ───────────────────────────────────────────────────────────
  const hasPackageJson = manifestPaths.some((p) => baseName(p) === 'package.json');
  const hasReadme      = readmePaths.length > 0;
  const hasTests       = testPaths.length > 0 || testDirSet.size > 0;

  return {
    truncated,
    structure: {
      totalFiles:       blobs.length,
      totalDirectories: dirs.length,
      sourceFileCount:  sourcePaths.length,
      testFileCount:    testPaths.length,
      docFileCount:     docPaths.length,
      configFileCount:  configPaths.length,
      hasPackageJson,
      hasReadme,
      hasTests,
    },
    testingSignals: {
      testFileCount:  testPaths.length,
      testFilePaths:  testPaths,
      testDirPaths:   [...testDirSet],
    },
    docSignals: {
      readmePaths,
      docFilePaths: docPaths,
      docFileCount:  docPaths.length,
    },
    dependencySignals: {
      hasPackageJson,
      manifestPaths,
    },
  };
}

module.exports = classifyTree;
