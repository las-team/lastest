'use client';

import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, AlertTriangle, Power, ArrowUp } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SelectorConfig, SelectorType } from '@/lib/db/schema';
import type { SelectorRecommendation } from '@/lib/selector-recommendations';

const SELECTOR_LABELS: Record<SelectorType, { name: string; description: string }> = {
  'data-testid': { name: 'data-testid', description: 'Elements with data-testid attribute' },
  'id': { name: 'ID', description: 'Elements with id attribute' },
  'role-name': { name: 'Role + Name', description: 'ARIA role with accessible name' },
  'aria-label': { name: 'aria-label', description: 'Elements with aria-label attribute' },
  'text': { name: 'Text Content', description: 'Visible text in buttons/links' },
  'placeholder': { name: 'Placeholder', description: 'Input placeholder attribute' },
  'name': { name: 'Name', description: 'Form element name attribute' },
  'css-path': { name: 'CSS Path', description: 'CSS selector path (fallback)' },
  'ocr-text': { name: 'OCR Text', description: 'Text extracted via OCR' },
  'coords': { name: 'Coordinates', description: 'Click by X/Y coordinates (fallback)' },
};

function RecommendationBadge({ recommendation }: { recommendation: SelectorRecommendation }) {
  const config = {
    disable: {
      icon: AlertTriangle,
      label: 'Consider disabling',
      className: 'bg-red-100 text-red-700 border-red-200',
    },
    enable: {
      icon: Power,
      label: 'Consider enabling',
      className: 'bg-green-100 text-green-700 border-green-200',
    },
    move_up: {
      icon: ArrowUp,
      label: 'Move up',
      className: 'bg-blue-100 text-blue-700 border-blue-200',
    },
  }[recommendation.type];

  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${config.className}`}
          >
            <Icon className="w-3 h-3" />
            {config.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{recommendation.reason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface SortableItemProps {
  item: SelectorConfig;
  onToggle: (type: SelectorType, enabled: boolean) => void;
  compact?: boolean;
  recommendation?: SelectorRecommendation;
}

function SortableItem({ item, onToggle, compact = false, recommendation }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.type });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const label = SELECTOR_LABELS[item.type];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 ${compact ? 'p-2' : 'p-3'} bg-white border rounded-lg ${
        isDragging ? 'shadow-lg' : 'shadow-sm'
      } ${!item.enabled ? 'opacity-60' : ''}`}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
        {...attributes}
        {...listeners}
      >
        <GripVertical className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-medium ${compact ? 'text-xs' : 'text-sm'}`}>{label.name}</span>
          <span className={`bg-gray-100 rounded text-gray-500 ${compact ? 'text-[10px] px-1 py-0.5' : 'text-xs px-1.5 py-0.5'}`}>
            #{item.priority}
          </span>
          {!compact && recommendation && <RecommendationBadge recommendation={recommendation} />}
        </div>
        {!compact && <p className="text-xs text-gray-500 truncate">{label.description}</p>}
      </div>

      <Switch
        checked={item.enabled}
        onCheckedChange={(checked) => onToggle(item.type, checked)}
        className={compact ? 'scale-90' : ''}
      />
    </div>
  );
}

interface SelectorPriorityListProps {
  value: SelectorConfig[];
  onChange: (value: SelectorConfig[]) => void;
  compact?: boolean;
  recommendations?: Map<SelectorType, SelectorRecommendation>;
}

export function SelectorPriorityList({ value, onChange, compact = false, recommendations }: SelectorPriorityListProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = value.findIndex((item) => item.type === active.id);
      const newIndex = value.findIndex((item) => item.type === over.id);

      const newOrder = arrayMove(value, oldIndex, newIndex).map((item, index) => ({
        ...item,
        priority: index + 1,
      }));

      onChange(newOrder);
    }
  };

  const handleToggle = (type: SelectorType, enabled: boolean) => {
    const newValue = value.map((item) =>
      item.type === type ? { ...item, enabled } : item
    );
    onChange(newValue);
  };

  // Render static list on server, sortable list on client (avoids hydration mismatch)
  if (!mounted) {
    return (
      <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
        {!compact && (
          <>
            <Label className="text-sm font-medium">Selector Priority</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Drag to reorder. During recording, all selector types are captured.
              During test runs, selectors are tried in this priority order.
            </p>
          </>
        )}
        <div className={compact ? 'space-y-1' : 'space-y-2'}>
          {value.map((item) => {
            const label = SELECTOR_LABELS[item.type];
            const recommendation = recommendations?.get(item.type);
            return (
              <div
                key={item.type}
                className={`flex items-center gap-2 ${compact ? 'p-2' : 'p-3'} bg-white border rounded-lg shadow-sm ${!item.enabled ? 'opacity-60' : ''}`}
              >
                <div className="cursor-grab text-gray-400">
                  <GripVertical className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`font-medium ${compact ? 'text-xs' : 'text-sm'}`}>{label.name}</span>
                    <span className={`bg-gray-100 rounded text-gray-500 ${compact ? 'text-[10px] px-1 py-0.5' : 'text-xs px-1.5 py-0.5'}`}>
                      #{item.priority}
                    </span>
                    {!compact && recommendation && <RecommendationBadge recommendation={recommendation} />}
                  </div>
                  {!compact && <p className="text-xs text-gray-500 truncate">{label.description}</p>}
                </div>
                <Switch checked={item.enabled} disabled className={compact ? 'scale-90' : ''} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {!compact && (
        <>
          <Label className="text-sm font-medium">Selector Priority</Label>
          <p className="text-xs text-muted-foreground mb-3">
            Drag to reorder. During recording, all selector types are captured.
            During test runs, selectors are tried in this priority order.
          </p>
        </>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={value.map((item) => item.type)}
          strategy={verticalListSortingStrategy}
        >
          <div className={compact ? 'space-y-1' : 'space-y-2'}>
            {value.map((item) => (
              <SortableItem
                key={item.type}
                item={item}
                onToggle={handleToggle}
                compact={compact}
                recommendation={recommendations?.get(item.type)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
