'use client';

import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Upload, Check, X, Image as ImageIcon, GripVertical, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlannedScreenshotUploader } from './planned-screenshot-uploader';
import { assignPlannedToStep, unassignPlannedFromStep } from '@/server/actions/planned-screenshots';
import { toast } from 'sonner';
import type { ScreenshotGroup } from '@/server/actions/tests';

interface PlannedScreenshot {
  id: string;
  imagePath: string;
  name: string | null;
  description: string | null;
  stepLabel: string | null;
  sourceUrl: string | null;
  createdAt: Date | null;
}

interface StepScreenshotMatcherProps {
  testId: string;
  repositoryId: string;
  screenshotGroups: ScreenshotGroup[];
  plannedScreenshots: PlannedScreenshot[];
  onUpdate?: () => void;
}

interface StepInfo {
  label: string;
  imagePath: string;
}

// Extract step labels from the latest run
function extractStepsFromGroups(groups: ScreenshotGroup[]): StepInfo[] {
  if (groups.length === 0) return [];

  const latestGroup = groups[0];
  const steps: StepInfo[] = [];

  for (const path of latestGroup.screenshots) {
    const filename = path.split('/').pop() || '';
    // Extract label from filename (after runId-testId-)
    const parts = filename.split('-');
    // Skip first 10 parts (timestamp segments) and get the label
    const label = parts.slice(10).join('-').replace('.png', '') || 'screenshot';
    steps.push({ label, imagePath: path });
  }

  return steps;
}

// Draggable planned screenshot item
function DraggablePlannedItem({
  screenshot,
  isDragging,
}: {
  screenshot: PlannedScreenshot;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: screenshot.id,
    data: { type: 'planned', screenshot },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="border rounded-lg p-2 bg-white cursor-grab active:cursor-grabbing hover:border-purple-400 transition-colors"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <img
            src={screenshot.imagePath}
            alt={screenshot.name || 'Planned'}
            className="w-full h-16 object-cover rounded border"
          />
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {screenshot.name || 'Unnamed'}
          </p>
        </div>
      </div>
    </div>
  );
}

// Droppable step area
function DroppableStepSlot({
  step,
  matchedPlanned,
  isOver,
  onUnmatch,
}: {
  step: StepInfo;
  matchedPlanned: PlannedScreenshot | null;
  isOver: boolean;
  onUnmatch: (plannedId: string) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: `step-${step.label}`,
    data: { type: 'step', step },
  });

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg p-3 transition-colors ${
        isOver ? 'border-purple-500 bg-purple-50' : 'border-border'
      }`}
    >
      <div className="flex gap-3">
        {/* Captured screenshot thumbnail */}
        <div className="flex-shrink-0 w-24">
          <img
            src={step.imagePath}
            alt={step.label}
            className="w-full h-16 object-cover rounded border"
          />
          <p className="text-xs text-center mt-1 font-medium capitalize truncate">
            {step.label}
          </p>
        </div>

        {/* Match indicator / drop zone */}
        <div className="flex-1 min-w-0">
          {matchedPlanned ? (
            <div className="flex items-start gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
              <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link2 className="h-3 w-3 text-green-600" />
                  <span className="text-xs font-medium text-green-700">Matched</span>
                </div>
                <img
                  src={matchedPlanned.imagePath}
                  alt={matchedPlanned.name || 'Planned'}
                  className="w-full h-12 object-cover rounded border mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {matchedPlanned.name || 'Unnamed planned screenshot'}
                </p>
              </div>
              <button
                onClick={() => onUnmatch(matchedPlanned.id)}
                className="p-1 hover:bg-red-100 rounded text-red-500"
                title="Remove match"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div
              className={`h-full min-h-[60px] border-2 border-dashed rounded-lg flex items-center justify-center ${
                isOver ? 'border-purple-400 bg-purple-50' : 'border-muted'
              }`}
            >
              <p className="text-xs text-muted-foreground text-center px-2">
                Drop planned screenshot here
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function StepScreenshotMatcher({
  testId,
  repositoryId,
  screenshotGroups,
  plannedScreenshots,
  onUpdate,
}: StepScreenshotMatcherProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const steps = extractStepsFromGroups(screenshotGroups);

  // Separate matched vs unmatched planned screenshots
  const matchedByStep = new Map<string, PlannedScreenshot>();
  const unmatchedPlanned: PlannedScreenshot[] = [];

  for (const ps of plannedScreenshots) {
    if (ps.stepLabel) {
      matchedByStep.set(ps.stepLabel, ps);
    } else {
      unmatchedPlanned.push(ps);
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: { over: { id: string | number } | null }) => {
    setOverId(event.over ? String(event.over.id) : null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);

    if (!over) return;

    const overData = over.data.current as { type: string; step: StepInfo } | undefined;
    if (overData?.type !== 'step') return;

    const plannedId = active.id as string;
    const stepLabel = overData.step.label;

    setIsAssigning(true);
    try {
      const result = await assignPlannedToStep(plannedId, testId, stepLabel);
      if (result.success) {
        toast.success(`Matched to step: ${stepLabel}`);
        onUpdate?.();
      } else {
        toast.error('Failed to assign screenshot');
      }
    } catch {
      toast.error('Failed to assign screenshot');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUnmatch = async (plannedId: string) => {
    setIsAssigning(true);
    try {
      const result = await unassignPlannedFromStep(plannedId);
      if (result.success) {
        toast.success('Match removed');
        onUpdate?.();
      } else {
        toast.error('Failed to remove match');
      }
    } catch {
      toast.error('Failed to remove match');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUploadComplete = () => {
    setShowUploader(false);
    onUpdate?.();
  };

  const activePlanned = activeId
    ? plannedScreenshots.find((p) => p.id === activeId)
    : null;

  if (steps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-purple-500" />
            Match Planned Screenshots to Steps
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>No captured step screenshots yet</p>
            <p className="text-xs mt-1">Run the test to capture screenshots</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-purple-500" />
          Match Planned Screenshots to Steps
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Captured steps (drop zones) */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Captured Steps (Drop Zones)
              </h4>
              <div className="space-y-2">
                {steps.map((step) => (
                  <DroppableStepSlot
                    key={step.label}
                    step={step}
                    matchedPlanned={matchedByStep.get(step.label) || null}
                    isOver={overId === `step-${step.label}`}
                    onUnmatch={handleUnmatch}
                  />
                ))}
              </div>
            </div>

            {/* Right: Planned screenshots (draggable) */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Planned Screenshots (Drag to Match)
              </h4>

              {/* Upload zone */}
              {showUploader ? (
                <div className="border border-purple-200 rounded-lg p-4 bg-purple-50/50">
                  <PlannedScreenshotUploader
                    repositoryId={repositoryId}
                    testId={testId}
                    onUploadComplete={handleUploadComplete}
                    onCancel={() => setShowUploader(false)}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowUploader(true)}
                  className="w-full border-2 border-dashed rounded-lg p-4 text-center hover:border-purple-400 hover:bg-purple-50/50 transition-colors"
                >
                  <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Click to upload planned screenshot
                  </p>
                </button>
              )}

              {/* Unmatched planned screenshots */}
              {unmatchedPlanned.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Unmatched ({unmatchedPlanned.length})
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {unmatchedPlanned.map((ps) => (
                      <DraggablePlannedItem
                        key={ps.id}
                        screenshot={ps}
                        isDragging={activeId === ps.id}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Already matched (for reference) */}
              {matchedByStep.size > 0 && (
                <div className="space-y-2 pt-4 border-t">
                  <p className="text-xs text-muted-foreground">
                    Already Matched ({matchedByStep.size})
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {Array.from(matchedByStep.values()).map((ps) => (
                      <div
                        key={ps.id}
                        className="border rounded-lg p-2 bg-green-50/50 border-green-200"
                      >
                        <img
                          src={ps.imagePath}
                          alt={ps.name || 'Planned'}
                          className="w-full h-12 object-cover rounded border"
                        />
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {ps.stepLabel}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {plannedScreenshots.length === 0 && !showUploader && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No planned screenshots uploaded yet
                </div>
              )}
            </div>
          </div>

          {/* Drag overlay */}
          <DragOverlay>
            {activePlanned && (
              <div className="border rounded-lg p-2 bg-white shadow-lg cursor-grabbing">
                <img
                  src={activePlanned.imagePath}
                  alt={activePlanned.name || 'Planned'}
                  className="w-24 h-16 object-cover rounded border"
                />
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {activePlanned.name || 'Unnamed'}
                </p>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {isAssigning && (
          <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
            <div className="text-sm text-muted-foreground">Saving...</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
