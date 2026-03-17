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
        return 'bg-red-500 text-white';
      case 'serious':
        return 'bg-orange-500 text-white';
      case 'moderate':
        return 'bg-yellow-500 text-black';
      case 'minor':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const sortedViolations = [...violations].sort((a, b) => {
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    return order[a.impact] - order[b.impact];
  });

  const criticalCount = violations.filter(v => v.impact === 'critical').length;
  const seriousCount = violations.filter(v => v.impact === 'serious').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <span className="font-medium">Accessibility Issues</span>
        <Badge variant="secondary" className="ml-auto">
          {violations.length} {violations.length === 1 ? 'issue' : 'issues'}
        </Badge>
      </div>

      {(criticalCount > 0 || seriousCount > 0) && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
          <strong>{criticalCount + seriousCount}</strong> critical/serious issues found
        </div>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {sortedViolations.map((violation, index) => (
          <div
            key={`${violation.id}-${index}`}
            className="p-3 border rounded-lg space-y-2"
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
    </div>
  );
}
