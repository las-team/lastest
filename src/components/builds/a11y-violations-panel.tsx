'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { A11yViolation } from '@/lib/db/schema';

interface A11yViolationsPanelProps {
  violations: A11yViolation[];
}

export function A11yViolationsPanel({ violations }: A11yViolationsPanelProps) {
  if (!violations || violations.length === 0) {
    return null;
  }

  const getImpactColor = (impact: A11yViolation['impact']) => {
    switch (impact) {
      case 'critical':
        return 'bg-destructive text-white';
      case 'serious':
        return 'bg-destructive/80 text-white';
      case 'moderate':
        return 'bg-warning text-foreground';
      case 'minor':
        return 'bg-info text-white';
      default:
        return 'bg-muted-foreground text-white';
    }
  };

  const sortedViolations = [...violations].sort((a, b) => {
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    return order[a.impact] - order[b.impact];
  });

  const criticalCount = violations.filter(v => v.impact === 'critical').length;
  const seriousCount = violations.filter(v => v.impact === 'serious').length;
  const hasSevere = criticalCount + seriousCount > 0;

  return (
    <details className={`mt-2 border rounded-lg ${hasSevere ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30' : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'}`}>
      <summary className="flex items-center gap-2 p-2.5 cursor-pointer select-none text-sm">
        <AlertTriangle className={`w-4 h-4 shrink-0 ${hasSevere ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
        <span className={`font-medium ${hasSevere ? 'text-red-800 dark:text-red-200' : 'text-amber-800 dark:text-amber-200'}`}>
          Accessibility Issues
        </span>
        {hasSevere && (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
            {criticalCount + seriousCount} critical/serious
          </Badge>
        )}
        <Badge variant="secondary" className="ml-auto text-xs">
          {violations.length}
        </Badge>
      </summary>

      <div className="px-2.5 pb-2.5 space-y-2 max-h-64 overflow-y-auto">
        {sortedViolations.map((violation, index) => (
          <div
            key={`${violation.id}-${index}`}
            className="p-3 border rounded-lg space-y-2 bg-background/60"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className={getImpactColor(violation.impact)}>
                  {violation.impact}
                </Badge>
                <code className="text-xs bg-muted px-1 rounded">{violation.id}</code>
              </div>
              <span className="text-xs text-muted-foreground">
                {violation.nodes} {violation.nodes === 1 ? 'element' : 'elements'}
              </span>
            </div>
            <p className="text-sm font-medium">{violation.help}</p>
            <p className="text-xs text-muted-foreground">{violation.description}</p>
            <a
              href={violation.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Learn more <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ))}
      </div>
    </details>
  );
}
