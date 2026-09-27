import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useWorkflow } from '../context/WorkflowContext';
import FindingCard from '../components/FindingCard';

export default function Diagnosis() {
  const { scanResult, findings, setFindings, selectedFinding, setSelectedFinding } = useWorkflow();
  const navigate = useNavigate();
  const started = useRef(false);

  // Derive initial status from context: if findings already exist (back-navigation),
  // start in 'done' so we never call the API again.
  const [status, setStatus]     = useState(() => (findings.length > 0 ? 'done' : 'idle'));
  const [errorMsg, setErrorMsg] = useState('');

  // ── Guard: must have a scan result before diagnosing ─────────────────────────
  useEffect(() => {
    if (!scanResult) {
      navigate('/', { replace: true });
    }
  }, [scanResult, navigate]);

  // ── Trigger diagnosis exactly once per mount (Strict Mode safe) ───────────────
  useEffect(() => {
    if (!scanResult) return;
    if (status === 'done' || status === 'error') return;
    if (started.current) return;
    started.current = true;

    setStatus('loading');
    apiClient.diagnose(scanResult)
      .then((response) => {
        setFindings(response.findings ?? []);
        setStatus('done');
      })
      .catch((err) => {
        // Parse the error message from the API client
        const raw = err?.message ?? '';
        // Extract the JSON body portion if present
        const jsonStart = raw.indexOf('{');
        let userMessage = 'The diagnosis could not be completed. Please try again.';
        if (jsonStart !== -1) {
          try {
            const parsed = JSON.parse(raw.slice(jsonStart));
            if (parsed?.error?.message) userMessage = parsed.error.message;
          } catch {
            // fall through to default message
          }
        }
        setErrorMsg(userMessage);
        setStatus('error');
      });
  }, [scanResult, status, setFindings]);

  // ── Retry handler ─────────────────────────────────────────────────────────────
  function handleRetry() {
    started.current = false;
    setFindings([]);
    setSelectedFinding(null);
    setErrorMsg('');
    setStatus('idle');
  }

  // ── Finding selection ─────────────────────────────────────────────────────────
  function handleSelect(finding) {
    // Clicking the already-selected finding deselects it
    const isSame = selectedFinding?.title === finding.title &&
                   selectedFinding?.category === finding.category &&
                   selectedFinding?.severity === finding.severity;
    setSelectedFinding(isSame ? null : finding);
  }

  if (!scanResult) return null;

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (status === 'idle' || status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
        <section aria-live="polite" className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="flex items-start gap-4">
            <LoaderCircle aria-hidden="true" className="mt-1 size-6 shrink-0 animate-spin text-emerald-700" />
            <div>
              <h1 className="text-xl font-bold">Diagnosing repository</h1>
              <p className="mt-2 text-sm text-slate-600">
                {scanResult.owner && scanResult.repo
                  ? `${scanResult.owner}/${scanResult.repo}`
                  : scanResult.repoUrl}
              </p>
              <p className="mt-4 text-sm text-slate-500">
                Analyzing scan signals with the Codemedics diagnostician.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
        <section role="alert" className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-7 shadow-sm">
          <AlertCircle aria-hidden="true" className="mb-4 size-8 text-rose-700" />
          <h1 className="text-xl font-bold">Diagnosis could not be completed</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{errorMsg}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => navigate('/health')}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Back to health dashboard
            </button>
          </div>
        </section>
      </main>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 sm:px-8">
      <div className="mx-auto max-w-3xl">

        {/* ── Header ── */}
        <header className="mb-8 flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-800">Codemedics · Diagnosis</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Repository Diagnosis</h1>
          </div>
          <button
            type="button"
            onClick={() => navigate('/health')}
            aria-label="Back to health dashboard"
            title="Back to health dashboard"
            className="grid size-10 place-items-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
        </header>

        {/* ── Repository identity ── */}
        <section className="mb-6">
          <p className="text-sm text-slate-500">Repository</p>
          <h2 className="mt-1 break-all text-xl font-semibold">
            {scanResult.owner && scanResult.repo
              ? `${scanResult.owner}/${scanResult.repo}`
              : 'Repository name unavailable'}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            The diagnostician analyzed available scan signals and identified the issues below.
            Select one finding to create a targeted prescription.
          </p>
        </section>

        {/* ── Findings ── */}
        <section aria-labelledby="findings-title">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="findings-title" className="text-lg font-semibold">
              {findings.length === 0
                ? 'Findings'
                : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}
            </h2>
            {selectedFinding && (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
                1 finding selected
              </span>
            )}
          </div>

          {findings.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
              <p className="text-sm font-medium text-slate-700">
                No significant issues were identified from the available scan evidence.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                The repository may already be in good health, or the scan evidence was insufficient for diagnosis.
              </p>
            </div>
          ) : (
            <div role="list" aria-label="Diagnosis findings">
              {findings.map((finding, index) => (
                <FindingCard
                  key={`${finding.category}-${finding.severity}-${index}`}
                  finding={finding}
                  selected={
                    selectedFinding?.title === finding.title &&
                    selectedFinding?.category === finding.category &&
                    selectedFinding?.severity === finding.severity
                  }
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Create Prescription CTA ── */}
        <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6">
          <p className="text-sm text-slate-500">
            {selectedFinding
              ? `Selected: "${selectedFinding.title}"`
              : 'Select a finding above to continue.'}
          </p>
          <button
            type="button"
            disabled={!selectedFinding}
            onClick={() => navigate('/prescription')}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create prescription
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </div>

      </div>
    </main>
  );
}
