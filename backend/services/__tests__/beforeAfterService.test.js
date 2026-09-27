'use strict';

const { compareBeforeAfter } = require('../beforeAfterService');
const AppError = require('../AppError');

function health(overall, categoryOverrides = {}) {
    return {
        healthScore: {
            testing: 40,
            documentation: 50,
            structure: 60,
            codeQuality: 70,
            dependencies: 80,
            overall,
            ...categoryOverrides,
        },
    };
}

function treatmentResult(overrides = {}) {
    return {
        status: 'applied',
        changedFiles: ['src/module.js'],
        beforeContent: { 'src/module.js': 'source before; SECRET=hidden' },
        workspacePath: 'C:\\private\\repo',
        proposedChanges: [{ relativePath: 'src/module.js', content: 'source after' }],
        ...overrides,
    };
}

function verificationResult(overrides = {}) {
    return {
        status: 'passed',
        checksRun: ['node --test'],
        passedChecks: ['node --test'],
        failedChecks: [],
        outputSummary: 'source contents and environment secrets are not comparison data',
        changedFiles: ['src/module.js'],
        beforeState: { 'src/module.js': { exists: true, sha256: 'a'.repeat(64) } },
        currentState: { 'src/module.js': { exists: true, sha256: 'b'.repeat(64) } },
        ...overrides,
    };
}

function compare(overrides = {}) {
    return compareBeforeAfter({
        beforeHealthResult: health(60),
        afterHealthResult: health(75),
        treatmentResult: treatmentResult(),
        verificationResult: verificationResult(),
        ...overrides,
    });
}

describe('beforeAfterService.compareBeforeAfter', () => {
    test('reports deterministic score improvement only after verification passes', () => {
        const result = compare();

        expect(result.beforeScore).toBe(60);
        expect(result.afterScore).toBe(75);
        expect(result.scoreDelta).toBe(15);
        expect(result.verificationStatus).toBe('passed');
        expect(result.improved).toBe(true);
        expect(result.summary).toContain('Health improved by 15 points');
    });

    test('reports no score change without marking improvement', () => {
        const result = compare({ afterHealthResult: health(60) });

        expect(result.scoreDelta).toBe(0);
        expect(result.improved).toBe(false);
        expect(result.summary).toContain('Health score was unchanged');
    });

    test('reports a negative score delta as a regression', () => {
        const result = compare({ afterHealthResult: health(55) });

        expect(result.scoreDelta).toBe(-5);
        expect(result.improved).toBe(false);
        expect(result.summary).toContain('decreased by 5 points');
    });

    test('does not mark a score increase as improved when verification failed', () => {
        const result = compare({
            verificationResult: verificationResult({
                status: 'failed',
                passedChecks: [],
                failedChecks: [{ check: 'node --test', exitCode: 1, output: 'failure details' }],
            })
        });

        expect(result.scoreDelta).toBe(15);
        expect(result.verificationStatus).toBe('failed');
        expect(result.improved).toBe(false);
        expect(result.verificationChecks.failedChecks).toEqual([{ check: 'node --test', exitCode: 1 }]);
    });

    test('preserves only relative files confirmed by both treatment and verification', () => {
        const result = compare({
            treatmentResult: treatmentResult({ changedFiles: ['src/module.js', 'src/only-treated.js'] }),
            verificationResult: verificationResult({ changedFiles: ['src/module.js', 'src/only-verified.js'] }),
        });

        expect(result.changedFiles).toEqual(['src/module.js']);
    });

    test('preserves category values from the actual before and after health results', () => {
        const result = compare({
            beforeHealthResult: health(60, { testing: 21, documentation: 31 }),
            afterHealthResult: health(75, { testing: 48, dependencies: 83 }),
        });

        expect(result.beforeCategories).toEqual({
            testing: 21, documentation: 31, structure: 60, codeQuality: 70, dependencies: 80,
        });
        expect(result.afterCategories).toEqual({
            testing: 48, documentation: 50, structure: 60, codeQuality: 70, dependencies: 83,
        });
    });

    test('treats a missing overall score as unavailable', () => {
        const result = compare({ beforeHealthResult: { healthScore: { testing: 20 } } });

        expect(result.beforeScore).toBeNull();
        expect(result.scoreDelta).toBeNull();
        expect(result.improved).toBe(false);
    });

    test('treats a missing after score as unavailable', () => {
        const result = compare({ afterHealthResult: { healthScore: { testing: 20 } } });

        expect(result.afterScore).toBeNull();
        expect(result.scoreDelta).toBeNull();
        expect(result.improved).toBe(false);
    });

    test('handles zero changed files without inventing file changes', () => {
        const result = compare({
            treatmentResult: treatmentResult({ status: 'no_changes', changedFiles: [], beforeContent: {} }),
            verificationResult: verificationResult({ changedFiles: [], checksRun: [], passedChecks: [] }),
        });

        expect(result.changedFiles).toEqual([]);
        expect(result.improved).toBe(true);
        expect(result.summary).toContain('No approved changed files were confirmed');
    });

    test('rejects malformed category objects and scores', () => {
        expect(() => compare({ beforeHealthResult: { healthScore: [] } })).toThrow(AppError);
        expect(() => compare({ afterHealthResult: health(75, { testing: 'high' }) })).toThrow(AppError);
    });

    test('rejects malformed top-level input and verification status', () => {
        expect(() => compareBeforeAfter({})).toThrow(AppError);
        expect(() => compare({ verificationResult: verificationResult({ status: 'unknown' }) })).toThrow(AppError);
    });

    test('does not include treatment contents, verification output, or workspace paths', () => {
        const result = compare();
        const serialized = JSON.stringify(result);

        expect(serialized).not.toContain('source before');
        expect(serialized).not.toContain('source after');
        expect(serialized).not.toContain('SECRET=hidden');
        expect(serialized).not.toContain('environment secrets');
        expect(serialized).not.toContain('C:\\private');
        expect(serialized).not.toContain('workspacePath');
    });

    test('rejects absolute or traversal changed-file paths', () => {
        expect(() => compare({
            treatmentResult: treatmentResult({ changedFiles: ['C:\\outside\\file.js'] }),
        })).toThrow(AppError);
        expect(() => compare({
            verificationResult: verificationResult({ changedFiles: ['../outside.js'] }),
        })).toThrow(AppError);
    });

    test('does not leak path or output fields from failed verification checks', () => {
        const result = compare({
            verificationResult: verificationResult({
                status: 'failed',
                failedChecks: [{ check: 'node --test', exitCode: 1, output: 'C:\\private\\repo\\file.js source contents' }],
            }),
        });

        expect(JSON.stringify(result)).not.toContain('C:\\private');
        expect(JSON.stringify(result)).not.toContain('source contents');
        expect(result.verificationChecks.failedChecks).toEqual([{ check: 'node --test', exitCode: 1 }]);
    });
});