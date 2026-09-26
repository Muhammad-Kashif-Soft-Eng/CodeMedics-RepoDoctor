import SeverityBadge from './SeverityBadge';

/**
 * FindingCard
 *
 * Displays a single diagnosis finding.
 * Props: finding (Finding object), onSelect (optional callback)
 */
export default function FindingCard({ finding, onSelect }) {
  return (
    <div
      className="border rounded-lg p-4 bg-white mb-3 cursor-pointer hover:border-blue-400 transition-colors"
      onClick={() => onSelect?.(finding)}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{finding.title}</span>
        <SeverityBadge severity={finding.severity} />
      </div>
      <p className="text-xs text-gray-500 mb-1">{finding.category}</p>
      <p className="text-sm text-gray-700">{finding.explanation}</p>
    </div>
  );
}
