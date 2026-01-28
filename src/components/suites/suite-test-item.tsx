'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
}

export function SuiteTestItem({ test, index, onRemove }: SuiteTestItemProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 bg-background border rounded-lg ${
        isDragging ? 'shadow-lg ring-2 ring-primary' : 'shadow-sm'
      }`}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
        {index + 1}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{test.testName}</p>
        {test.targetUrl && (
          <p className="text-xs text-muted-foreground truncate">{test.targetUrl}</p>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
