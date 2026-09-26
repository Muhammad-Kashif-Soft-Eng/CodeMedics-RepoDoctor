export default function ScanProgress() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h2 className="text-2xl font-semibold mb-6">Scanning Repository…</h2>
      {/* Step list — wired up in next phase */}
      <div className="w-full max-w-md border rounded-lg p-6 bg-gray-50">
        <p className="text-sm text-gray-400 text-center">[Screen 2 — Scan Progress]</p>
      </div>
    </main>
  );
}
