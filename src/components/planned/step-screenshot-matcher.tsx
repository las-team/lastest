'use client';

import { useState, useRef } from 'react';
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
import { Upload, Check, X, Image as ImageIcon, GripVertical, Link2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { assignPlannedToStep, unassignPlannedFromStep, deletePlannedScreenshot } from '@/server/actions/planned-screenshots';
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

// Draggable planned screenshot item with delete on hover
function DraggablePlannedItem({
  screenshot,
  isDragging,
  onDelete,
  isDeleting,
}: {
  screenshot: PlannedScreenshot;
  isDragging?: boolean;
  onDelete: (id: string) => void;
  isDeleting?: boolean;
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
      className="group relative border rounded-lg p-2 bg-white hover:border-purple-400 transition-colors"
    >
      {/* Delete button - shown on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(screenshot.id);
        }}
        disabled={isDeleting}
        className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
        title="Delete"
      >
        {isDeleting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </button>

      <div
        {...listeners}
        {...attributes}
        className="flex items-start gap-2 cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshot.imagePath}
            alt={screenshot.name || 'Planned'}
            className="w-full h-16 object-cover rounded border"
          />
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
  onDeletePlanned,
  isDeletingPlanned,
}: {
  step: StepInfo;
  matchedPlanned: PlannedScreenshot | null;
  isOver: boolean;
  onUnmatch: (plannedId: string) => void;
  onDeletePlanned: (plannedId: string) => void;
  isDeletingPlanned?: boolean;
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
            <div className="group relative flex items-start gap-2 p-2 bg-green-50 border border-green-200 rounded-lg">
              <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link2 className="h-3 w-3 text-green-600" />
                  <span className="text-xs font-medium text-green-700">Matched</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={matchedPlanned.imagePath}
                  alt={matchedPlanned.name || 'Planned'}
                  className="w-full h-12 object-cover rounded border mt-1"
                />
              </div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => onUnmatch(matchedPlanned.id)}
                  className="p-1 hover:bg-yellow-100 rounded text-yellow-600"
                  title="Unmatch (keep image)"
                >
                  <Link2 className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onDeletePlanned(matchedPlanned.id)}
                  disabled={isDeletingPlanned}
                  className="p-1 hover:bg-red-100 rounded text-red-500"
                  title="Delete image"
                >
                  {isDeletingPlanned ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </button>
              </div>
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

// Simple inline uploader - immediately uploads on file select
function InlineUploader({
  repositoryId,
  testId,
  onUploadComplete,
}: {
  repositoryId: string;
  testId: string;
  onUploadComplete: () => void;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    // Validate file
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Use PNG, JPEG, or WebP.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Max 10MB.');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('repositoryId', repositoryId);
      formData.append('testId', testId);

      const response = await fetch('/api/planned-screenshots/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Upload failed');
      }

      toast.success('Screenshot uploaded');
      onUploadComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !isUploading && fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
        isDragging
          ? 'border-purple-500 bg-purple-50'
          : 'border-muted hover:border-purple-400 hover:bg-purple-50/50'
      } ${isUploading ? 'opacity-50 cursor-wait' : ''}`}
    >
      {isUploading ? (
        <>
          <Loader2 className="h-6 w-6 mx-auto mb-2 text-purple-500 animate-spin" />
          <p className="text-sm text-muted-foreground">Uploading...</p>
        </>
      ) : (
        <>
          <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop image or click to upload
          </p>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleChange}
        className="hidden"
        disabled={isUploading}
      />
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
  const [isAssigning, setIsAssigning] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const handleDelete = async (plannedId: string) => {
    setDeletingId(plannedId);
    try {
      await deletePlannedScreenshot(plannedId);
      toast.success('Screenshot deleted');
      onUpdate?.();
    } catch {
      toast.error('Failed to delete screenshot');
    } finally {
      setDeletingId(null);
    }
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
                    onDeletePlanned={handleDelete}
                    isDeletingPlanned={deletingId === matchedByStep.get(step.label)?.id}
                  />
                ))}
              </div>
            </div>

            {/* Right: Planned screenshots (draggable) */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Planned Screenshots (Drag to Match)
              </h4>

              {/* Always-visible upload zone */}
              <InlineUploader
                repositoryId={repositoryId}
                testId={testId}
                onUploadComplete={() => onUpdate?.()}
              />

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
                        onDelete={handleDelete}
                        isDeleting={deletingId === ps.id}
                      />
                    ))}
                  </div>
                </div>
              )}

              {plannedScreenshots.length === 0 && (
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activePlanned.imagePath}
                  alt={activePlanned.name || 'Planned'}
                  className="w-24 h-16 object-cover rounded border"
                />
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
