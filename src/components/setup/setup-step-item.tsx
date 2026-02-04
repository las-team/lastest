'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, FlaskConical, FileCode, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SetupStepItemProps {
  id: string;
  stepType: 'test' | 'script';
  name: string;
  index: number;
  onRemove: () => void;
  onEdit?: () => void;
  disabled?: boolean;
}

export function SetupStepItem({
  id,
  stepType,
  name,
  index,
  onRemove,
  onEdit,
  disabled,
}: SetupStepItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const Icon = stepType === 'test' ? FlaskConical : FileCode;
  const iconColor = stepType === 'test' ? 'text-blue-500' : 'text-green-500';
  const bgColor = stepType === 'test' ? 'bg-blue-500/10' : 'bg-green-500/10';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-3 bg-background border rounded-lg group',
        isDragging && 'shadow-lg ring-2 ring-primary',
        !isDragging && 'shadow-sm'
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

      <div className={cn('flex items-center justify-center w-7 h-7 rounded', bgColor)}>
        <Icon className={cn('w-4 h-4', iconColor)} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground">
          {stepType === 'test' ? 'Test' : 'Script'}
        </p>
      </div>

      {onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onEdit}
          disabled={disabled}
        >
          <Pencil className="w-4 h-4" />
        </Button>
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
