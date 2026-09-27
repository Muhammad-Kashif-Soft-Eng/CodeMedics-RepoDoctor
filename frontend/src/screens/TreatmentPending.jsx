import { useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWorkflow } from '../context/WorkflowContext';

export default function TreatmentPending() {
    const { prescription } = useWorkflow();
    const navigate = useNavigate();

    useEffect(() => {
        if (!prescription?.approved) navigate('/prescription', { replace: true });
    }, [navigate, prescription]);

    if (!prescription?.approved) {
        return null;
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10 text-slate-950">
            <section aria-labelledby="treatment-stage-title" className="w-full max-w-lg rounded-xl border border-emerald-200 bg-white p-7 shadow-sm">
                <CheckCircle2 aria-hidden="true" className="mb-4 size-8 text-emerald-700" />
                <p className="text-xs font-semibold uppercase text-emerald-800">Approval recorded</p>
                <h1 id="treatment-stage-title" className="mt-1 text-xl font-bold">Ready for treatment</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">“{prescription.title}” is approved. No repository changes have been made.</p>
                <button
                    type="button"
                    onClick={() => navigate('/prescription')}
                    className="mt-6 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                    Review approved prescription
                </button>
            </section>
        </main>
    );
}