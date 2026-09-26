const SEVERITY_STYLES = {
  Critical: 'bg-red-100 text-red-700',
  High:     'bg-orange-100 text-orange-700',
  Medium:   'bg-yellow-100 text-yellow-700',
  Low:      'bg-blue-100 text-blue-700',
};

/**
 * SeverityBadge
 *
 * Pill badge coloured by severity.
 * Props: severity ('Critical' | 'High' | 'Medium' | 'Low')
 */
export default function SeverityBadge({ severity }) {
  const styles = SEVERITY_STYLES[severity] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${styles}`}>
      {severity}
    </span>
  );
}
