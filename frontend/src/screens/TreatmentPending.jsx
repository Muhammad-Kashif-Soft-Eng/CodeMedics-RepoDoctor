import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, LoaderCircle, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useWorkflow } from '../context/WorkflowContext';

function safeRelativePath(value) {
    return typeof value === 'string' && value.length > 0 && value === value.trim() &&
        !value.includes('..') && !value.includes('\\') && !value.includes('\0') &&
        !value.startsWith('/') && !/^[a-zA-Z]:/.test(value) &&
        value.split('/').every((segment) => segment && segment !== '.');
}

function safeFiles(files) {
    return Array.isArray(files) ? files.filter(safeRelativePath) : [];
}

function scoreLabel(value) {
    return Number.isFinite(value) ? String(value) : 'Unavailable';
}

export default function TreatmentPending() {
    const {
        workspaceId,
        selectedFinding,
        prescription,
        treatmentWorkflowResult,
        setTreatmentWorkflowResult,
    } = useWorkflow();
    const navigate = useNavigate();
    const savedResult = treatmentWorkflowResult?.workspaceId === workspaceId ? treatmentWorkflowResult : null;
    const [status, setStatus] = useState(() => savedResult
        ? savedResult.status === 'completed' ? 'success' : 'failed'
        : 'ready');
    const [errorMessage, setErrorMessage] = useState(() => savedResult && savedResult.status !== 'completed'
        ? 'The treatment workflow did not complete successfully.'
        : '');
    const requestInFlight = useRef(false);
    const requestSubmitted = useRef(Boolean(savedResult));

    useEffect(() => {
        if (!selectedFinding) {
            navigate('/diagnosis', { replace: true });
            return;
        }
        if (!prescription?.approved || !workspaceId) {
            navigate('/prescription', { replace: true });
        }
    }, [navigate, prescription?.approved, selectedFinding, workspaceId]);

    function startWorkflow(isRetry = false) {
        if (requestInFlight.current || (requestSubmitted.current && !isRetry)) return;
        requestInFlight.current = true;
        requestSubmitted.current = true;
        setStatus('running');
        setErrorMessage('');
        setTreatmentWorkflowResult(null);

        apiClient.treatmentWorkflow(workspaceId, selectedFinding)
            .then((result) => {
                if (
                    !result || typeof result !== 'object' || Array.isArray(result) ||
                    result.workspaceId !== workspaceId || typeof result.status !== 'string' ||
                    !result.treatmentResult || !result.verificationResult || !result.beforeAfter
                ) {
                    throw new Error('Incomplete workflow response');
                }
                setTreatmentWorkflowResult(result);
                if (result.status === 'completed') {
                    setStatus('success');
                } else {
                    setErrorMessage('The treatment workflow did not complete successfully.');
                    setStatus('failed');
                }
            })
            .catch(() => {
                setTreatmentWorkflowResult(null);
                setErrorMessage('The treatment workflow could not be completed. Please retry.');
                setStatus('failed');
            })
            .finally(() => {
                requestInFlight.current = false;
            });
    }

    function retryWorkflow() {
        if (requestInFlight.current) return;
        requestSubmitted.current = false;
        startWorkflow(true);
    }

    if (!selectedFinding || !prescription?.approved || !workspaceId) {
        return null;
    }

    const result = savedResult ?? treatmentWorkflowResult;
    const beforeAfter = result?.beforeAfter;
    const changedFiles = safeFiles(result?.changedFiles ?? result?.treatmentResult?.changedFiles);

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
            <section aria-labelledby="treatment-stage-title" aria-live="polite" className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
                {status === 'running' ? (
                    <LoaderCircle aria-hidden="true" className="mb-4 size-8 animate-spin text-emerald-700" />
                ) : status === 'success' ? (
                    <CheckCircle2 aria-hidden="true" className="mb-4 size-8 text-emerald-700" />
                ) : status === 'failed' ? (
                    <AlertCircle aria-hidden="true" className="mb-4 size-8 text-rose-700" />
                ) : (
                    <CheckCircle2 aria-hidden="true" className="mb-4 size-8 text-emerald-700" />
                )}
                <p className="text-xs font-semibold uppercase text-emerald-800">Approved prescription</p>
                <h1 id="treatment-stage-title" className="mt-1 text-xl font-bold">
                    {status === 'running' ? 'Treatment workflow running'
                        : status === 'success' ? 'Treatment complete'
                            : status === 'failed' ? 'Treatment workflow failed'
                                : 'Ready for treatment'}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                    {status === 'running'
                        ? 'Applying the approved change, then running deterministic verification.'
                        : status === 'failed'
                            ? errorMessage
                            : `“${prescription.title}” is approved for ${selectedFinding.title}.`}
                </p>

                {status === 'success' && result && (
                    <div className="mt-6 space-y-5 border-t border-slate-200 pt-5">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <div>
                                <dt className="text-slate-500">Treatment</dt>
                                <dd className="mt-1 font-semibold text-slate-900">{result.treatmentResult.status}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Verification</dt>
                                <dd className="mt-1 font-semibold text-slate-900">{result.verificationResult.status}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Before score</dt>
                                <dd className="mt-1 font-semibold text-slate-900">{scoreLabel(beforeAfter?.beforeScore)}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">After score</dt>
                                <dd className="mt-1 font-semibold text-slate-900">{scoreLabel(beforeAfter?.afterScore)}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Score change</dt>
                                <dd className="mt-1 font-semibold text-slate-900">
                                    {Number.isFinite(beforeAfter?.scoreDelta) && beforeAfter.scoreDelta > 0 ? '+' : ''}
                                    {scoreLabel(beforeAfter?.scoreDelta)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Improved</dt>
                                <dd className="mt-1 font-semibold text-slate-900">{beforeAfter?.improved === true ? 'Yes' : 'No'}</dd>
                            </div>
                        </dl>

                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">Changed files</h2>
                            {changedFiles.length > 0 ? (
                                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                                    {changedFiles.map((file) => <li key={file} className="break-all font-mono">{file}</li>)}
                                </ul>
                            ) : <p className="mt-2 text-sm text-slate-500">No changed files were confirmed.</p>}
                        </div>
                        {typeof beforeAfter?.summary === 'string' && (
                            <p className="text-sm leading-6 text-slate-600">{beforeAfter.summary}</p>
                        )}
                    </div>
                )}

                <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
                    {status === 'ready' && (
                        <button
                            type="button"
                            onClick={() => startWorkflow()}
                            className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
                        >
                            Start treatment
                        </button>
                    )}
                    {status === 'running' && (
                        <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className="flex cursor-not-allowed items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white opacity-60"
                        >
                            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                            Running workflow
                        </button>
                    )}
                    {status === 'failed' && (
                        <button
                            type="button"
                            onClick={retryWorkflow}
                            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RotateCcw aria-hidden="true" className="size-4" />
                            Retry workflow
                        </button>
                    )}
                    {status !== 'running' && status !== 'success' && (
                        <button
                            type="button"
                            onClick={() => navigate('/prescription')}
                            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                        >
                            <ArrowLeft aria-hidden="true" className="size-4" />
                            Review prescription
                        </button>
                    )}
                </div>
            </section>
        </main>
    );
}