'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SuiteTest {
  id: string;
  suiteId: string;
  testId: string;
  orderIndex: number;
  testName: string;
  testCode: string;
  targetUrl: string | null;
  functionalAreaId: string | null;
}

interface SuiteTestItemProps {
  test: SuiteTest;
  index: number;
  onRemove: () => void;
  isRunning?: boolean;
  isCurrent?: boolean;
  status?: string | null;
  durationMs?: number | null;
  disabled?: boolean;
}

export function SuiteTestItem({ test, index, onRemove, isRunning, isCurrent, status, durationMs, disabled }: SuiteTestItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: test.testId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Determine status icon
  const StatusIcon = () => {
    if (isCurrent) return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    if (status === 'passed') return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (status === 'failed') return <XCircle className="w-4 h-4 text-red-500" />;
    if (isRunning) return <Clock className="w-4 h-4 text-muted-foreground" />;
    return null;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-3 bg-background border rounded-lg',
        isDragging && 'shadow-lg ring-2 ring-primary',
        !isDragging && 'shadow-sm',
        isCurrent && 'border-blue-500 bg-blue-50 dark:bg-blue-950',
        status === 'passed' && 'border-green-500 bg-green-50 dark:bg-green-950',
        status === 'failed' && 'border-red-500 bg-red-50 dark:bg-red-950'
      )}
    >
      <button
        className={cn(
          'text-muted-foreground hover:text-foreground',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing'
        )}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
        {index + 1}
      </span>

      {(isRunning || status) && (
        <StatusIcon />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{test.testName}</p>
        {test.targetUrl && (
          <p className="text-xs text-muted-foreground truncate">{test.targetUrl}</p>
        )}
      </div>

      {durationMs && (
        <span className="text-xs text-muted-foreground">
          {(durationMs / 1000).toFixed(1)}s
        </span>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        disabled={disabled}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
