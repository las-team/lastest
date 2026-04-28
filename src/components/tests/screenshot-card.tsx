'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PlannedScreenshot } from '@/lib/db/schema';

interface ScreenshotCardProps {
  src: string;
  label: string;
  displayLabel: string;
  plan: PlannedScreenshot | null;
  isDraggingFile: boolean;
  isUploading: boolean;
  onDropFile: (file: File) => void;
  onClick: () => void;
  onClickPlanBadge: () => void;
}

export function ScreenshotCard({
  src,
  label,
  displayLabel,
  plan,
  isDraggingFile,
  isUploading,
  onDropFile,
  onClick,
  onClickPlanBadge,
}: ScreenshotCardProps) {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onDropFile(file);
    // do NOT stopPropagation: container needs the bubble to reset its drag state.
  };

  return (
    <div className="space-y-1">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={onClick}
        className="relative cursor-pointer group"
        role="button"
        aria-label={`View screenshot: ${displayLabel}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label || 'Screenshot'}
          className="w-full rounded-lg border group-hover:opacity-90 transition-opacity"
        />

        {isDraggingFile && (
          <div
            className={`absolute inset-0 rounded-lg border-2 border-dashed flex items-center justify-center pointer-events-none transition-colors ${
              isOver
                ? 'border-purple-600 bg-purple-500/20'
                : 'border-purple-400 bg-purple-500/10'
            }`}
          >
            <p className="text-sm font-medium text-purple-700 bg-white/80 px-3 py-1 rounded">
              Drop to set as plan
            </p>
          </div>
        )}

        {isUploading && (
          <div className="absolute inset-0 rounded-lg bg-white/60 flex items-center justify-center pointer-events-none">
            <Loader2 className="h-6 w-6 text-purple-500 animate-spin" />
          </div>
        )}

        {plan && !isDraggingFile && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClickPlanBadge();
            }}
            className="absolute top-2 right-2 z-10 w-14 h-14 lg:w-16 lg:h-16 rounded border-2 border-white shadow-md ring-1 ring-black/10 overflow-hidden bg-white hover:ring-2 hover:ring-purple-500 transition-all"
            title={plan.name || 'View plan'}
            aria-label="View plan"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={plan.imagePath}
              alt={plan.name || 'Plan'}
              className="w-full h-full object-cover"
            />
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center capitalize">{displayLabel}</p>
    </div>
  );
}
