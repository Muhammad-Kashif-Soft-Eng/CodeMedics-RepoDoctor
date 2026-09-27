'use strict';

const scoreHealth = require('../scoreHealth');

// ── T7-A: Testing score ───────────────────────────────────────────────────────

describe('scoreHealth — Testing', () => {
  test('returns 0 when testFileCount is 0', () => {
    const result = scoreHealth({
      structure:         { sourceFileCount: 10 },
      testingSignals:    { testFileCount: 0 },
      dependencySignals: { hasTestScript: true },
    });
    expect(result.testing).toBe(0);
  });

  test('returns 0 when sourceFileCount is 0 even with test files', () => {
    const result = scoreHealth({
      structure:         { sourceFileCount: 0 },
      testingSignals:    { testFileCount: 3 },
      dependencySignals: { hasTestScript: true },
    });
    expect(result.testing).toBe(0);
  });

  test('returns 90 for ratio >= 0.5 with test script (5 tests / 10 sources)', () => {
    const result = scoreHealth({
      structure:         { sourceFileCount: 10 },
      testingSignals:    { testFileCount: 5 },
      dependencySignals: { hasTestScript: true },
    });
    expect(result.testing).toBe(90);
  });

  test('returns 60 for ratio >= 0.25 without test script (3 tests / 10 sources)', () => {
    const result = scoreHealth({
      structure:         { sourceFileCount: 10 },
      testingSignals:    { testFileCount: 3 },
      dependencySignals: { hasTestScript: false },
    });
    expect(result.testing).toBe(60);
  });

  test('returns 20 for low ratio without test script (1 test / 20 sources)', () => {
    const result = scoreHealth({
      structure:         { sourceFileCount: 20 },
      testingSignals:    { testFileCount: 1 },
      dependencySignals: { hasTestScript: false },
    });
    expect(result.testing).toBe(20);
  });

  test('returns 40 for ratio >= 0.1 without test script (1 test / 8 sources)', () => {
    const result = scoreHealth({
      structure:         { sourceFileCount: 8 },
      testingSignals:    { testFileCount: 1 },
      dependencySignals: { hasTestScript: false },
    });
    expect(result.testing).toBe(40);
  });
});

// ── T7-B: Documentation score ─────────────────────────────────────────────────

describe('scoreHealth — Documentation', () => {
  test('returns 0 when no README present', () => {
    const result = scoreHealth({
      docSignals: { readmePresent: false, readmeNonEmpty: false, readmeCharCount: 0, docFileCount: 0 },
    });
    expect(result.documentation).toBe(0);
  });

  test('returns 30 when README present but empty', () => {
    const result = scoreHealth({
      docSignals: { readmePresent: true, readmeNonEmpty: false, readmeCharCount: 0, docFileCount: 0 },
    });
    expect(result.documentation).toBe(30);
  });

  test('returns 70 for README with 600 chars and 2 doc files', () => {
    const result = scoreHealth({
      docSignals: { readmePresent: true, readmeNonEmpty: true, readmeCharCount: 600, docFileCount: 2 },
    });
    expect(result.documentation).toBe(70);
  });

  test('returns 100 for README with 600 chars and 7 doc files', () => {
    const result = scoreHealth({
      docSignals: { readmePresent: true, readmeNonEmpty: true, readmeCharCount: 600, docFileCount: 7 },
    });
    expect(result.documentation).toBe(100);
  });
});

// ── T7-C: Structure score ─────────────────────────────────────────────────────

describe('scoreHealth — Structure', () => {
  test('returns 0 for empty tree (totalFiles === 0)', () => {
    const result = scoreHealth({
      structure: { totalFiles: 0 },
    });
    expect(result.structure).toBe(0);
  });

  test('returns 40 for 1 file, no package.json, no config files', () => {
    const result = scoreHealth({
      structure: { totalFiles: 1, hasPackageJson: false, configFileCount: 0, sourceFileCount: 0 },
    });
    expect(result.structure).toBe(40);
  });

  test('returns 90 for package.json + 1 config + 10 source files', () => {
    const result = scoreHealth({
      structure: {
        totalFiles: 15, hasPackageJson: true, configFileCount: 1, sourceFileCount: 10,
      },
    });
    expect(result.structure).toBe(90);
  });

  test('returns 100 for package.json + 4 config files + 10 source files', () => {
    const result = scoreHealth({
      structure: {
        totalFiles: 20, hasPackageJson: true, configFileCount: 4, sourceFileCount: 10,
      },
    });
    expect(result.structure).toBe(100);
  });

  test('does not award points for README presence', () => {
    // README is a docSignal, not a structure signal — structure score must ignore it
    const withDoc = scoreHealth({
      structure:  { totalFiles: 5, hasPackageJson: false, configFileCount: 0, sourceFileCount: 0 },
      docSignals: { readmePresent: true, readmeNonEmpty: true, readmeCharCount: 1000 },
    });
    const withoutDoc = scoreHealth({
      structure:  { totalFiles: 5, hasPackageJson: false, configFileCount: 0, sourceFileCount: 0 },
      docSignals: {},
    });
    expect(withDoc.structure).toBe(withoutDoc.structure);
  });
});

// ── T7-D: Code Quality score ──────────────────────────────────────────────────

describe('scoreHealth — Code Quality', () => {
  test('returns 50 when no files have been analyzed', () => {
    const result = scoreHealth({
      qualitySignals: { analyzedFileCount: 0 },
    });
    expect(result.codeQuality).toBe(50);
  });

  test('returns 100 for clean files (no markers, no large files)', () => {
    const result = scoreHealth({
      qualitySignals: { analyzedFileCount: 10, todoCount: 0, fixmeCount: 0, largeFileCount: 0 },
    });
    expect(result.codeQuality).toBe(100);
  });

  test('returns 70 for medium density (density 2.0) and 1 large file', () => {
    // 10 files, 20 markers → density 2.0 → −25; 1 large file → −5; 100 − 25 − 5 = 70
    const result = scoreHealth({
      qualitySignals: { analyzedFileCount: 10, todoCount: 20, fixmeCount: 0, largeFileCount: 1 },
    });
    expect(result.codeQuality).toBe(70);
  });

  test('returns 50 for high density (density 6.0) and 3 large files', () => {
    // 2 files, 12 markers → density 6.0 → −40; 3 large files → −10; 100 − 40 − 10 = 50
    const result = scoreHealth({
      qualitySignals: { analyzedFileCount: 2, todoCount: 12, fixmeCount: 0, largeFileCount: 3 },
    });
    expect(result.codeQuality).toBe(50);
  });
});

// ── T7-E: Dependencies score ──────────────────────────────────────────────────

describe('scoreHealth — Dependencies', () => {
  test('returns 0 when no package.json', () => {
    const result = scoreHealth({
      dependencySignals: { hasPackageJson: false },
    });
    expect(result.dependencies).toBe(0);
  });

  test('returns 0 when package.json is invalid', () => {
    const result = scoreHealth({
      dependencySignals: { hasPackageJson: true, packageJsonValid: false },
    });
    expect(result.dependencies).toBe(0);
  });

  test('returns 40 for valid package.json with no deps and no scripts', () => {
    const result = scoreHealth({
      dependencySignals: {
        hasPackageJson: true, packageJsonValid: true,
        hasDependencies: false, hasDevDependencies: false,
        hasTestScript: false, scripts: [],
      },
    });
    expect(result.dependencies).toBe(40);
  });

  test('returns 100 for valid package.json with deps, devDeps, test script, and 4 scripts', () => {
    const result = scoreHealth({
      dependencySignals: {
        hasPackageJson: true, packageJsonValid: true,
        hasDependencies: true, hasDevDependencies: true,
        hasTestScript: true, scripts: ['test', 'start', 'build', 'lint'],
      },
    });
    expect(result.dependencies).toBe(100);
  });
});

// ── T7-F: Overall formula ─────────────────────────────────────────────────────

describe('scoreHealth — Overall formula', () => {
  test('empty signals produce predictable integer outputs', () => {
    const result = scoreHealth({});
    // testing=0, documentation=0, structure=0, codeQuality=50, dependencies=0
    // overall = 0*0.30 + 0*0.20 + 0*0.20 + 50*0.15 + 0*0.15 = 7.5 → rounds to 8
    expect(result.testing).toBe(0);
    expect(result.documentation).toBe(0);
    expect(result.structure).toBe(0);
    expect(result.codeQuality).toBe(50);
    expect(result.dependencies).toBe(0);
    expect(result.overall).toBe(8);
  });

  test('healthy signals produce overall > 60', () => {
    const result = scoreHealth({
      structure: { totalFiles: 20, hasPackageJson: true, configFileCount: 3, sourceFileCount: 10 },
      testingSignals: { testFileCount: 6 },
      docSignals: { readmePresent: true, readmeNonEmpty: true, readmeCharCount: 600, docFileCount: 4 },
      qualitySignals: { analyzedFileCount: 10, todoCount: 0, fixmeCount: 0, largeFileCount: 0 },
      dependencySignals: {
        hasPackageJson: true, packageJsonValid: true,
        hasDependencies: true, hasDevDependencies: true,
        hasTestScript: true, scripts: ['test', 'start', 'build', 'lint'],
      },
    });
    expect(result.overall).toBeGreaterThan(60);
  });
});

// ── T7-G: Module contract ─────────────────────────────────────────────────────

describe('scoreHealth — Module contract', () => {
  test('scoreHealth() with no arguments does not throw', () => {
    expect(() => scoreHealth()).not.toThrow();
  });

  test('scoreHealth(undefined) does not throw', () => {
    expect(() => scoreHealth(undefined)).not.toThrow();
  });

  test('no field in result is NaN', () => {
    const result = scoreHealth();
    for (const [key, value] of Object.entries(result)) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  test('no field in result is undefined', () => {
    const result = scoreHealth();
    const fields = ['testing', 'documentation', 'structure', 'codeQuality', 'dependencies', 'overall'];
    for (const field of fields) {
      expect(result[field]).not.toBeUndefined();
    }
  });

  test('all fields are integers in range [0, 100]', () => {
    const result = scoreHealth({
      structure: { totalFiles: 5, hasPackageJson: true, configFileCount: 2, sourceFileCount: 5 },
      testingSignals: { testFileCount: 2 },
      docSignals: { readmePresent: true, readmeNonEmpty: true, readmeCharCount: 300 },
      qualitySignals: { analyzedFileCount: 5, todoCount: 3, fixmeCount: 1, largeFileCount: 0 },
      dependencySignals: {
        hasPackageJson: true, packageJsonValid: true,
        hasDependencies: true, hasDevDependencies: false,
        hasTestScript: true, scripts: ['test', 'start'],
      },
    });
    const fields = ['testing', 'documentation', 'structure', 'codeQuality', 'dependencies', 'overall'];
    for (const field of fields) {
      expect(Number.isInteger(result[field])).toBe(true);
      expect(result[field]).toBeGreaterThanOrEqual(0);
      expect(result[field]).toBeLessThanOrEqual(100);
    }
  });

  test('result always contains all six required fields', () => {
    const result = scoreHealth();
    expect(result).toHaveProperty('testing');
    expect(result).toHaveProperty('documentation');
    expect(result).toHaveProperty('structure');
    expect(result).toHaveProperty('codeQuality');
    expect(result).toHaveProperty('dependencies');
    expect(result).toHaveProperty('overall');
  });
});

// ── clamp helper behaviour ────────────────────────────────────────────────────

describe('scoreHealth — clamp helper', () => {
  test('values below 0 are clamped to 0', () => {
    // Force a below-zero input via code-quality: 100 − 40 − 20 − 20 would be
    // negative if tiers stacked, but the approved formula caps at two tiers.
    // Test via the overall formula: feed all-zero categories except codeQuality=0
    // by using an absurdly large marker density AND large files with a wrapper.
    // The cleanest route: scoreCodeQuality is private, so drive it through the
    // public API and confirm the output is >= 0.
    const result = scoreHealth({
      qualitySignals: { analyzedFileCount: 1, todoCount: 1000, fixmeCount: 1000, largeFileCount: 10 },
    });
    expect(result.codeQuality).toBeGreaterThanOrEqual(0);
  });

  test('values above 100 are clamped to 100', () => {
    // documentation: 30+20+20+15+15 = 100 — would exceed 100 if clamp were absent
    // and a bug inflated points; with correct clamp it stays at 100.
    const result = scoreHealth({
      docSignals: {
        readmePresent: true, readmeNonEmpty: true,
        readmeCharCount: 600, docFileCount: 7,
      },
    });
    expect(result.documentation).toBe(100);
    expect(result.documentation).toBeLessThanOrEqual(100);
  });

  test('fractional intermediate values are rounded to integers', () => {
    // overall = testing*0.30 + … produces a fractional sum; result must be integer
    // Use signals that produce overall = 7.5 (rounds to 8)
    const result = scoreHealth({});
    // testing=0, doc=0, structure=0, codeQuality=50, deps=0
    // overall = 50*0.15 = 7.5 → Math.round → 8
    expect(result.overall).toBe(8);
    expect(Number.isInteger(result.overall)).toBe(true);
  });
});
