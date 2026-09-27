import { useEffect, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useWorkflow } from '../context/WorkflowContext';

export default function ScanProgress() {
  const { repoUrl, setScanResult } = useWorkflow();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!repoUrl) {
      navigate('/', { replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;

    apiClient.scan(repoUrl)
      .then((result) => {
        setScanResult(result);
        navigate('/health', { replace: true });
      })
      .catch((requestError) => {
        setError(requestError.message || 'The repository scan could not be completed.');
      });
  }, [navigate, repoUrl, setScanResult]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
      <section aria-live="polite" className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        {error ? (
          <>
            <AlertCircle aria-hidden="true" className="mb-4 size-8 text-rose-700" />
            <h1 className="text-xl font-bold">Scan could not be completed</h1>
            <p className="mt-2 break-words text-sm leading-6 text-slate-600">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-6 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Return to repository input
            </button>
          </>
        ) : (
          <div className="flex items-start gap-4">
            <LoaderCircle aria-hidden="true" className="mt-1 size-6 shrink-0 animate-spin text-emerald-700" />
            <div>
              <h1 className="text-xl font-bold">Scanning repository</h1>
              <p className="mt-2 break-all text-sm text-slate-600">{repoUrl}</p>
              <p className="mt-4 text-sm text-slate-500">Collecting repository signals and calculating its health score.</p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
