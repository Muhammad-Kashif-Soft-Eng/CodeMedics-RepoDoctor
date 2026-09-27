import { useState } from 'react';
import { ArrowRight, Code2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkflow } from '../context/WorkflowContext';

export default function Landing() {
  const [repoUrl, setInputUrl] = useState('');
  const navigate = useNavigate();
  const { resetWorkflow, setRepoUrl } = useWorkflow();

  function handleSubmit(event) {
    event.preventDefault();
    const trimmedUrl = repoUrl.trim();
    if (!trimmedUrl) return;

    resetWorkflow();
    setRepoUrl(trimmedUrl);
    navigate('/scan');
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950 sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col justify-between">
        <header className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <span className="grid size-9 place-items-center rounded-lg bg-emerald-700 text-white">C</span>
          Codemedics
        </header>

        <section className="grid gap-10 py-16 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase text-emerald-800">Repository checkup</p>
            <h1 className="max-w-xl text-4xl font-bold leading-tight sm:text-5xl">
              See the health of your codebase.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-7 text-slate-600">
              Scan a public GitHub repository and review its measurable health signals.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <label htmlFor="repo-url" className="mb-2 block text-sm font-semibold text-slate-800">
              GitHub repository URL
            </label>
            <div className="flex items-center gap-3 rounded-lg border border-slate-300 px-3 focus-within:border-emerald-700 focus-within:ring-2 focus-within:ring-emerald-100">
              <Code2 aria-hidden="true" className="size-5 shrink-0 text-slate-500" />
              <input
                id="repo-url"
                type="url"
                required
                value={repoUrl}
                onChange={(event) => setInputUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                className="min-w-0 flex-1 py-3 text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <button
              type="submit"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
            >
              Scan repository <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </form>
        </section>

        <footer className="border-t border-slate-200 py-4 text-xs text-slate-500">
          Codemedics health scores are based on signals visible in the scanned repository.
        </footer>
      </div>
    </main>
  );
}
