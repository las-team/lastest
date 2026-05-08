'use client';

import { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import type { DiffLine } from '@/lib/diff/text-diff';
import type { TextDiffStatus } from '@/lib/db/schema';

const MAX_INITIAL_LINES = 200;

interface TextDiffPanelProps {
  status: TextDiffStatus;
  summary: { added: number; removed: number; sameAsBaseline: boolean };
  lines: DiffLine[];
}

export function TextDiffPanel({ status, summary, lines }: TextDiffPanelProps) {
  const [expanded, setExpanded] = useState(status === 'changed');
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? lines : lines.slice(0, MAX_INITIAL_LINES);
  const hidden = lines.length - visible.length;

  const headline =
    status === 'unchanged' ? 'No text changes' :
    status === 'baseline_only' ? 'Baseline text only — current run captured nothing' :
    status === 'current_only' ? 'New text — no baseline to compare against' :
    status === 'skipped' ? 'Text capture not enabled for this diff' :
    `${summary.added} added · ${summary.removed} removed`;

  return (
    <details
      className="border border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/30 rounded-lg"
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex items-center gap-3 p-4 cursor-pointer select-none">
        <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />
        <span className="font-medium text-indigo-800 dark:text-indigo-200">
          Page Text Diff
        </span>
        <span className="text-xs text-indigo-600 dark:text-indigo-400">
          {status === 'changed' && (
            <>
              {summary.removed > 0 && <span className="text-red-600 dark:text-red-400 mr-2">-{summary.removed}</span>}
              {summary.added > 0 && <span className="text-green-600 dark:text-green-400">+{summary.added}</span>}
            </>
          )}
          {status !== 'changed' && <span className="text-muted-foreground">{headline}</span>}
        </span>
        <ChevronDown className="w-4 h-4 text-indigo-400 ml-auto transition-transform [[open]>&]:rotate-180" />
      </summary>
      <div className="px-4 pb-4">
        {lines.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">{headline}</p>
        ) : (
          <>
            <pre className="text-xs font-mono bg-card border rounded max-h-96 overflow-auto p-2 leading-snug">
              {visible.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.op === 'add' ? 'bg-green-100/60 dark:bg-green-900/30 text-green-900 dark:text-green-200' :
                    l.op === 'del' ? 'bg-red-100/60 dark:bg-red-900/30 text-red-900 dark:text-red-200' :
                    'text-muted-foreground'
                  }
                >
                  <span className="select-none mr-1">
                    {l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' '}
                  </span>
                  {l.line || ' '}
                </div>
              ))}
            </pre>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-2 text-xs text-indigo-700 dark:text-indigo-300 hover:underline"
              >
                Show {hidden} more lines
              </button>
            )}
          </>
        )}
      </div>
    </details>
  );
}
