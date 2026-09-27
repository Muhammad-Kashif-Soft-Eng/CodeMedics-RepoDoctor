# Health Analysis Plan — Task 7: `scoreHealth` Service

## Overview

**Goal:** Implement `backend/services/scoreHealth.js` — a pure, deterministic function that
accepts the combined scan signals already produced by `classifyTree()` and `analyzeContent()`
and returns a validated `healthScore` object ready to be persisted to MongoDB.

**Scope:** This task covers the scoring function itself and its unit tests only.
Wiring the scorer into the scan route (`routes/scan.js`) is a separate integration task
handled by Member 1 after this function is complete.

**Non-goals:** No LLM calls, no network calls, no database writes, no diagnosis logic,
no frontend changes, no changes to any existing file.

---

## Input Contract

`scoreHealth` receives a single plain-object argument assembled from the two scanner outputs:

```js
scoreHealth({
  structure,         // from classifyTree()
  testingSignals,    // from classifyTree()
  docSignals,        // merged from classifyTree() + analyzeContent()
  qualitySignals,    // from analyzeContent()
  dependencySignals, // merged from classifyTree() + analyzeContent()
})
```

All fields are optional at the JS level (the schema stores them as `Mixed` with `default: {}`).
The scorer must treat any missing or absent sub-field as zero / false / absent — never throw.
The function must also accept `undefined` as its entire argument without throwing.

---

## Output Contract

Returns a plain object satisfying the `categoryScoresSchema` in `ScanResult.js`:

```js
{
  testing:       <integer 0-100>,
  documentation: <integer 0-100>,
  structure:     <integer 0-100>,
  codeQuality:   <integer 0-100>,
  dependencies:  <integer 0-100>,
  overall:       <integer 0-100>,   // weighted average of the 5 categories
}
```

All values must be integers (use `Math.round`). All values must be clamped to `[0, 100]`.
No value may ever be `NaN` or `undefined`, even when all input signals are missing.

---

## Sub-Tasks

---

### T7-A: Testing Score

**Status:** [ ] pending

**Intent**
Score the repository's testing health from the signals that `classifyTree()` and
`analyzeContent()` produce. The score must be zero when there are no source files or
no test files, and approach 100 for a well-tested project.

**Signals used**

| Signal | Source |
|---|---|
| `testingSignals.testFileCount` | classifyTree |
| `structure.sourceFileCount` | classifyTree |
| `dependencySignals.hasTestScript` | analyzeContent |

**Scoring rules**

1. Read `testFileCount` from `testingSignals` (default `0`).
2. Read `sourceFileCount` from `structure` (default `0`).
3. If `testFileCount === 0` → score is **0**, stop.
4. If `sourceFileCount === 0` → score is **0**, stop.
   _(A repo with test files but no source files cannot have a meaningful test ratio.)_
5. Compute **test ratio** = `testFileCount / sourceFileCount`.
6. Map ratio to a base score:
   - ratio ≥ 0.5  → base **80**
   - ratio ≥ 0.25 → base **60**
   - ratio ≥ 0.1  → base **40**
   - ratio > 0    → base **20**
7. Bonus +10 if `dependencySignals.hasTestScript === true`.
8. Clamp result to **[0, 100]** and round to integer.

**Expected outcomes**
- `testFileCount === 0` → `testing: 0`.
- `sourceFileCount === 0` (even with test files) → `testing: 0`.
- 5 test files, 10 source files (ratio 0.5) + test script → `testing: 90`.
- 1 test file, 20 source files (ratio 0.05) + no test script → `testing: 20`.
- 3 test files, 10 source files (ratio 0.3) + no test script → `testing: 60`.

**Relevant context**
- `backend/services/classifyTree.js` — `testFileCount`, `sourceFileCount`
- `backend/services/analyzeContent.js` — `hasTestScript`

---

### T7-B: Documentation Score

**Status:** [ ] pending

**Intent**
Score documentation presence and completeness. README signals are the primary driver;
additional doc files provide a secondary boost. This is the only category that uses
README signals — Structure does not duplicate them.

**Signals used**

| Signal | Source |
|---|---|
| `docSignals.readmePresent` | analyzeContent |
| `docSignals.readmeNonEmpty` | analyzeContent |
| `docSignals.readmeCharCount` | analyzeContent |
| `docSignals.docFileCount` | classifyTree |

**Scoring rules**

1. Start at **0**.
2. +30 if `readmePresent === true`.
3. +20 if `readmeNonEmpty === true`.
4. +20 if `readmeCharCount >= 500` (meaningful content, not a stub).
5. +15 if `docFileCount >= 3` (docs beyond the README — CONTRIBUTING, CHANGELOG, docs/, etc.).
6. +15 if `docFileCount >= 6`.
7. Clamp to **[0, 100]** and round to integer.

**Expected outcomes**
- No README → `documentation: 0`.
- README present but empty → `documentation: 30`.
- README with 600 chars, 2 doc files total → `documentation: 70`.
- README with 600 chars, 7 doc files total → `documentation: 100`.

**Relevant context**
- `backend/services/analyzeContent.js` — `readmePresent`, `readmeNonEmpty`, `readmeCharCount`
- `backend/services/classifyTree.js` — `docFileCount`

---

### T7-C: Structure Score

**Status:** [ ] pending

**Intent**
Score the organizational health of the repository based on project configuration and
source-code layout. This category focuses exclusively on structural signals:
the presence of a package manifest, configuration tooling, and a meaningful amount
of source code. README presence and test presence are owned by Documentation and
Testing respectively and must not be scored here.

**Signals used**

| Signal | Source |
|---|---|
| `structure.hasPackageJson` | classifyTree |
| `structure.sourceFileCount` | classifyTree |
| `structure.totalFiles` | classifyTree |
| `structure.configFileCount` | classifyTree |
| `structure.totalDirectories` | classifyTree |

**Scoring rules**

1. If `totalFiles === 0` → score is **0**, stop. _(Empty repository.)_
2. Start at **40** (baseline — any non-empty repo with detectable structure gets a floor).
3. +25 if `hasPackageJson === true`. _(Project has a recognised dependency manifest.)_
4. +15 if `configFileCount >= 1`. _(At least one config file: linter, formatter, build, etc.)_
5. +10 if `configFileCount >= 3`. _(Multiple config files — project is well-configured.)_
6. +10 if `sourceFileCount >= 5`. _(Non-trivial source code present.)_
7. Clamp to **[0, 100]** and round to integer.

**Expected outcomes**
- Empty tree (`totalFiles === 0`) → `structure: 0`.
- 1 file, no package.json, no config files → `structure: 40`.
- package.json + 1 config file + 10 source files → `structure: 90`.
- package.json + 4 config files + 10 source files → `structure: 100`.

**Relevant context**
- `backend/services/classifyTree.js` — all `structure` fields

---

### T7-D: Code Quality Score

**Status:** [ ] pending

**Intent**
Score code quality from the maintainability signals that `analyzeContent()` produces.
A score of 100 means clean files with no markers and no oversized files.
Deductions apply for TODO/FIXME density and for large files.

**Signals used**

| Signal | Source |
|---|---|
| `qualitySignals.todoCount` | analyzeContent |
| `qualitySignals.fixmeCount` | analyzeContent |
| `qualitySignals.largeFileCount` | analyzeContent |
| `qualitySignals.analyzedFileCount` | analyzeContent |

**Scoring rules**

1. Start at **100**.
2. If `analyzedFileCount === 0` → score is **50** (no data — return neutral score).
3. Compute **marker density** = `(todoCount + fixmeCount) / analyzedFileCount`.
4. Deduct for marker density (use the highest applicable tier only):
   - density ≥ 5   → −40
   - density ≥ 2   → −25
   - density ≥ 1   → −15
   - density ≥ 0.5 → −5
5. Deduct for large files (use the highest applicable tier only):
   - `largeFileCount >= 5` → −20
   - `largeFileCount >= 2` → −10
   - `largeFileCount >= 1` → −5
6. Clamp to **[0, 100]** and round to integer.

**Expected outcomes**
- No analyzed files → `codeQuality: 50`.
- 10 analyzed files, 0 markers, 0 large files → `codeQuality: 100`.
- 10 analyzed files, 20 markers (density 2.0), 1 large file → `codeQuality: 70` (100 − 25 − 5).
- 2 analyzed files, 12 markers (density 6.0), 3 large files → `codeQuality: 40` (100 − 40 − 10, then clamp ≥ 0).

**Relevant context**
- `backend/services/analyzeContent.js` — `qualitySignals`

---

### T7-E: Dependencies Score

**Status:** [ ] pending

**Intent**
Score dependency hygiene from the package.json signals produced by `analyzeContent()`.
A missing or unparseable package.json scores zero. A complete, well-scripted manifest
scores 100.

**Signals used**

| Signal | Source |
|---|---|
| `dependencySignals.hasPackageJson` | classifyTree |
| `dependencySignals.packageJsonValid` | analyzeContent |
| `dependencySignals.hasDependencies` | analyzeContent |
| `dependencySignals.hasDevDependencies` | analyzeContent |
| `dependencySignals.hasTestScript` | analyzeContent |
| `dependencySignals.scripts` | analyzeContent |

**Scoring rules**

1. If `hasPackageJson === false` → score is **0**, stop.
2. If `packageJsonValid !== true` → score is **0**, stop.
   _(package.json exists but could not be parsed — worse than absent.)_
3. Start at **40** (valid package.json baseline).
4. +20 if `hasDependencies === true`.
5. +15 if `hasDevDependencies === true`.
6. +15 if `hasTestScript === true`.
7. +10 if `scripts.length >= 3` (project has a meaningful script set beyond just `test`).
8. Clamp to **[0, 100]** and round to integer.

**Expected outcomes**
- No package.json → `dependencies: 0`.
- package.json present but invalid JSON → `dependencies: 0`.
- Valid package.json, no deps, no scripts → `dependencies: 40`.
- Valid, deps + devDeps + test script + 4 scripts → `dependencies: 100`.

**Relevant context**
- `backend/services/classifyTree.js` — `hasPackageJson`
- `backend/services/analyzeContent.js` — `packageJsonValid`, `hasDependencies`, `hasDevDependencies`, `hasTestScript`, `scripts`

---

### T7-F: Overall Score + Module Assembly

**Status:** [ ] pending

**Intent**
Compute the weighted overall score, assemble the complete module, and guarantee
the output is always a valid plain object with no NaN or undefined values.

**Overall formula**

```
overall = clamp(round(
  testing       * 0.30 +
  documentation * 0.20 +
  structure     * 0.20 +
  codeQuality   * 0.15 +
  dependencies  * 0.15
), 0, 100)
```

Weights sum to 1.0 exactly. Each category input is already an integer 0–100,
so the sum is always in range before clamping. `NaN` cannot occur because every
category scorer returns a number (no category returns `undefined`).

**Module shape**

```js
// backend/services/scoreHealth.js
'use strict';

function clamp(n) { return Math.min(100, Math.max(0, Math.round(n))); }

function scoreTesting(testingSignals, structure, dependencySignals) { ... }
function scoreDocumentation(docSignals) { ... }
function scoreStructure(structure) { ... }
function scoreCodeQuality(qualitySignals) { ... }
function scoreDependencies(dependencySignals) { ... }

function scoreHealth({
  structure         = {},
  testingSignals    = {},
  docSignals        = {},
  qualitySignals    = {},
  dependencySignals = {},
} = {}) {
  const testing       = scoreTesting(testingSignals, structure, dependencySignals);
  const documentation = scoreDocumentation(docSignals);
  const str           = scoreStructure(structure);
  const codeQuality   = scoreCodeQuality(qualitySignals);
  const dependencies  = scoreDependencies(dependencySignals);
  const overall       = clamp(
    testing * 0.30 + documentation * 0.20 +
    str     * 0.20 + codeQuality   * 0.15 +
    dependencies * 0.15
  );
  return { testing, documentation, structure: str, codeQuality, dependencies, overall };
}

module.exports = scoreHealth;
```

**Expected outcomes**
- `scoreHealth({})` returns all six fields as integers in `[0, 100]`.
- `scoreHealth(undefined)` does not throw.
- No field in the result is ever `NaN` or `undefined`.

---

### T7-G: Unit Tests

**Status:** [ ] pending

**Intent**
Cover every scoring rule from T7-A through T7-F with deterministic Jest tests.
Zero real network calls, zero MongoDB connections.

**File:** `backend/services/__tests__/scoreHealth.test.js`

**Test structure**

Each scoring rule from T7-A through T7-E gets its own `describe` block.
The overall formula and the module contract each get their own block.

Minimum test cases per category:

| Block | Cases |
|---|---|
| Testing | zero tests; zero source files (even with tests); ratio ≥ 0.5 + script; ratio ≥ 0.25 no script; low ratio no script |
| Documentation | no readme; empty readme; 600-char readme, 2 docs; 600-char readme, 7 docs |
| Structure | empty tree; 1 file no pkg no config; pkg + 1 config + 10 src; pkg + 4 config + 10 src |
| Code Quality | no files; clean files; medium markers + 1 large; high markers + many large |
| Dependencies | no pkg; invalid pkg; valid no deps; valid full |
| Overall formula | empty signals → predictable integers; healthy signals → overall > 60 |
| Module contract | `scoreHealth()` with no args does not throw; no field is NaN |

Total: ≥ 23 test cases.

**Test helper pattern** (follow the style of `analyzeContent.test.js`)

```js
'use strict';
const scoreHealth = require('../scoreHealth');

describe('scoreHealth — Testing', () => {
  test('returns 0 when no source files exist', () => {
    const result = scoreHealth({
      structure:         { sourceFileCount: 0 },
      testingSignals:    { testFileCount: 3 },
      dependencySignals: { hasTestScript: true },
    });
    expect(result.testing).toBe(0);
  });
});
```

**Relevant context**
- `backend/services/__tests__/analyzeContent.test.js` — follow the fixture + `describe` pattern
- `backend/package.json` — Jest already installed; run with `npm test`

---

## Implementation Order

```
T7-A  Testing score
T7-B  Documentation score
T7-C  Structure score
T7-D  Code Quality score
T7-E  Dependencies score
T7-F  Overall score + clamp helper + module export
T7-G  Unit tests (single file covering all sub-tasks)
```

All scoring helpers (T7-A through T7-E) are private functions in `scoreHealth.js`,
exported only through the single `scoreHealth` function. Tests are written last as
a single coherent suite in T7-G.

---

## Files Changed

| File | Action |
|---|---|
| `backend/services/scoreHealth.js` | **Create** |
| `backend/services/__tests__/scoreHealth.test.js` | **Create** |

No other file is modified.

---

## Completion Criteria

- [ ] `backend/services/scoreHealth.js` exists and exports a single `scoreHealth` function.
- [ ] `scoreHealth({})` returns `{ testing, documentation, structure, codeQuality, dependencies, overall }` with all six values as integers 0–100.
- [ ] `scoreHealth(undefined)` does not throw and returns valid integers.
- [ ] No output field is ever `NaN` or `undefined`.
- [ ] Testing score is `0` when `sourceFileCount === 0`, regardless of `testFileCount`.
- [ ] Structure score does not award points for README presence or test-file presence.
- [ ] Overall score uses weights 30 / 20 / 20 / 15 / 15 exactly.
- [ ] `backend/services/__tests__/scoreHealth.test.js` exists with ≥ 23 test cases.
- [ ] `npm test` passes with 0 failures (all 214 existing tests + new scoreHealth tests).
- [ ] No new npm production dependencies added.
- [ ] `ScanResult.js`, `classifyTree.js`, `analyzeContent.js`, `scan.js`, and all frontend files are unchanged.
