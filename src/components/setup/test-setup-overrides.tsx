'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { FlaskConical, FileCode, GripVertical, X, RotateCcw, Info } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  skipDefaultStepForTest,
  unskipDefaultStepForTest,
  addExtraSetupStep,
  removeExtraSetupStep,
  reorderExtraSetupSteps,
  saveTestSetupOverrides,
} from '@/server/actions/setup-steps';
import { toast } from 'sonner';
import type { Test, SetupScript, TestSetupOverrides as TestSetupOverridesType } from '@/lib/db/schema';

interface DefaultStep {
  id: string;
  stepType: 'test' | 'script';
  testId: string | null;
  scriptId: string | null;
  orderIndex: number;
  testName: string | null;
  scriptName: string | null;
}

interface ExtraStepDisplay {
  id: string;
  index: number;
  stepType: 'test' | 'script' | 'storage_state';
  name: string;
}

// Sortable extra step item
function SortableExtraStep({
  item,
  onRemove,
}: {
  item: ExtraStepDisplay;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const Icon = item.stepType === 'test' ? FlaskConical : FileCode;
  const iconColor = item.stepType === 'test' ? 'text-blue-500' : 'text-green-500';
  const bgColor = item.stepType === 'test' ? 'bg-blue-500/10' : 'bg-green-500/10';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-3 bg-background border rounded-lg group',
        isDragging && 'shadow-lg ring-2 ring-primary'
      )}
    >
      <button
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <div className={cn('flex items-center justify-center w-7 h-7 rounded', bgColor)}>
        <Icon className={cn('w-4 h-4', iconColor)} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          Extra {item.stepType}
        </p>
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

interface TestSetupOverridesProps {
  testId: string;
  setupOverrides: TestSetupOverridesType | null;
  defaultSetupSteps: DefaultStep[];
  availableTests: Test[];
  availableScripts: SetupScript[];
  /** When provided, called instead of `router.refresh()` after every mutation
   *  so callers that hydrate via a client server-action (e.g. the test-detail
   *  panel) can refetch their cached props. Falls back to `router.refresh()`. */
  onRefresh?: () => Promise<void> | void;
}

export function TestSetupOverrides({
  testId,
  setupOverrides,
  defaultSetupSteps,
  availableTests,
  availableScripts,
  onRefresh,
}: TestSetupOverridesProps) {
  const router = useRouter();
  const refresh = async () => {
    if (onRefresh) await onRefresh();
    else router.refresh();
  };
  const [mounted, setMounted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localOverrides, setLocalOverrides] = useState<TestSetupOverridesType | null>(setupOverrides);

  useEffect(() => {
    setLocalOverrides(setupOverrides);
  }, [setupOverrides]);

  // Local state for skipped defaults
  const skippedIds = new Set(localOverrides?.skippedDefaultStepIds ?? []);
  const hasOverrides = localOverrides !== null && (
    (localOverrides.skippedDefaultStepIds?.length ?? 0) > 0 ||
    (localOverrides.extraSteps?.length ?? 0) > 0
  );

  // Build extra steps display list
  const extraSteps: ExtraStepDisplay[] = (localOverrides?.extraSteps ?? []).map((step, i) => {
    let name = 'Unknown';
    if (step.stepType === 'test' && step.testId) {
      const t = availableTests.find((t) => t.id === step.testId);
      name = t?.name || 'Deleted test';
    } else if (step.stepType === 'script' && step.scriptId) {
      const s = availableScripts.find((s) => s.id === step.scriptId);
      name = s?.name || 'Deleted script';
    }
    return { id: `extra-${i}`, index: i, stepType: step.stepType, name };
  });

  // Add step state
  const [addStepType, setAddStepType] = useState<'test' | 'script'>('test');

  useEffect(() => {
    setMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleToggleSkip = async (stepId: string, isCurrentlySkipped: boolean) => {
    const base: TestSetupOverridesType = localOverrides
      ? {
          skippedDefaultStepIds: [...(localOverrides.skippedDefaultStepIds ?? [])],
          extraSteps: [...(localOverrides.extraSteps ?? [])],
        }
      : { skippedDefaultStepIds: [], extraSteps: [] };
    if (isCurrentlySkipped) {
      base.skippedDefaultStepIds = base.skippedDefaultStepIds.filter((id) => id !== stepId);
    } else if (!base.skippedDefaultStepIds.includes(stepId)) {
      base.skippedDefaultStepIds.push(stepId);
    }
    const next: TestSetupOverridesType | null =
      base.skippedDefaultStepIds.length === 0 && base.extraSteps.length === 0 ? null : base;
    setLocalOverrides(next);

    setIsSaving(true);
    try {
      if (isCurrentlySkipped) {
        await unskipDefaultStepForTest(testId, stepId);
      } else {
        await skipDefaultStepForTest(testId, stepId);
      }
      await refresh();
    } catch {
      setLocalOverrides(localOverrides);
      toast.error('Failed to update setup override');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddExtra = async (stepType: 'test' | 'script', itemId: string) => {
    const base: TestSetupOverridesType = localOverrides
      ? {
          skippedDefaultStepIds: [...(localOverrides.skippedDefaultStepIds ?? [])],
          extraSteps: [...(localOverrides.extraSteps ?? [])],
        }
      : { skippedDefaultStepIds: [], extraSteps: [] };
    base.extraSteps.push({
      stepType,
      testId: stepType === 'test' ? itemId : null,
      scriptId: stepType === 'script' ? itemId : null,
      storageStateId: null,
    });
    setLocalOverrides(base);

    setIsSaving(true);
    try {
      await addExtraSetupStep(testId, stepType, itemId);
      await refresh();
      toast.success('Extra step added');
    } catch {
      setLocalOverrides(localOverrides);
      toast.error('Failed to add extra step');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveExtra = async (index: number) => {
    const base: TestSetupOverridesType = localOverrides
      ? {
          skippedDefaultStepIds: [...(localOverrides.skippedDefaultStepIds ?? [])],
          extraSteps: [...(localOverrides.extraSteps ?? [])],
        }
      : { skippedDefaultStepIds: [], extraSteps: [] };
    if (index >= 0 && index < base.extraSteps.length) {
      base.extraSteps.splice(index, 1);
    }
    const next: TestSetupOverridesType | null =
      base.skippedDefaultStepIds.length === 0 && base.extraSteps.length === 0 ? null : base;
    setLocalOverrides(next);

    setIsSaving(true);
    try {
      await removeExtraSetupStep(testId, index);
      await refresh();
    } catch {
      setLocalOverrides(localOverrides);
      toast.error('Failed to remove extra step');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = extraSteps.findIndex((s) => s.id === active.id);
    const newIndex = extraSteps.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(
      extraSteps.map((_, i) => i),
      oldIndex,
      newIndex
    );

    const base: TestSetupOverridesType = localOverrides
      ? {
          skippedDefaultStepIds: [...(localOverrides.skippedDefaultStepIds ?? [])],
          extraSteps: reordered
            .map((i) => localOverrides.extraSteps?.[i])
            .filter((s): s is NonNullable<typeof s> => Boolean(s)),
        }
      : { skippedDefaultStepIds: [], extraSteps: [] };
    setLocalOverrides(base);

    setIsSaving(true);
    try {
      await reorderExtraSetupSteps(testId, reordered);
      await refresh();
    } catch {
      setLocalOverrides(localOverrides);
      toast.error('Failed to reorder steps');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    setLocalOverrides(null);
    setIsSaving(true);
    try {
      await saveTestSetupOverrides(testId, null);
      await refresh();
      toast.success('Reset to defaults');
    } catch {
      setLocalOverrides(localOverrides);
      toast.error('Failed to reset');
    } finally {
      setIsSaving(false);
    }
  };

  // Items already in extra steps (to exclude from picker)
  const extraTestIds = new Set(
    (setupOverrides?.extraSteps ?? [])
      .filter((s) => s.stepType === 'test' && s.testId)
      .map((s) => s.testId!)
  );
  const extraScriptIds = new Set(
    (setupOverrides?.extraSteps ?? [])
      .filter((s) => s.stepType === 'script' && s.scriptId)
      .map((s) => s.scriptId!)
  );

  const pickableTests = availableTests.filter((t) => t.id !== testId && !extraTestIds.has(t.id));
  const pickableScripts = availableScripts.filter((s) => !extraScriptIds.has(s.id));

  if (!mounted) {
    return <div className="p-4 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4" />
          {hasOverrides ? (
            <span>This test has custom setup overrides</span>
          ) : (
            <span>Using defaults{defaultSetupSteps.length === 0 ? ' (none configured)' : ''}</span>
          )}
        </div>
        {hasOverrides && (
          <Button variant="outline" size="sm" onClick={handleResetToDefaults} disabled={isSaving}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset to defaults
          </Button>
        )}
      </div>

      {/* Default Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Default Steps</CardTitle>
        </CardHeader>
        <CardContent>
          {defaultSetupSteps.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No default setup steps configured for this repository.
              Configure them in the Environment settings.
            </p>
          ) : (
            <div className="space-y-2">
              {defaultSetupSteps.map((step) => {
                const isSkipped = skippedIds.has(step.id);
                const Icon = step.stepType === 'test' ? FlaskConical : FileCode;
                const iconColor = step.stepType === 'test' ? 'text-blue-500' : 'text-green-500';
                const bgColor = step.stepType === 'test' ? 'bg-blue-500/10' : 'bg-green-500/10';
                const name = step.testName || step.scriptName || 'Unknown';

                return (
                  <div
                    key={step.id}
                    className={cn(
                      'flex items-center gap-3 p-3 border rounded-lg transition-opacity',
                      isSkipped && 'opacity-50'
                    )}
                  >
                    <div className={cn('flex items-center justify-center w-7 h-7 rounded', bgColor)}>
                      <Icon className={cn('w-4 h-4', iconColor)} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm font-medium truncate', isSkipped && 'line-through')}>
                        {name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {step.stepType === 'test' ? 'Test' : 'Script'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {isSkipped ? 'Skipped' : 'Active'}
                      </span>
                      <Switch
                        checked={!isSkipped}
                        onCheckedChange={() => handleToggleSkip(step.id, isSkipped)}
                        disabled={isSaving}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Extra Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Extra Steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {extraSteps.length > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={extraSteps.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {extraSteps.map((step) => (
                    <SortableExtraStep
                      key={step.id}
                      item={step}
                      onRemove={() => handleRemoveExtra(step.index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              No extra steps. Add steps that run after the defaults.
            </p>
          )}

          {/* Add step picker */}
          <div className="flex gap-2 items-center pt-2 border-t">
            <Select value={addStepType} onValueChange={(v) => setAddStepType(v as 'test' | 'script')}>
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Test</SelectItem>
                <SelectItem value="script">Script</SelectItem>
              </SelectContent>
            </Select>

            <Select
              onValueChange={(itemId) => handleAddExtra(addStepType, itemId)}
              disabled={isSaving}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select to add..." />
              </SelectTrigger>
              <SelectContent>
                {addStepType === 'test' ? (
                  pickableTests.length > 0 ? (
                    pickableTests.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <div className="flex items-center gap-2">
                          <FlaskConical className="w-3.5 h-3.5 text-blue-500" />
                          {t.name}
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="_none" disabled>No tests available</SelectItem>
                  )
                ) : (
                  pickableScripts.length > 0 ? (
                    pickableScripts.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <FileCode className="w-3.5 h-3.5 text-green-500" />
                          {s.name}
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="_none" disabled>No scripts available</SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
