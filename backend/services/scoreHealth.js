'use strict';

// ── Shared helper ─────────────────────────────────────────────────────────────

function clamp(n) {
  return Math.min(100, Math.max(0, Math.round(n)));
}

// ── T7-A: Testing score ───────────────────────────────────────────────────────

function scoreTesting(testingSignals, structure, dependencySignals) {
  const testFileCount   = testingSignals.testFileCount   || 0;
  const sourceFileCount = structure.sourceFileCount      || 0;

  if (testFileCount   === 0) return 0;
  if (sourceFileCount === 0) return 0;

  const ratio = testFileCount / sourceFileCount;
  let base;
  if      (ratio >= 0.5)  base = 80;
  else if (ratio >= 0.25) base = 60;
  else if (ratio >= 0.1)  base = 40;
  else                    base = 20;

  const bonus = dependencySignals.hasTestScript === true ? 10 : 0;
  return clamp(base + bonus);
}

// ── T7-B: Documentation score ─────────────────────────────────────────────────

function scoreDocumentation(docSignals) {
  let score = 0;
  if (docSignals.readmePresent  === true) score += 30;
  if (docSignals.readmeNonEmpty === true) score += 20;
  if ((docSignals.readmeCharCount || 0) >= 500) score += 20;
  if ((docSignals.docFileCount   || 0) >= 3)   score += 15;
  if ((docSignals.docFileCount   || 0) >= 6)   score += 15;
  return clamp(score);
}

// ── T7-C: Structure score ─────────────────────────────────────────────────────

function scoreStructure(structure) {
  if ((structure.totalFiles || 0) === 0) return 0;

  let score = 40;
  if (structure.hasPackageJson === true)              score += 25;
  if ((structure.configFileCount || 0) >= 1)         score += 15;
  if ((structure.configFileCount || 0) >= 3)         score += 10;
  if ((structure.sourceFileCount || 0) >= 5)         score += 10;
  return clamp(score);
}

// ── T7-D: Code Quality score ──────────────────────────────────────────────────

function scoreCodeQuality(qualitySignals) {
  const analyzedFileCount = qualitySignals.analyzedFileCount || 0;
  if (analyzedFileCount === 0) return 50;

  const todoCount      = qualitySignals.todoCount      || 0;
  const fixmeCount     = qualitySignals.fixmeCount     || 0;
  const largeFileCount = qualitySignals.largeFileCount || 0;

  const density = (todoCount + fixmeCount) / analyzedFileCount;

  let markerDeduction;
  if      (density >= 5)   markerDeduction = 40;
  else if (density >= 2)   markerDeduction = 25;
  else if (density >= 1)   markerDeduction = 15;
  else if (density >= 0.5) markerDeduction = 5;
  else                     markerDeduction = 0;

  let largeDeduction;
  if      (largeFileCount >= 5) largeDeduction = 20;
  else if (largeFileCount >= 2) largeDeduction = 10;
  else if (largeFileCount >= 1) largeDeduction = 5;
  else                          largeDeduction = 0;

  return clamp(100 - markerDeduction - largeDeduction);
}

// ── T7-E: Dependencies score ──────────────────────────────────────────────────

function scoreDependencies(dependencySignals) {
  if (dependencySignals.hasPackageJson    !== true) return 0;
  if (dependencySignals.packageJsonValid  !== true) return 0;

  let score = 40;
  if (dependencySignals.hasDependencies    === true)         score += 20;
  if (dependencySignals.hasDevDependencies === true)         score += 15;
  if (dependencySignals.hasTestScript      === true)         score += 15;
  if ((dependencySignals.scripts || []).length >= 3)         score += 10;
  return clamp(score);
}

// ── T7-F: Overall score + module assembly ─────────────────────────────────────

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
