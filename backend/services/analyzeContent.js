'use strict';

const { MAX_CONTENT_BYTES } = require('./githubClient');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Lines/patterns with TODO markers (case-insensitive word-boundary match). */
const TODO_RE  = /\bTODO\b/gi;

/** Lines/patterns with FIXME markers (case-insensitive word-boundary match). */
const FIXME_RE = /\bFIXME\b/gi;

/**
 * A source file is "unusually large" if its size exceeds this threshold.
 * 50 KB is a reasonable upper bound for a non-generated JS/JSX source file.
 * Files above this are flagged but still analyzed if their content was fetched.
 */
const LARGE_FILE_BYTES = 50 * 1024; // 50 KB

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Count non-overlapping occurrences of a regex in a string.
 * The regex must have the global flag set.
 *
 * @param {RegExp} re
 * @param {string} text
 * @returns {number}
 */
function countMatches(re, text) {
  re.lastIndex = 0;         // reset stateful global regex before each use
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

/**
 * Return true if the path is inside a generated/vendor directory that should
 * be excluded from quality analysis.
 *
 * @param {string} path
 * @returns {boolean}
 */
function isGeneratedPath(path) {
  const segments = path.split('/');
  const skipDirs = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', 'vendor', '.cache']);
  return segments.some((seg) => skipDirs.has(seg.toLowerCase()));
}

// ── Main analyzer ─────────────────────────────────────────────────────────────

/**
 * analyzeContent(fetchedFiles, classificationResult)
 *
 * Derives quality and content signals from the text of fetched repository files.
 * Pure function — no network calls, no database calls, no AI calls.
 *
 * @param {Array<{ path: string, content: string, size: number }>} fetchedFiles
 *   Decoded file contents as returned by getFileContent().
 *   Pass an empty array if no files could be retrieved.
 *
 * @param {{
 *   structure:         object,
 *   testingSignals:    object,
 *   docSignals:        { readmePaths: string[], docFilePaths: string[] },
 *   dependencySignals: { hasPackageJson: boolean, manifestPaths: string[] },
 *   truncated:         boolean,
 * }} classificationResult
 *   The output of classifyTree(), used to provide context the analyzer cannot
 *   derive from file content alone (e.g. which README paths exist).
 *
 * @param {string[]} [skippedPaths=[]]
 *   Paths of files that were identified for analysis but could not be fetched
 *   (404, size limit, binary, etc.).  Recorded as scan limitations.
 *
 * @returns {{
 *   qualitySignals: {
 *     todoCount:           number,
 *     fixmeCount:          number,
 *     largeFileCount:      number,
 *     largeFilePaths:      string[],
 *     analyzedFileCount:   number,
 *     skippedFilePaths:    string[],
 *   },
 *   docSignals: {
 *     readmePresent:       boolean,
 *     readmeNonEmpty:      boolean,
 *     readmeCharCount:     number,
 *   },
 *   dependencySignals: {
 *     packageJsonValid:    boolean,
 *     hasDependencies:     boolean,
 *     hasDevDependencies:  boolean,
 *     scripts:             string[],
 *     hasTestScript:       boolean,
 *   },
 * }}
 */
function analyzeContent(fetchedFiles = [], classificationResult = {}, skippedPaths = []) {
  const fileMap = new Map(fetchedFiles.map((f) => [f.path, f]));

  // ── Quality signals ─────────────────────────────────────────────────────────
  let todoCount  = 0;
  let fixmeCount = 0;
  const largeFilePaths    = [];
  let   analyzedFileCount = 0;

  for (const file of fetchedFiles) {
    if (isGeneratedPath(file.path)) continue;

    analyzedFileCount++;

    // TODO / FIXME counts
    todoCount  += countMatches(TODO_RE,  file.content);
    fixmeCount += countMatches(FIXME_RE, file.content);

    // Large-file detection — flag based on stored size (from tree)
    if (file.size > LARGE_FILE_BYTES) {
      largeFilePaths.push(file.path);
    }
  }

  // Also flag large files that were skipped due to size limit
  // (size was known from the tree but content was not fetched)
  // The caller should include oversized files in skippedPaths.

  // ── Documentation signals ───────────────────────────────────────────────────
  const readmePaths = classificationResult.docSignals?.readmePaths ?? [];
  let readmePresent  = false;
  let readmeNonEmpty = false;
  let readmeCharCount = 0;

  for (const rPath of readmePaths) {
    const f = fileMap.get(rPath);
    if (f) {
      readmePresent  = true;
      const trimmed  = f.content.trim();
      readmeCharCount = trimmed.length;
      readmeNonEmpty  = trimmed.length > 0;
      break; // use the first README found
    }
  }

  // ── Dependency / package.json signals ──────────────────────────────────────
  let packageJsonValid    = false;
  let hasDependencies    = false;
  let hasDevDependencies = false;
  let scripts            = [];
  let hasTestScript      = false;

  const manifestPaths = classificationResult.dependencySignals?.manifestPaths ?? [];
  const pkgPath = manifestPaths.find((p) => p.split('/').pop().toLowerCase() === 'package.json');

  if (pkgPath) {
    const pkgFile = fileMap.get(pkgPath);
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.content);
        packageJsonValid    = true;
        hasDependencies    = pkg.dependencies != null && Object.keys(pkg.dependencies).length > 0;
        hasDevDependencies = pkg.devDependencies != null && Object.keys(pkg.devDependencies).length > 0;
        scripts            = pkg.scripts != null ? Object.keys(pkg.scripts) : [];
        hasTestScript      = scripts.includes('test');
      } catch {
        packageJsonValid = false;
      }
    }
  }

  return {
    qualitySignals: {
      todoCount,
      fixmeCount,
      largeFileCount: largeFilePaths.length,
      largeFilePaths,
      analyzedFileCount,
      skippedFilePaths: [...skippedPaths],
    },
    docSignals: {
      readmePresent,
      readmeNonEmpty,
      readmeCharCount,
    },
    dependencySignals: {
      packageJsonValid,
      hasDependencies,
      hasDevDependencies,
      scripts,
      hasTestScript,
    },
  };
}

module.exports = { analyzeContent, LARGE_FILE_BYTES };
