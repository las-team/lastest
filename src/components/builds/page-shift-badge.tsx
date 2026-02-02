'use client';

import { ArrowDown, ArrowUp, MoveVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PageShiftInfo } from '@/lib/db/schema';

interface PageShiftBadgeProps {
  pageShift: PageShiftInfo;
}

export function PageShiftBadge({ pageShift }: PageShiftBadgeProps) {
  if (!pageShift.detected) {
    return null;
  }

  const isShiftDown = pageShift.deltaY > 0;
  const shiftAmount = Math.abs(pageShift.deltaY);
  const confidencePercent = Math.round(pageShift.confidence * 100);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 cursor-help">
            {isShiftDown ? (
              <ArrowDown className="w-3 h-3" />
            ) : (
              <ArrowUp className="w-3 h-3" />
            )}
            Page Shift: {shiftAmount}px
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1 text-sm">
            <p className="font-medium flex items-center gap-1">
              <MoveVertical className="w-4 h-4" />
              Vertical Page Shift Detected
            </p>
            <p>
              Content appears to have shifted {isShiftDown ? 'down' : 'up'} by approximately{' '}
              <strong>{shiftAmount}px</strong>.
            </p>
            <p className="text-muted-foreground text-xs">
              Confidence: {confidencePercent}%
            </p>
            <p className="text-xs text-muted-foreground">
              This may be caused by added/removed content like banners, notifications, or dynamic elements.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
