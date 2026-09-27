import { CheckCircle2 } from 'lucide-react';
import SeverityBadge from './SeverityBadge';

/**
 * FindingCard
 *
 * Displays a single diagnosis finding with all six required fields.
 *
 * Props:
 *   finding    — Finding object (title, category, severity, evidence, affectedPath, explanation)
 *   selected   — boolean — whether this finding is currently selected
 *   onSelect   — (finding) => void — called when the card is clicked
 */
export default function FindingCard({ finding, selected = false, onSelect }) {
  return (
    <div
      role="listitem"
      aria-selected={selected}
      onClick={() => onSelect?.(finding)}
      className={[
        'rounded-xl border bg-white p-5 mb-3 cursor-pointer transition-all',
        selected
          ? 'border-emerald-500 ring-2 ring-emerald-200'
          : 'border-slate-200 hover:border-slate-400',
      ].join(' ')}
    >
      {/* ── Title row ── */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="font-semibold text-sm text-slate-900 leading-5">{finding.title}</span>
        <div className="flex items-center gap-2 shrink-0">
          <SeverityBadge severity={finding.severity} />
          {selected && (
            <CheckCircle2
              aria-label="Selected"
              className="size-4 text-emerald-600"
            />
          )}
        </div>
      </div>

      {/* ── Category ── */}
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
        {finding.category}
      </p>

      {/* ── Evidence ── */}
      <div className="mb-3">
        <p className="text-xs font-semibold text-slate-600 mb-0.5">Evidence</p>
        <p className="text-sm text-slate-700 leading-5">{finding.evidence}</p>
      </div>

      {/* ── Affected path ── */}
      {finding.affectedPath && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-slate-600 mb-0.5">Affected path</p>
          <code className="text-xs font-mono text-slate-800 bg-slate-100 rounded px-1.5 py-0.5 break-all">
            {finding.affectedPath}
          </code>
        </div>
      )}

      {/* ── Explanation ── */}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-0.5">Explanation</p>
        <p className="text-sm text-slate-700 leading-6">{finding.explanation}</p>
      </div>
    </div>
  );
}
