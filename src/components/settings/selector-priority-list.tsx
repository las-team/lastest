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
import { GripVertical } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { SelectorConfig, SelectorType } from '@/lib/db/schema';

const SELECTOR_LABELS: Record<SelectorType, { name: string; description: string }> = {
  'data-testid': { name: 'data-testid', description: 'Elements with data-testid attribute' },
  'id': { name: 'ID', description: 'Elements with id attribute' },
  'role-name': { name: 'Role + Name', description: 'ARIA role with accessible name' },
  'aria-label': { name: 'aria-label', description: 'Elements with aria-label attribute' },
  'text': { name: 'Text Content', description: 'Visible text in buttons/links' },
  'css-path': { name: 'CSS Path', description: 'CSS selector path (fallback)' },
  'ocr-text': { name: 'OCR Text', description: 'Text extracted via OCR' },
};

interface SortableItemProps {
  item: SelectorConfig;
  onToggle: (type: SelectorType, enabled: boolean) => void;
}

function SortableItem({ item, onToggle }: SortableItemProps) {
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
      className={`flex items-center gap-3 p-3 bg-white border rounded-lg ${
        isDragging ? 'shadow-lg' : 'shadow-sm'
      } ${!item.enabled ? 'opacity-60' : ''}`}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{label.name}</span>
          <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
            #{item.priority}
          </span>
        </div>
        <p className="text-xs text-gray-500 truncate">{label.description}</p>
      </div>

      <Switch
        checked={item.enabled}
        onCheckedChange={(checked) => onToggle(item.type, checked)}
      />
    </div>
  );
}

interface SelectorPriorityListProps {
  value: SelectorConfig[];
  onChange: (value: SelectorConfig[]) => void;
}

export function SelectorPriorityList({ value, onChange }: SelectorPriorityListProps) {
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
      <div className="space-y-2">
        <Label className="text-sm font-medium">Selector Priority</Label>
        <p className="text-xs text-muted-foreground mb-3">
          Drag to reorder. During recording, all selector types are captured.
          During test runs, selectors are tried in this priority order.
        </p>
        <div className="space-y-2">
          {value.map((item) => {
            const label = SELECTOR_LABELS[item.type];
            return (
              <div
                key={item.type}
                className={`flex items-center gap-3 p-3 bg-white border rounded-lg shadow-sm ${!item.enabled ? 'opacity-60' : ''}`}
              >
                <div className="cursor-grab text-gray-400">
                  <GripVertical className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{label.name}</span>
                    <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                      #{item.priority}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{label.description}</p>
                </div>
                <Switch checked={item.enabled} disabled />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Selector Priority</Label>
      <p className="text-xs text-muted-foreground mb-3">
        Drag to reorder. During recording, all selector types are captured.
        During test runs, selectors are tried in this priority order.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={value.map((item) => item.type)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {value.map((item) => (
              <SortableItem
                key={item.type}
                item={item}
                onToggle={handleToggle}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
