'use strict';

const { analyzeContent, LARGE_FILE_BYTES } = require('../analyzeContent');
const { MAX_CONTENT_BYTES }                = require('../githubClient');

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a fetched-file object as getFileContent() returns. */
const mkFile = (path, content, size) => ({
  path,
  content,
  size: size ?? Buffer.byteLength(content, 'utf8'),
});

/** Minimal classificationResult from classifyTree() with no entries. */
const emptyClassification = {
  structure:         {},
  testingSignals:    {},
  docSignals:        { readmePaths: [], docFilePaths: [] },
  dependencySignals: { hasPackageJson: false, manifestPaths: [] },
  truncated:         false,
};

/** A classification that knows about package.json and README. */
const basicClassification = {
  ...emptyClassification,
  docSignals:        { readmePaths: ['README.md'], docFilePaths: ['README.md'] },
  dependencySignals: { hasPackageJson: true, manifestPaths: ['package.json'] },
};

const VALID_PKG = JSON.stringify({
  name: 'my-app',
  scripts: { start: 'node index.js', test: 'jest', build: 'tsc' },
  dependencies:    { express: '^4.0.0' },
  devDependencies: { jest: '^29.0.0' },
});

const PKG_NO_SCRIPTS = JSON.stringify({ name: 'bare' });
const INVALID_PKG    = '{ not valid json ;;;';

// ── 1. TODO detection ─────────────────────────────────────────────────────────
describe('analyzeContent — TODO detection', () => {
  test('counts a single TODO', () => {
    const files = [mkFile('src/a.js', '// TODO: fix this\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.todoCount).toBe(1);
  });

  test('counts multiple TODOs across files', () => {
    const files = [
      mkFile('src/a.js', 'TODO: one\nTODO: two\n'),
      mkFile('src/b.js', '// TODO: three\n'),
    ];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.todoCount).toBe(3);
  });

  test('TODO is case-insensitive', () => {
    const files = [mkFile('src/a.js', '// todo: lowercase\n// TODO: upper\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.todoCount).toBe(2);
  });

  test('returns 0 when no TODOs are present', () => {
    const files = [mkFile('src/a.js', 'const x = 1;\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.todoCount).toBe(0);
  });

  test('empty file set gives 0 TODOs', () => {
    const { qualitySignals } = analyzeContent([], emptyClassification);
    expect(qualitySignals.todoCount).toBe(0);
  });
});

// ── 2. FIXME detection ────────────────────────────────────────────────────────
describe('analyzeContent — FIXME detection', () => {
  test('counts a single FIXME', () => {
    const files = [mkFile('src/a.js', '// FIXME: broken\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.fixmeCount).toBe(1);
  });

  test('counts multiple FIXMEs across files', () => {
    const files = [
      mkFile('src/a.js', 'FIXME one\nFIXME two\n'),
      mkFile('src/b.js', '// fixme three\n'),
    ];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.fixmeCount).toBe(3);
  });

  test('returns 0 when no FIXMEs are present', () => {
    const files = [mkFile('src/a.js', 'export default function() {}\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.fixmeCount).toBe(0);
  });
});

// ── 3. Large-file detection ───────────────────────────────────────────────────
describe('analyzeContent — large-file detection', () => {
  test('flags a file with size above LARGE_FILE_BYTES', () => {
    const files = [mkFile('src/big.js', 'x', LARGE_FILE_BYTES + 1)];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.largeFileCount).toBe(1);
    expect(qualitySignals.largeFilePaths).toContain('src/big.js');
  });

  test('does not flag a file exactly at LARGE_FILE_BYTES', () => {
    const files = [mkFile('src/normal.js', 'x', LARGE_FILE_BYTES)];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.largeFileCount).toBe(0);
  });

  test('counts multiple large files', () => {
    const files = [
      mkFile('src/a.js', 'x', LARGE_FILE_BYTES + 100),
      mkFile('src/b.js', 'x', LARGE_FILE_BYTES + 200),
      mkFile('src/c.js', 'x', 100),
    ];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.largeFileCount).toBe(2);
  });

  test('returns 0 when no large files', () => {
    const files = [mkFile('src/a.js', 'const x = 1;\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.largeFileCount).toBe(0);
    expect(qualitySignals.largeFilePaths).toEqual([]);
  });
});

// ── 4. Empty README ───────────────────────────────────────────────────────────
describe('analyzeContent — empty README', () => {
  test('readmePresent is true but readmeNonEmpty is false for whitespace-only README', () => {
    const files = [mkFile('README.md', '   \n   ')];
    const { docSignals } = analyzeContent(files, basicClassification);
    expect(docSignals.readmePresent).toBe(true);
    expect(docSignals.readmeNonEmpty).toBe(false);
  });

  test('readmePresent is true and readmeNonEmpty is false for empty string README', () => {
    const files = [mkFile('README.md', '')];
    const { docSignals } = analyzeContent(files, basicClassification);
    expect(docSignals.readmePresent).toBe(true);
    expect(docSignals.readmeNonEmpty).toBe(false);
  });
});

// ── 5. Non-empty README ───────────────────────────────────────────────────────
describe('analyzeContent — non-empty README', () => {
  test('readmePresent and readmeNonEmpty are true for content with text', () => {
    const files = [mkFile('README.md', '# My Project\n\nA great project.')];
    const { docSignals } = analyzeContent(files, basicClassification);
    expect(docSignals.readmePresent).toBe(true);
    expect(docSignals.readmeNonEmpty).toBe(true);
  });

  test('readmeCharCount reflects trimmed length', () => {
    const text  = '# Hello\n';
    const files = [mkFile('README.md', text)];
    const { docSignals } = analyzeContent(files, basicClassification);
    expect(docSignals.readmeCharCount).toBe(text.trim().length);
  });

  test('readmePresent is false when README path not in classificationResult', () => {
    const files = [mkFile('README.md', '# Hi')];
    const { docSignals } = analyzeContent(files, emptyClassification);
    expect(docSignals.readmePresent).toBe(false);
  });
});

// ── 6. Valid package.json ─────────────────────────────────────────────────────
describe('analyzeContent — valid package.json', () => {
  test('packageJsonValid is true for valid JSON', () => {
    const files = [mkFile('package.json', VALID_PKG)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.packageJsonValid).toBe(true);
  });

  test('detects dependencies and devDependencies', () => {
    const files = [mkFile('package.json', VALID_PKG)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.hasDependencies).toBe(true);
    expect(dependencySignals.hasDevDependencies).toBe(true);
  });

  test('lists available scripts', () => {
    const files = [mkFile('package.json', VALID_PKG)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.scripts).toContain('start');
    expect(dependencySignals.scripts).toContain('test');
    expect(dependencySignals.scripts).toContain('build');
  });
});

// ── 7. Invalid package.json ───────────────────────────────────────────────────
describe('analyzeContent — invalid package.json', () => {
  test('packageJsonValid is false for malformed JSON', () => {
    const files = [mkFile('package.json', INVALID_PKG)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.packageJsonValid).toBe(false);
  });

  test('hasDependencies is false when package.json is invalid', () => {
    const files = [mkFile('package.json', INVALID_PKG)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.hasDependencies).toBe(false);
  });
});

// ── 8. Dependencies / devDependencies ────────────────────────────────────────
describe('analyzeContent — dependencies', () => {
  test('hasDependencies is false for empty dependencies object', () => {
    const pkg  = JSON.stringify({ name: 'x', dependencies: {} });
    const files = [mkFile('package.json', pkg)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.hasDependencies).toBe(false);
  });

  test('hasDevDependencies is false when field is absent', () => {
    const pkg  = JSON.stringify({ name: 'x', dependencies: { react: '^18.0.0' } });
    const files = [mkFile('package.json', pkg)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.hasDevDependencies).toBe(false);
  });

  test('both false when no package.json was fetched', () => {
    const { dependencySignals } = analyzeContent([], emptyClassification);
    expect(dependencySignals.hasDependencies).toBe(false);
    expect(dependencySignals.hasDevDependencies).toBe(false);
  });
});

// ── 9. Test-script detection ─────────────────────────────────────────────────
describe('analyzeContent — test script', () => {
  test('hasTestScript is true when scripts.test exists', () => {
    const files = [mkFile('package.json', VALID_PKG)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.hasTestScript).toBe(true);
  });

  test('hasTestScript is false when scripts.test is absent', () => {
    const pkg  = JSON.stringify({ name: 'x', scripts: { start: 'node .' } });
    const files = [mkFile('package.json', pkg)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.hasTestScript).toBe(false);
  });

  test('hasTestScript is false for package.json with no scripts', () => {
    const files = [mkFile('package.json', PKG_NO_SCRIPTS)];
    const { dependencySignals } = analyzeContent(files, basicClassification);
    expect(dependencySignals.hasTestScript).toBe(false);
  });
});

// ── 10. Ignored binary / generated files ─────────────────────────────────────
describe('analyzeContent — ignored paths', () => {
  test('files inside node_modules are excluded from quality analysis', () => {
    const files = [
      mkFile('node_modules/lodash/index.js', '// TODO: vendor todo\n'),
    ];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.todoCount).toBe(0);
    expect(qualitySignals.analyzedFileCount).toBe(0);
  });

  test('files inside dist/ are excluded', () => {
    const files = [mkFile('dist/bundle.js', '// FIXME: generated\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.fixmeCount).toBe(0);
  });

  test('files inside build/ are excluded', () => {
    const files = [mkFile('build/output.js', '// TODO: generated\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.todoCount).toBe(0);
  });

  test('regular source files ARE analyzed', () => {
    const files = [mkFile('src/index.js', '// TODO: real work\n')];
    const { qualitySignals } = analyzeContent(files, emptyClassification);
    expect(qualitySignals.todoCount).toBe(1);
    expect(qualitySignals.analyzedFileCount).toBe(1);
  });
});

// ── 11. File-size limits / oversized handling ─────────────────────────────────
describe('analyzeContent — size limits', () => {
  test('MAX_CONTENT_BYTES is exported and is a positive number', () => {
    expect(typeof MAX_CONTENT_BYTES).toBe('number');
    expect(MAX_CONTENT_BYTES).toBeGreaterThan(0);
  });

  test('LARGE_FILE_BYTES is less than MAX_CONTENT_BYTES', () => {
    // Large-file threshold should be below the retrieval limit
    expect(LARGE_FILE_BYTES).toBeLessThan(MAX_CONTENT_BYTES);
  });
});

// ── 12. Unavailable file handling ─────────────────────────────────────────────
describe('analyzeContent — unavailable files', () => {
  test('skippedFilePaths are recorded in qualitySignals', () => {
    const skipped = ['src/missing.js', 'src/toobig.js'];
    const { qualitySignals } = analyzeContent([], emptyClassification, skipped);
    expect(qualitySignals.skippedFilePaths).toEqual(skipped);
  });

  test('skippedFilePaths is empty when nothing was skipped', () => {
    const { qualitySignals } = analyzeContent([], emptyClassification);
    expect(qualitySignals.skippedFilePaths).toEqual([]);
  });

  test('analysis still works when fetched list is empty', () => {
    expect(() => analyzeContent([], emptyClassification)).not.toThrow();
    const result = analyzeContent([], emptyClassification);
    expect(result.qualitySignals.analyzedFileCount).toBe(0);
  });
});

// ── Output shape ──────────────────────────────────────────────────────────────
describe('analyzeContent — output shape', () => {
  test('result has qualitySignals, docSignals, dependencySignals', () => {
    const result = analyzeContent([], emptyClassification);
    expect(result).toHaveProperty('qualitySignals');
    expect(result).toHaveProperty('docSignals');
    expect(result).toHaveProperty('dependencySignals');
  });

  test('qualitySignals has all required keys', () => {
    const { qualitySignals } = analyzeContent([], emptyClassification);
    const keys = Object.keys(qualitySignals).sort();
    expect(keys).toEqual(
      ['analyzedFileCount', 'fixmeCount', 'largeFileCount', 'largeFilePaths', 'skippedFilePaths', 'todoCount']
    );
  });

  test('docSignals has all required keys', () => {
    const { docSignals } = analyzeContent([], emptyClassification);
    const keys = Object.keys(docSignals).sort();
    expect(keys).toEqual(['readmeCharCount', 'readmeNonEmpty', 'readmePresent']);
  });

  test('dependencySignals has all required keys', () => {
    const { dependencySignals } = analyzeContent([], emptyClassification);
    const keys = Object.keys(dependencySignals).sort();
    expect(keys).toEqual(
      ['hasDependencies', 'hasDevDependencies', 'hasTestScript', 'packageJsonValid', 'scripts']
    );
  });

  test('is deterministic — same input produces identical output', () => {
    const files = [
      mkFile('src/index.js', '// TODO: fix\n// FIXME: broken\n'),
      mkFile('README.md', '# Hello'),
      mkFile('package.json', VALID_PKG),
    ];
    const a = analyzeContent(files, basicClassification);
    const b = analyzeContent(files, basicClassification);
    expect(a).toEqual(b);
  });
});
