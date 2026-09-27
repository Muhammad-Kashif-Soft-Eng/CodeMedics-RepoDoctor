'use strict';

const classifyTree = require('../classifyTree');

// ── Tree builder helpers ───────────────────────────────────────────────────────

/** Create a blob (file) entry as getRepoTree() returns. */
const file = (path, size = 100) => ({ path, type: 'blob', size });

/** Create a tree (directory) entry as getRepoTree() returns. */
const dir  = (path)             => ({ path, type: 'tree' });

/** Wrap entries into the getRepoTree() return shape. */
const tree = (entries, truncated = false) => ({ tree: entries, truncated });

// ── 1. Empty tree ─────────────────────────────────────────────────────────────
describe('classifyTree — empty tree', () => {
  test('returns zero counts for an empty tree array', () => {
    const result = classifyTree(tree([]));

    expect(result.structure.totalFiles).toBe(0);
    expect(result.structure.totalDirectories).toBe(0);
    expect(result.structure.sourceFileCount).toBe(0);
    expect(result.structure.testFileCount).toBe(0);
    expect(result.structure.docFileCount).toBe(0);
    expect(result.structure.configFileCount).toBe(0);
  });

  test('returns false for all boolean signals on empty tree', () => {
    const result = classifyTree(tree([]));

    expect(result.structure.hasPackageJson).toBe(false);
    expect(result.structure.hasReadme).toBe(false);
    expect(result.structure.hasTests).toBe(false);
  });

  test('returns empty arrays in signal fields on empty tree', () => {
    const result = classifyTree(tree([]));

    expect(result.testingSignals.testFilePaths).toEqual([]);
    expect(result.testingSignals.testDirPaths).toEqual([]);
    expect(result.docSignals.readmePaths).toEqual([]);
    expect(result.docSignals.docFilePaths).toEqual([]);
    expect(result.dependencySignals.manifestPaths).toEqual([]);
  });

  test('handles missing input gracefully (no argument)', () => {
    expect(() => classifyTree()).not.toThrow();
    const result = classifyTree();
    expect(result.structure.totalFiles).toBe(0);
  });

  test('preserves truncated:false on empty tree', () => {
    const result = classifyTree(tree([]));
    expect(result.truncated).toBe(false);
  });
});

// ── 2. Normal JavaScript repository ──────────────────────────────────────────
describe('classifyTree — normal JavaScript repository', () => {
  const entries = [
    dir('src'),
    file('src/index.js'),
    file('src/app.js'),
    file('src/utils.js'),
    file('README.md'),
    file('package.json'),
    file('package-lock.json'),
  ];

  test('counts source files correctly', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.sourceFileCount).toBe(3);
  });

  test('counts total files correctly', () => {
    const result = classifyTree(tree(entries));
    // 3 source + 1 README (doc) + 2 manifests = 6 files
    expect(result.structure.totalFiles).toBe(6);
  });

  test('counts total directories correctly', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.totalDirectories).toBe(1);
  });

  test('detects package.json', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.hasPackageJson).toBe(true);
    expect(result.dependencySignals.hasPackageJson).toBe(true);
  });

  test('includes package.json and lock file in manifestPaths', () => {
    const result = classifyTree(tree(entries));
    expect(result.dependencySignals.manifestPaths).toContain('package.json');
    expect(result.dependencySignals.manifestPaths).toContain('package-lock.json');
  });
});

// ── 3. Repository with tests ──────────────────────────────────────────────────
describe('classifyTree — repository with tests', () => {
  const entries = [
    dir('src'),
    file('src/index.js'),
    file('src/utils.test.js'),
    file('src/app.spec.jsx'),
  ];

  test('hasTests is true', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.hasTests).toBe(true);
  });

  test('testFileCount matches detected test files', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.testFileCount).toBe(2);
    expect(result.testingSignals.testFileCount).toBe(2);
  });

  test('testFilePaths contains the test files', () => {
    const result = classifyTree(tree(entries));
    expect(result.testingSignals.testFilePaths).toContain('src/utils.test.js');
    expect(result.testingSignals.testFilePaths).toContain('src/app.spec.jsx');
  });

  test('test files are NOT counted as source files', () => {
    const result = classifyTree(tree(entries));
    // Only src/index.js is a source file; the two test files should not be in source
    expect(result.structure.sourceFileCount).toBe(1);
  });
});

// ── 4. Repository without tests ───────────────────────────────────────────────
describe('classifyTree — repository without tests', () => {
  const entries = [
    dir('src'),
    file('src/index.js'),
    file('src/utils.js'),
    file('README.md'),
    file('package.json'),
  ];

  test('hasTests is false', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.hasTests).toBe(false);
  });

  test('testFileCount is 0', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.testFileCount).toBe(0);
  });

  test('testFilePaths is empty', () => {
    const result = classifyTree(tree(entries));
    expect(result.testingSignals.testFilePaths).toEqual([]);
  });
});

// ── 5. Repository with README ─────────────────────────────────────────────────
describe('classifyTree — repository with README', () => {
  test('detects README.md', () => {
    const result = classifyTree(tree([file('README.md')]));
    expect(result.structure.hasReadme).toBe(true);
    expect(result.docSignals.readmePaths).toContain('README.md');
  });

  test('detects README (no extension)', () => {
    const result = classifyTree(tree([file('README')]));
    expect(result.structure.hasReadme).toBe(true);
  });

  test('detects readme.md (lowercase)', () => {
    const result = classifyTree(tree([file('readme.md')]));
    expect(result.structure.hasReadme).toBe(true);
  });

  test('detects README.rst', () => {
    const result = classifyTree(tree([file('README.rst')]));
    expect(result.structure.hasReadme).toBe(true);
  });

  test('detects nested README inside docs/', () => {
    const result = classifyTree(tree([file('docs/README.md')]));
    expect(result.docSignals.readmePaths).toContain('docs/README.md');
  });

  test('README is included in docFilePaths', () => {
    const result = classifyTree(tree([file('README.md')]));
    expect(result.docSignals.docFilePaths).toContain('README.md');
  });
});

// ── 6. Repository without README ─────────────────────────────────────────────
describe('classifyTree — repository without README', () => {
  test('hasReadme is false when no README is present', () => {
    const result = classifyTree(tree([file('src/index.js'), file('package.json')]));
    expect(result.structure.hasReadme).toBe(false);
    expect(result.docSignals.readmePaths).toEqual([]);
  });

  test('a file named READERS.md is not treated as a README', () => {
    const result = classifyTree(tree([file('READERS.md')]));
    // READERS.md starts with "reader", not "readme"
    expect(result.structure.hasReadme).toBe(false);
  });
});

// ── 7. package.json detection ─────────────────────────────────────────────────
describe('classifyTree — package.json detection', () => {
  test('detects package.json at the root', () => {
    const result = classifyTree(tree([file('package.json')]));
    expect(result.structure.hasPackageJson).toBe(true);
    expect(result.dependencySignals.hasPackageJson).toBe(true);
    expect(result.dependencySignals.manifestPaths).toContain('package.json');
  });

  test('nested package.json also registers as a manifest', () => {
    const result = classifyTree(tree([file('packages/core/package.json')]));
    expect(result.dependencySignals.manifestPaths).toContain('packages/core/package.json');
  });

  test('hasPackageJson is false without package.json', () => {
    const result = classifyTree(tree([file('src/index.js')]));
    expect(result.structure.hasPackageJson).toBe(false);
    expect(result.dependencySignals.hasPackageJson).toBe(false);
  });

  test('detects yarn.lock as a manifest', () => {
    const result = classifyTree(tree([file('yarn.lock')]));
    expect(result.dependencySignals.manifestPaths).toContain('yarn.lock');
  });

  test('detects pnpm-lock.yaml as a manifest', () => {
    const result = classifyTree(tree([file('pnpm-lock.yaml')]));
    expect(result.dependencySignals.manifestPaths).toContain('pnpm-lock.yaml');
  });
});

// ── 8. Multiple test-file naming patterns ────────────────────────────────────
describe('classifyTree — test-file naming patterns', () => {
  const testFiles = [
    file('src/a.test.js'),
    file('src/b.spec.js'),
    file('src/c.test.jsx'),
    file('src/d.spec.jsx'),
    file('src/e.test.ts'),
    file('src/f.spec.ts'),
    file('src/g.test.tsx'),
    file('src/h.spec.tsx'),
    file('src/i.test.mjs'),
    file('src/j.spec.cjs'),
  ];

  test('all common test patterns are detected', () => {
    const result = classifyTree(tree(testFiles));
    expect(result.structure.testFileCount).toBe(testFiles.length);
  });

  test('none of the test files are counted as source files', () => {
    const result = classifyTree(tree(testFiles));
    expect(result.structure.sourceFileCount).toBe(0);
  });

  test('a file like setup.js (no test/spec) is NOT a test file', () => {
    const result = classifyTree(tree([file('src/setup.js')]));
    expect(result.structure.testFileCount).toBe(0);
    expect(result.structure.sourceFileCount).toBe(1);
  });
});

// ── 9. Nested test directories ────────────────────────────────────────────────
describe('classifyTree — nested test directories', () => {
  const entries = [
    dir('__tests__'),
    dir('__tests__/unit'),
    dir('__tests__/integration'),
    file('__tests__/unit/foo.js'),
    file('__tests__/integration/bar.js'),
    file('src/helpers.js'),
  ];

  test('files inside __tests__ are classified as test files', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.testFileCount).toBe(2);
    expect(result.testingSignals.testFilePaths).toContain('__tests__/unit/foo.js');
    expect(result.testingSignals.testFilePaths).toContain('__tests__/integration/bar.js');
  });

  test('nested test files are not counted as source files', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.sourceFileCount).toBe(1);
  });

  test('hasTests is true when test directory is present', () => {
    const result = classifyTree(tree([dir('__tests__')]));
    expect(result.structure.hasTests).toBe(true);
  });

  test('files inside tests/ directory are detected', () => {
    const result = classifyTree(tree([dir('tests'), file('tests/index.test.js')]));
    expect(result.structure.testFileCount).toBe(1);
  });

  test('files inside test/ directory are detected', () => {
    const result = classifyTree(tree([dir('test'), file('test/app.js')]));
    expect(result.structure.testFileCount).toBe(1);
  });
});

// ── 10. Directory vs file handling ────────────────────────────────────────────
describe('classifyTree — directory vs file handling', () => {
  test('tree containing only directories has zero files', () => {
    const result = classifyTree(tree([dir('src'), dir('docs'), dir('test')]));

    expect(result.structure.totalFiles).toBe(0);
    expect(result.structure.totalDirectories).toBe(3);
    expect(result.structure.sourceFileCount).toBe(0);
  });

  test('directories are not counted as source files', () => {
    const result = classifyTree(tree([dir('src'), dir('src/components')]));
    expect(result.structure.sourceFileCount).toBe(0);
  });

  test('test/ dir entry alone makes hasTests true', () => {
    const result = classifyTree(tree([dir('test')]));
    expect(result.structure.hasTests).toBe(true);
  });
});

// ── 11. Mixed source / config / documentation ────────────────────────────────
describe('classifyTree — mixed file types', () => {
  const entries = [
    dir('src'),
    dir('docs'),
    file('src/index.js'),
    file('src/app.jsx'),
    file('docs/guide.md'),
    file('README.md'),
    file('package.json'),
    file('.eslintrc.json'),
    file('jest.config.js'),
    file('tsconfig.json'),
    file('.gitignore'),
  ];

  test('source files counted correctly', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.sourceFileCount).toBe(2);
  });

  test('doc files counted correctly (README + guide.md)', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.docFileCount).toBe(2);
  });

  test('config files counted correctly', () => {
    const result = classifyTree(tree(entries));
    // .eslintrc.json, jest.config.js, tsconfig.json, .gitignore = 4
    expect(result.structure.configFileCount).toBe(4);
  });

  test('package.json counted as manifest, not source or config', () => {
    const result = classifyTree(tree(entries));
    expect(result.dependencySignals.manifestPaths).toContain('package.json');
    expect(result.structure.configFileCount).not.toBeGreaterThan(4);
  });

  test('result has expected top-level keys', () => {
    const result = classifyTree(tree(entries));
    expect(Object.keys(result).sort()).toEqual(
      ['dependencySignals', 'docSignals', 'structure', 'testingSignals', 'truncated']
    );
  });
});

// ── 12. Irrelevant file types ─────────────────────────────────────────────────
describe('classifyTree — irrelevant file types', () => {
  const entries = [
    file('image.png'),
    file('photo.jpg'),
    file('archive.zip'),
    file('binary.exe'),
    file('font.woff2'),
    file('video.mp4'),
  ];

  test('binary/media files are counted in totalFiles but not in any category', () => {
    const result = classifyTree(tree(entries));
    expect(result.structure.totalFiles).toBe(6);
    expect(result.structure.sourceFileCount).toBe(0);
    expect(result.structure.testFileCount).toBe(0);
    expect(result.structure.docFileCount).toBe(0);
    expect(result.structure.configFileCount).toBe(0);
  });

  test('binary files do not appear in any signal path arrays', () => {
    const result = classifyTree(tree(entries));
    expect(result.testingSignals.testFilePaths).toEqual([]);
    expect(result.docSignals.docFilePaths).toEqual([]);
    expect(result.dependencySignals.manifestPaths).toEqual([]);
  });
});

// ── Truncated flag passthrough ────────────────────────────────────────────────
describe('classifyTree — truncated flag', () => {
  test('passes truncated:true through from getRepoTree output', () => {
    const result = classifyTree(tree([file('src/index.js')], true));
    expect(result.truncated).toBe(true);
  });

  test('passes truncated:false through', () => {
    const result = classifyTree(tree([file('src/index.js')], false));
    expect(result.truncated).toBe(false);
  });
});

// ── Paths with spaces ─────────────────────────────────────────────────────────
describe('classifyTree — paths containing spaces', () => {
  test('classifies a source file with spaces in path', () => {
    const result = classifyTree(tree([file('my src/main index.js')]));
    expect(result.structure.sourceFileCount).toBe(1);
  });

  test('classifies a test file with spaces in path', () => {
    const result = classifyTree(tree([file('my tests/app.test.js')]));
    expect(result.structure.testFileCount).toBe(1);
  });
});

// ── Result is deterministic ────────────────────────────────────────────────────
describe('classifyTree — determinism', () => {
  test('same input produces identical output on repeated calls', () => {
    const entries = [
      dir('src'), dir('__tests__'),
      file('src/index.js'), file('src/utils.test.js'),
      file('README.md'), file('package.json'),
    ];

    const a = classifyTree(tree(entries));
    const b = classifyTree(tree(entries));

    expect(a).toEqual(b);
  });
});
