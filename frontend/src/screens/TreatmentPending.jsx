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

function treatmentLabel(value) {
    if (value === 'applied') return 'Applied';
    if (value === 'no_changes') return 'No changes';
    return 'Unavailable';
}

function verificationLabel(value) {
    if (value === 'passed') return 'Passed';
    if (value === 'failed') return 'Failed';
    return 'Unavailable';
}

function healthLabel(value) {
    if (value === true) return 'Improved';
    if (value === false) return 'No improvement';
    return 'Unavailable';
}

function safeSummary(value) {
    if (typeof value !== 'string') return null;
    const scoreSummary = '(?:Health improved by \\d+ points and verification passed|Health score increased by \\d+ points, but verification failed|Health score decreased by \\d+ points|Health score was unchanged; verification (?:passed|failed)|Health score comparison is unavailable because a score is missing)';
    const fileSummary = '(?: \\d+ approved changed files? (?:was|were) confirmed\\.| No approved changed files were confirmed\\.)';
    return new RegExp(`^${scoreSummary}\\.${fileSummary}$`).test(value) ? value : null;
}

function safeCheckLabel(value) {
    if (typeof value !== 'string') return null;
    if (['node --test', 'jest --runInBand', 'vitest run', 'mocha'].includes(value)) {
        return 'Project test suite';
    }
    if (value === 'Changed files exist') return 'Changed files exist';
    const syntaxCheck = value.match(/^node --check (.+)$/);
    if (syntaxCheck && safeRelativePath(syntaxCheck[1])) {
        return `JavaScript syntax check: ${syntaxCheck[1]}`;
    }
    return null;
}

function safeChecks(verificationResult) {
    const checksRun = Array.isArray(verificationResult?.checksRun) ? verificationResult.checksRun : [];
    const passedChecks = Array.isArray(verificationResult?.passedChecks) ? verificationResult.passedChecks : [];
    const failedChecks = Array.isArray(verificationResult?.failedChecks) ? verificationResult.failedChecks : [];

    return checksRun.flatMap((check, index) => {
        const label = safeCheckLabel(check);
        if (!label) return [];
        const failed = failedChecks.some((failure) => failure?.check === check);
        const passed = passedChecks.includes(check);
        return [{
            key: `${index}-${label}`,
            label,
            status: failed ? 'Failed' : passed ? 'Passed' : 'Unavailable',
        }];
    });
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
    const checks = safeChecks(result?.verificationResult);
    const summary = safeSummary(beforeAfter?.summary);
    const hasResult = Boolean(result && result.workspaceId === workspaceId && beforeAfter);

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
            <section aria-labelledby="treatment-stage-title" aria-live="polite" className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
                {status === 'running' ? (
                    <LoaderCircle aria-hidden="true" className="mb-4 size-8 animate-spin text-emerald-700" />
                ) : hasResult && result.status === 'completed' ? (
                    <CheckCircle2 aria-hidden="true" className="mb-4 size-8 text-emerald-700" />
                ) : status === 'failed' ? (
                    <AlertCircle aria-hidden="true" className="mb-4 size-8 text-rose-700" />
                ) : (
                    <CheckCircle2 aria-hidden="true" className="mb-4 size-8 text-emerald-700" />
                )}
                <p className="text-xs font-semibold uppercase text-emerald-800">Approved prescription</p>
                <h1 id="treatment-stage-title" className="mt-1 text-xl font-bold">
                    {status === 'running' ? 'Treatment workflow running'
                        : hasResult && result.status === 'completed' ? 'Treatment workflow complete'
                            : hasResult ? 'Treatment workflow needs attention'
                                : status === 'failed' ? 'Treatment workflow failed'
                                    : 'Ready for treatment'}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                    {status === 'running'
                        ? 'Applying the approved change, then running deterministic verification.'
                        : status === 'failed' && !hasResult
                            ? errorMessage
                            : hasResult && result.status !== 'completed'
                                ? 'The workflow returned a result, but it did not complete successfully.'
                                : `“${prescription.title}” is approved for ${selectedFinding.title}.`}
                </p>

                {hasResult && (
                    <div className="mt-6 space-y-5 border-t border-slate-200 pt-5">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className={`rounded-lg border p-4 ${result.treatmentResult?.status === 'applied' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                <p className="text-xs font-semibold uppercase text-slate-500">Treatment</p>
                                <p className="mt-1 font-semibold text-slate-900">{treatmentLabel(result.treatmentResult?.status)}</p>
                            </div>
                            <div className={`rounded-lg border p-4 ${result.verificationResult?.status === 'passed' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                                <p className="text-xs font-semibold uppercase text-slate-500">Verification</p>
                                <p className="mt-1 font-semibold text-slate-900">{verificationLabel(result.verificationResult?.status)}</p>
                            </div>
                            <div className={`rounded-lg border p-4 ${beforeAfter?.improved === true ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                <p className="text-xs font-semibold uppercase text-slate-500">Health outcome</p>
                                <p className="mt-1 font-semibold text-slate-900">{healthLabel(beforeAfter?.improved)}</p>
                            </div>
                        </div>

                        <section aria-label="Before and after health scores" className="border-t border-slate-200 pt-5">
                            <h2 className="mb-3 text-base font-semibold text-slate-900">Before and after</h2>
                            <div className="grid grid-cols-3 gap-2 sm:gap-4">
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4">
                                    <p className="text-xs font-medium text-slate-500">Before</p>
                                    <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{scoreLabel(beforeAfter?.beforeScore)}</p>
                                    <p className="text-xs text-slate-500">out of 100</p>
                                </div>
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 sm:p-4">
                                    <p className="text-xs font-medium text-emerald-800">After</p>
                                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">{scoreLabel(beforeAfter?.afterScore)}</p>
                                    <p className="text-xs text-emerald-800">out of 100</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
                                    <p className="text-xs font-medium text-slate-500">Change</p>
                                    <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                                        {Number.isFinite(beforeAfter?.scoreDelta) && beforeAfter.scoreDelta > 0 ? '+' : ''}
                                        {scoreLabel(beforeAfter?.scoreDelta)}
                                    </p>
                                    <p className="text-xs text-slate-500">points</p>
                                </div>
                            </div>
                        </section>

                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">Changed files</h2>
                            {changedFiles.length > 0 ? (
                                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                                    {changedFiles.map((file) => <li key={file} className="break-all font-mono">{file}</li>)}
                                </ul>
                            ) : <p className="mt-2 text-sm text-slate-500">No changed files were confirmed.</p>}
                        </div>
                        {checks.length > 0 && (
                            <div>
                                <h2 className="text-sm font-semibold text-slate-900">Verification checks</h2>
                                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                                    {checks.map((check) => (
                                        <li key={check.key} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2">
                                            <span>{check.label}</span>
                                            <span className={check.status === 'Passed' ? 'font-semibold text-emerald-800' : 'font-semibold text-rose-800'}>
                                                {check.status}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {summary && (
                            <p className="border-t border-slate-200 pt-4 text-sm leading-6 text-slate-600">{summary}</p>
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