import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import SeverityBadge from '../components/SeverityBadge';
import { useWorkflow } from '../context/WorkflowContext';

export default function Prescription() {
  const {
    scanResult,
    selectedFinding,
    prescription,
    setPrescription,
    setWorkspaceId,
  } = useWorkflow();
  const navigate = useNavigate();
  const requestStarted = useRef(false);
  const requestInFlight = useRef(false);
  const workspaceRequestInFlight = useRef(false);
  const [requestAttempt, setRequestAttempt] = useState(0);
  const [status, setStatus] = useState(prescription ? 'ready' : 'loading');
  const [workspaceStatus, setWorkspaceStatus] = useState('idle');
  const [workspaceError, setWorkspaceError] = useState('');

  useEffect(() => {
    if (!scanResult || !scanResult.scanId || !selectedFinding) {
      navigate('/diagnosis', { replace: true });
      return;
    }
    if (prescription) return;
    if (requestStarted.current) return;

    requestStarted.current = true;
    requestInFlight.current = true;
    setStatus('loading');

    apiClient.prescribe(scanResult, selectedFinding)
      .then((response) => {
        if (!response?.prescription || typeof response.prescription !== 'object') {
          throw new Error('The prescription response was incomplete.');
        }
        setPrescription(response.prescription);
        setStatus('ready');
      })
      .catch(() => {
        setStatus('error');
      })
      .finally(() => {
        requestInFlight.current = false;
      });
  }, [navigate, prescription, requestAttempt, scanResult, selectedFinding, setPrescription]);

  function handleRetry() {
    if (requestInFlight.current) return;
    requestStarted.current = false;
    setStatus('loading');
    setRequestAttempt((attempt) => attempt + 1);
  }

  async function handleApprove() {
    if (workspaceRequestInFlight.current || !prescription || status !== 'ready') return;
    if (!scanResult?.scanId || !selectedFinding) {
      navigate('/diagnosis', { replace: true });
      return;
    }

    workspaceRequestInFlight.current = true;
    setWorkspaceStatus('preparing');
    setWorkspaceError('');
    const approvedPrescription = { ...prescription, approved: true };
    setPrescription(approvedPrescription);

    try {
      const result = await apiClient.prepareWorkspace(scanResult.scanId, selectedFinding, approvedPrescription);
      if (typeof result?.workspaceId !== 'string' || !result.workspaceId.trim()) {
        throw new Error('The workspace response was incomplete.');
      }
      setWorkspaceId(result.workspaceId);
      setWorkspaceStatus('ready');
      navigate('/treatment');
    } catch {
      setWorkspaceError('The treatment workspace could not be prepared. Please retry.');
      setWorkspaceStatus('error');
    } finally {
      workspaceRequestInFlight.current = false;
    }
  }

  if (!scanResult || !scanResult.scanId || !selectedFinding) return null;

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
        <section aria-live="polite" className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="flex items-start gap-4">
            <LoaderCircle aria-hidden="true" className="mt-1 size-6 shrink-0 animate-spin text-emerald-700" />
            <div>
              <h1 className="text-xl font-bold">Creating prescription</h1>
              <p className="mt-2 text-sm text-slate-600">Preparing a plan for “{selectedFinding.title}”.</p>
              <p className="mt-4 text-sm text-slate-500">No treatment will be performed during this step.</p>
            </div>
          </div>
          <div className="mt-6 flex justify-end border-t border-slate-200 pt-5">
            <button
              type="button"
              disabled
              className="flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white opacity-40"
            >
              Approve Treatment
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
        <section role="alert" className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-7 shadow-sm">
          <AlertCircle aria-hidden="true" className="mb-4 size-8 text-rose-700" />
          <h1 className="text-xl font-bold">Prescription could not be generated</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The selected finding is still saved. Check the connection and retry, or return to Diagnosis to choose another finding.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Retry prescription
            </button>
            <button
              type="button"
              onClick={() => navigate('/diagnosis')}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Back to Diagnosis
            </button>
          </div>
        </section>
      </main>
    );
  }

  const affectedPath = selectedFinding.affectedPath || 'No specific path identified';

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-800">Codemedics · Human review</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Review Prescription</h1>
          </div>
          <button
            type="button"
            onClick={() => navigate('/diagnosis')}
            aria-label="Back to Diagnosis"
            title="Back to Diagnosis"
            className="grid size-10 place-items-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
        </header>

        <section className="mb-6 border-b border-slate-200 pb-6">
          <p className="text-sm text-slate-500">Selected problem</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">{selectedFinding.title}</h2>
            <SeverityBadge severity={selectedFinding.severity} />
          </div>
          <p className="mt-2 text-sm font-medium text-slate-600">{selectedFinding.category}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">Evidence</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">{selectedFinding.evidence}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">Affected path</h3>
              <p className="mt-1 break-all font-mono text-sm text-slate-700">{affectedPath}</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="plan-title">
          <div className="mb-5">
            <p className="text-sm text-slate-500">Proposed plan</p>
            <h2 id="plan-title" className="mt-1 text-xl font-semibold">{prescription.title}</h2>
          </div>

          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Reason</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">{prescription.reason}</p>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Expected outcome</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">{prescription.expectedOutcome}</p>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Treatment steps</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
                {prescription.treatmentSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
              </ol>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Verification plan</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">{prescription.verificationPlan}</p>
            </section>
            <section className="border-l-2 border-amber-500 pl-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldAlert aria-hidden="true" className="size-4 text-amber-700" />
                Risk notes
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                {prescription.riskNotes || 'No risk notes provided.'}
              </p>
            </section>
          </div>
        </section>

        {workspaceError && (
          <p role="alert" className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
            {workspaceError}
          </p>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => navigate('/diagnosis')}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to Diagnosis
          </button>
          <button
            type="button"
            disabled={!prescription || status !== 'ready' || workspaceStatus === 'preparing'}
            onClick={handleApprove}
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {workspaceStatus === 'preparing' ? (
              <>
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                Preparing workspace
              </>
            ) : workspaceStatus === 'error' ? (
              <>
                <CheckCircle2 aria-hidden="true" className="size-4" />
                Retry workspace preparation
              </>
            ) : (
              <>
                <CheckCircle2 aria-hidden="true" className="size-4" />
                Approve Treatment
                <ArrowRight aria-hidden="true" className="size-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </main>
  );
}
