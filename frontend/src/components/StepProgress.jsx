/**
 * StepProgress
 *
 * Renders a vertical list of labelled steps with status icons.
 * Props:
 *   steps: Array<{ label: string, status: 'pending' | 'running' | 'done' | 'error' }>
 */

const STATUS_ICON = {
  pending: <span className="text-gray-300">○</span>,
  running: <span className="text-blue-500 animate-pulse">●</span>,
  done:    <span className="text-green-500">✓</span>,
  error:   <span className="text-red-500">✗</span>,
};

export default function StepProgress({ steps = [] }) {
  return (
    <ul className="space-y-3">
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-3 text-sm">
          <span className="w-5 text-center">{STATUS_ICON[step.status] ?? STATUS_ICON.pending}</span>
          <span className={step.status === 'done' ? 'text-gray-700' : 'text-gray-500'}>
            {step.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
