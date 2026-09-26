export default function Landing() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2">Codemedics</h1>
      <p className="text-gray-500 mb-8 text-center max-w-md">
        AI-powered codebase health assistant. Diagnose, prescribe, treat.
      </p>
      {/* Repository input — wired up in next phase */}
      <div className="w-full max-w-lg border rounded-lg p-6 bg-gray-50">
        <p className="text-sm text-gray-400 text-center">[Screen 1 — Landing / Repository Input]</p>
      </div>
    </main>
  );
}
