'use strict';

const { getRepoTree, getFileContent, MAX_CONTENT_BYTES } = require('./githubClient');
const classifyTree     = require('./classifyTree');
const { analyzeContent } = require('./analyzeContent');
const scoreHealth      = require('./scoreHealth');
const ScanResult       = require('../models/ScanResult');

/**
 * Determine which file paths need content retrieval.
 *
 * We fetch:
 *   - The first README (for documentation signals)
 *   - The package.json manifest (for dependency signals)
 *   - All source files (for quality signals — TODO/FIXME/large-file detection)
 *
 * Files whose tree-reported size exceeds MAX_CONTENT_BYTES are recorded as
 * skipped rather than fetched, so that the analyzeContent limitation is explicit.
 *
 * @param {{
 *   docSignals:        { readmePaths: string[] },
 *   dependencySignals: { manifestPaths: string[] },
 *   structure:         { sourceFileCount: number },
 * }} classification
 * @param {Array<{ path: string, type: string, size?: number }>} tree
 * @returns {{ toFetch: string[], skipped: string[] }}
 */
function selectFilesForFetch(classification, tree) {
  const sizeMap = new Map(tree.map((e) => [e.path, e.size ?? 0]));

  const candidates = new Set();

  // README (use first only — matches analyzeContent's behaviour)
  const readmePaths = classification.docSignals?.readmePaths ?? [];
  if (readmePaths.length > 0) {
    candidates.add(readmePaths[0]);
  }

  // package.json manifest
  const manifestPaths = classification.dependencySignals?.manifestPaths ?? [];
  const pkgPath = manifestPaths.find(
    (p) => p.split('/').pop().toLowerCase() === 'package.json'
  );
  if (pkgPath) {
    candidates.add(pkgPath);
  }

  // Source files (JS/TS blobs for quality analysis)
  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    const ext = entry.path.split('/').pop();
    // Re-use the same extension logic as classifyTree (JS/TS source files)
    if (/\.(js|jsx|mjs|cjs|ts|tsx)$/i.test(ext)) {
      candidates.add(entry.path);
    }
  }

  const toFetch  = [];
  const skipped  = [];

  for (const path of candidates) {
    const size = sizeMap.get(path) ?? 0;
    if (size > MAX_CONTENT_BYTES) {
      skipped.push(path);
    } else {
      toFetch.push(path);
    }
  }

  return { toFetch, skipped };
}

/**
 * runScan(repoInfo)
 *
 * Orchestrates the full scan pipeline for a validated repository.
 * Called by the route after URL parsing and getRepoInfo() succeed.
 *
 * Steps:
 *  1. Fetch the repository tree.
 *  2. Classify the tree.
 *  3. Select files that need content analysis.
 *  4. Fetch file contents (failures become skippedPaths rather than hard errors).
 *  5. Run analyzeContent().
 *  6. Merge all scanner signals.
 *  7. Run scoreHealth().
 *  8. Persist the ScanResult.
 *  9. Return the assembled result for the route to serialise.
 *
 * @param {{
 *   repoUrl:       string,
 *   owner:         string,
 *   repo:          string,
 *   defaultBranch: string,
 *   description:   string|null,
 *   language:      string|null,
 *   stars:         number,
 *   isPrivate:     boolean,
 * }} repoInfo
 * @returns {Promise<{
 *   scanId:            string,
 *   owner:             string,
 *   repo:              string,
 *   defaultBranch:     string,
 *   repoUrl:           string,
 *   description:       string|null,
 *   language:          string|null,
 *   stars:             number,
 *   truncated:         boolean,
 *   structure:         object,
 *   testingSignals:    object,
 *   docSignals:        object,
 *   qualitySignals:    object,
 *   dependencySignals: object,
 *   healthScore:       object,
 * }>}
 */
async function runScan(repoInfo) {
  const { owner, repo, defaultBranch, repoUrl } = repoInfo;

  // ── Step 1: Fetch the repository tree ─────────────────────────────────────────
  const treeResult = await getRepoTree(owner, repo, defaultBranch);

  // ── Step 2: Classify the tree ─────────────────────────────────────────────────
  const classification = classifyTree(treeResult);

  // ── Step 3: Determine which files to fetch ────────────────────────────────────
  const { toFetch, skipped: oversizedPaths } = selectFilesForFetch(
    classification,
    treeResult.tree
  );

  // ── Step 4: Fetch file contents ───────────────────────────────────────────────
  // Individual file failures are degraded to skipped rather than aborting the scan.
  const fetchedFiles   = [];
  const skippedPaths   = [...oversizedPaths];

  await Promise.all(
    toFetch.map(async (path) => {
      try {
        const result = await getFileContent(owner, repo, path, defaultBranch);
        if (result !== null) {
          fetchedFiles.push(result);
        } else {
          skippedPaths.push(path); // binary or oversized at fetch time
        }
      } catch {
        skippedPaths.push(path); // 404, rate-limit, or other transient error
      }
    })
  );

  // ── Step 5: Run content analysis ──────────────────────────────────────────────
  const contentResult = analyzeContent(fetchedFiles, classification, skippedPaths);

  // ── Step 6: Merge scanner signals ─────────────────────────────────────────────
  const mergedDocSignals = {
    ...classification.docSignals,           // docFileCount, readmePaths, docFilePaths
    ...contentResult.docSignals,            // readmePresent, readmeNonEmpty, readmeCharCount
  };

  const mergedDependencySignals = {
    ...classification.dependencySignals,    // hasPackageJson, manifestPaths
    ...contentResult.dependencySignals,     // packageJsonValid, hasDependencies, etc.
  };

  // ── Step 7: Score health ──────────────────────────────────────────────────────
  const healthScore = scoreHealth({
    structure:         classification.structure,
    testingSignals:    classification.testingSignals,
    docSignals:        mergedDocSignals,
    qualitySignals:    contentResult.qualitySignals,
    dependencySignals: mergedDependencySignals,
  });

  // ── Step 8: Persist ───────────────────────────────────────────────────────────
  const scanRecord = await ScanResult.create({
    repoUrl,
    owner,
    repo,
    defaultBranch,
    structure:         classification.structure,
    testingSignals:    classification.testingSignals,
    docSignals:        mergedDocSignals,
    qualitySignals:    contentResult.qualitySignals,
    dependencySignals: mergedDependencySignals,
    healthScore,
  });

  // ── Step 9: Return assembled result ───────────────────────────────────────────
  return {
    scanId:            scanRecord._id,
    owner:             scanRecord.owner,
    repo:              scanRecord.repo,
    defaultBranch:     scanRecord.defaultBranch,
    repoUrl:           scanRecord.repoUrl,
    description:       repoInfo.description,
    language:          repoInfo.language,
    stars:             repoInfo.stars,
    truncated:         treeResult.truncated,
    structure:         classification.structure,
    testingSignals:    classification.testingSignals,
    docSignals:        mergedDocSignals,
    qualitySignals:    contentResult.qualitySignals,
    dependencySignals: mergedDependencySignals,
    healthScore,
  };
}

module.exports = { runScan };
