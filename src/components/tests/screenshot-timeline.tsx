'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import type { ScreenshotGroup } from '@/server/actions/tests';
import type { PlannedScreenshot } from '@/lib/db/schema';
import { ScreenshotCard } from '@/components/tests/screenshot-card';
import { ScreenshotViewer } from '@/components/tests/screenshot-viewer';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface ScreenshotTimelineProps {
  testId: string;
  repositoryId: string | null;
  screenshotGroups: ScreenshotGroup[];
  plannedScreenshots: PlannedScreenshot[];
  onUpdate: () => void;
}

interface ViewerState {
  groupIdx: number;
  screenshotIdx: number;
  mode: 'captured' | 'plan';
}

function extractStepLabel(src: string): string {
  const filename = src.split('/').pop() || '';
  const parts = filename.split('-');
  return parts.slice(10).join('-').replace('.png', '') || 'screenshot';
}

export function ScreenshotTimeline({
  testId,
  repositoryId,
  screenshotGroups,
  plannedScreenshots,
  onUpdate,
}: ScreenshotTimelineProps) {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [optimisticPlans, setOptimisticPlans] = useState<Map<string, PlannedScreenshot>>(new Map());
  const dragCounter = useRef(0);

  // When fresh server data arrives that already has the optimistic entry, drop it from local state.
  useEffect(() => {
    if (optimisticPlans.size === 0) return;
    setOptimisticPlans((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const p of plannedScreenshots) {
        if (!p.stepLabel) continue;
        const existing = next.get(p.stepLabel);
        if (existing && existing.id === p.id) {
          next.delete(p.stepLabel);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [plannedScreenshots, optimisticPlans.size]);

  const plannedByLabel = useMemo(() => {
    const map = new Map<string, PlannedScreenshot>();
    for (const p of plannedScreenshots) {
      if (p.stepLabel) map.set(p.stepLabel, p);
    }
    // Optimistic overrides win — they represent the most recent upload.
    for (const [label, p] of optimisticPlans) {
      map.set(label, p);
    }
    return map;
  }, [plannedScreenshots, optimisticPlans]);

  const handleContainerDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setIsDraggingFile(true);
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  };

  const handleContainerDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDraggingFile(false);
  };

  const handleContainerDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    // Check BEFORE container's own preventDefault: card handlers run first and set this when they handle the drop.
    const handledByCard = e.defaultPrevented;
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingFile(false);
    if (!handledByCard && e.dataTransfer.files.length > 0) {
      toast.message('Drop the image directly on a screenshot to attach it as that step’s plan.');
    }
  };

  const handleDropFile = async (stepLabel: string, file: File) => {
    if (!repositoryId) {
      toast.error('Select a repository to upload plans');
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Use PNG, JPEG, or WebP');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File too large (max 10MB)');
      return;
    }

    setUploadingKey(stepLabel);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('repositoryId', repositoryId);
      fd.append('testId', testId);
      fd.append('stepLabel', stepLabel);
      const res = await fetch('/api/planned-screenshots/upload', {
        method: 'POST',
        body: fd,
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || 'Upload failed');
      }
      if (result?.plannedScreenshot) {
        setOptimisticPlans((prev) => {
          const next = new Map(prev);
          next.set(stepLabel, result.plannedScreenshot as PlannedScreenshot);
          return next;
        });
      }
      toast.success(`Plan attached to ${stepLabel.replace(/-/g, ' ')}`);
      onUpdate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingKey(null);
    }
  };

  const currentGroup = viewer ? screenshotGroups[viewer.groupIdx] : null;
  const currentSrc = currentGroup ? currentGroup.screenshots[viewer!.screenshotIdx] : null;
  const currentLabel = currentSrc ? extractStepLabel(currentSrc) : null;
  const currentPlan = currentLabel ? plannedByLabel.get(currentLabel) ?? null : null;
  const hasNext = !!currentGroup && (viewer?.screenshotIdx ?? 0) < currentGroup.screenshots.length - 1;
  const hasPrev = !!currentGroup && (viewer?.screenshotIdx ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <CardTitle className="text-sm">Screenshot Timeline</CardTitle>
          <div className="flex items-start gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-purple-900 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-200 max-w-md">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p className="text-xs leading-snug">
              Drag an image file onto a screenshot to attach it as the planned screenshot for that
              step. Click any screenshot to view full-size; click the corner thumbnail to compare
              against its plan.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {screenshotGroups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No screenshots captured yet
          </div>
        ) : (
          <div
            onDragEnter={handleContainerDragEnter}
            onDragOver={handleContainerDragOver}
            onDragLeave={handleContainerDragLeave}
            onDrop={handleContainerDrop}
            className="space-y-6"
          >
            {screenshotGroups.map((group, groupIdx) => (
              <div key={group.runId} className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground border-b pb-2">
                  <Clock className="h-4 w-4" />
                  <span>
                    {group.startedAt
                      ? new Date(group.startedAt).toLocaleString()
                      : 'Unknown time'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {group.screenshots.map((src, screenshotIdx) => {
                    const label = extractStepLabel(src);
                    const displayLabel = label.replace(/-/g, ' ');
                    const plan = plannedByLabel.get(label) ?? null;
                    return (
                      <ScreenshotCard
                        key={`${group.runId}-${screenshotIdx}`}
                        src={src}
                        label={label}
                        displayLabel={displayLabel}
                        plan={plan}
                        isDraggingFile={isDraggingFile && !!repositoryId}
                        isUploading={uploadingKey === label}
                        onDropFile={(file) => handleDropFile(label, file)}
                        onClick={() =>
                          setViewer({ groupIdx, screenshotIdx, mode: 'captured' })
                        }
                        onClickPlanBadge={() =>
                          setViewer({ groupIdx, screenshotIdx, mode: 'plan' })
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ScreenshotViewer
        open={!!viewer && !!currentSrc}
        imageSrc={currentSrc ?? ''}
        planSrc={currentPlan?.imagePath ?? null}
        mode={viewer?.mode ?? 'captured'}
        hasNext={hasNext}
        hasPrev={hasPrev}
        onClose={() => setViewer(null)}
        onNext={() =>
          setViewer((v) =>
            v ? { ...v, screenshotIdx: v.screenshotIdx + 1, mode: 'captured' } : v,
          )
        }
        onPrev={() =>
          setViewer((v) =>
            v ? { ...v, screenshotIdx: v.screenshotIdx - 1, mode: 'captured' } : v,
          )
        }
        onToggleMode={() =>
          setViewer((v) =>
            v ? { ...v, mode: v.mode === 'captured' ? 'plan' : 'captured' } : v,
          )
        }
      />
    </Card>
  );
}
