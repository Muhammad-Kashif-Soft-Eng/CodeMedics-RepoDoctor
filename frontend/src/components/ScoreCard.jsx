/**
 * ScoreCard
 *
 * Displays a labelled numeric score out of 100.
 * Props: label (string), score (number 0–100)
 */
export default function ScoreCard({ label, score }) {
  return (
    <div className="border rounded-lg p-4 bg-white text-center">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-3xl font-bold">{score ?? '—'}</p>
      <p className="text-xs text-gray-400">/ 100</p>
    </div>
  );
}
