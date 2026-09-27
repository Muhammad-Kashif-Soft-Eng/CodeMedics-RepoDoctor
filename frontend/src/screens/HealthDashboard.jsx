import { ArrowLeft, AlertTriangle, CheckCircle2, CircleHelp, Stethoscope } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ScoreCard from '../components/ScoreCard';
import { useWorkflow } from '../context/WorkflowContext';

const scoreCategories = [
  ['testing', 'Testing'],
  ['documentation', 'Documentation'],
  ['structure', 'Structure'],
  ['codeQuality', 'Code Quality'],
  ['dependencies', 'Dependencies'],
];

function isScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function Stat({ label, value }) {
  return (
    <div className="border-l-2 border-emerald-700 pl-3">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function HealthDashboard() {
  const { scanResult } = useWorkflow();
  const navigate = useNavigate();

  if (!scanResult) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
        <section role="alert" className="w-full max-w-lg rounded-xl border border-amber-200 bg-white p-7 shadow-sm">
          <CircleHelp aria-hidden="true" className="mb-4 size-8 text-amber-700" />
          <h1 className="text-xl font-bold">No scan result available</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Start a repository scan to view its health dashboard.</p>
          <button onClick={() => navigate('/')} className="mt-6 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
            Start a scan
          </button>
        </section>
      </main>
    );
  }

  const healthScore = scanResult.healthScore ?? {};
  const missingScores = ['overall', ...scoreCategories.map(([key]) => key)]
    .filter((key) => !isScore(healthScore[key]));
  const structure = scanResult.structure ?? {};
  const testingSignals = scanResult.testingSignals ?? {};
  const docSignals = scanResult.docSignals ?? {};
  const qualitySignals = scanResult.qualitySignals ?? {};
  const readmePaths = Array.isArray(docSignals.readmePaths) ? docSignals.readmePaths : [];
  const skippedPaths = Array.isArray(qualitySignals.skippedFilePaths)
    ? qualitySignals.skippedFilePaths
    : null;

  const limitations = [];
  if (scanResult.truncated === true) {
    limitations.push('GitHub returned a truncated repository tree; file and signal counts may be incomplete.');
  }
  if (skippedPaths?.length) {
    limitations.push(`${skippedPaths.length} file${skippedPaths.length === 1 ? '' : 's'} could not be analyzed for content.`);
  }
  if (scanResult.truncated !== true && skippedPaths?.length === 0) {
    limitations.push('No scan limitations were reported.');
  }
  if (scanResult.truncated == null && skippedPaths == null) {
    limitations.push('Limitation details were not included in the scan result.');
  }

  const readmeStatus = docSignals.readmePresent === true
    ? docSignals.readmeNonEmpty === true ? 'Present, with content' : 'Present, empty or unreadable'
    : readmePaths.length > 0
      ? docSignals.readmePresent === false ? 'Found, content unavailable' : 'Found, content status unavailable'
      : docSignals.readmePresent === false ? 'Not found' : 'Unavailable';
  const fileCount = Number.isFinite(structure.totalFiles) ? structure.totalFiles : 'Unavailable';
  const testFileCount = Number.isFinite(testingSignals.testFileCount)
    ? testingSignals.testFileCount
    : Number.isFinite(structure.testFileCount) ? structure.testFileCount : 'Unavailable';
  const docFileCount = Number.isFinite(docSignals.docFileCount)
    ? docSignals.docFileCount
    : Number.isFinite(structure.docFileCount) ? structure.docFileCount : null;
  const scannedStatus = scanResult.truncated === true
    ? 'Tree truncated'
    : scanResult.truncated === false ? 'Complete tree' : 'Unavailable';

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-800">Codemedics · Repository health</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Health Dashboard</h1>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Scan another repository"
            title="Scan another repository"
            className="grid size-10 place-items-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
        </header>

        {missingScores.length > 0 && (
          <div role="alert" className="mb-6 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
            <p>Some health scores are missing or invalid ({missingScores.join(', ')}). Unavailable values are shown as —.</p>
          </div>
        )}

        <section aria-labelledby="repo-title" className="mb-6">
          <p className="text-sm text-slate-500">Repository</p>
          <h2 id="repo-title" className="mt-1 break-all text-xl font-semibold">
            {scanResult.owner && scanResult.repo ? `${scanResult.owner}/${scanResult.repo}` : 'Repository name unavailable'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Default branch: <span className="font-medium text-slate-800">{scanResult.defaultBranch || 'Unavailable'}</span>
          </p>
        </section>

        <section aria-label="Health scores">
          <div className="mb-3 flex items-end justify-between gap-4">
            <h2 className="text-lg font-semibold">Overall health</h2>
            <span className="text-xs text-slate-500">Codemedics score · out of 100</span>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 sm:p-7">
            <p className="text-sm font-medium text-emerald-950">Overall score</p>
            <p className="mt-1 text-5xl font-bold tabular-nums text-emerald-900">
              {isScore(healthScore.overall) ? healthScore.overall : '—'}
              <span className="ml-2 text-base font-medium text-emerald-800">/ 100</span>
            </p>
          </div>

          <h2 className="mb-3 mt-7 text-lg font-semibold">Category scores</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {scoreCategories.map(([key, label]) => (
              <ScoreCard key={key} label={label} score={isScore(healthScore[key]) ? healthScore[key] : null} />
            ))}
          </div>
        </section>

        <section aria-labelledby="stats-title" className="mt-8 border-t border-slate-200 pt-6">
          <h2 id="stats-title" className="mb-4 text-lg font-semibold">Repository snapshot</h2>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Files scanned" value={fileCount} />
            <Stat label="Test files" value={testFileCount} />
            <Stat label="README" value={readmeStatus} />
            <Stat label="Documentation files" value={docFileCount ?? 'Unavailable'} />
          </div>
        </section>

        <section aria-label="Next step" className="mt-8 border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={() => navigate('/diagnosis')}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
          >
            <Stethoscope aria-hidden="true" className="size-4" />
            Diagnose repository
          </button>
        </section>

        <section aria-labelledby="limitations-title" className="mt-0 border-t border-slate-200 py-6">
          <div className="mb-3 flex items-center gap-2">
            <h2 id="limitations-title" className="text-lg font-semibold">Scan limitations</h2>
            {scanResult.truncated === false && skippedPaths?.length === 0 && (
              <CheckCircle2 aria-label="No reported limitations" className="size-4 text-emerald-700" />
            )}
          </div>
          <p className="mb-3 text-sm text-slate-600">Tree status: {scannedStatus}</p>
          <ul className="space-y-2 text-sm leading-6 text-slate-700">
            {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            {skippedPaths?.length > 0 && (
              <li className="break-words text-slate-500">Skipped paths include: {skippedPaths.slice(0, 3).join(', ')}{skippedPaths.length > 3 ? ', …' : ''}</li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
