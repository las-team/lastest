'use client';

import { useState, useRef, useCallback } from 'react';
import type { AlignmentSegment } from '@/lib/db/schema';

type ViewMode = 'slider' | 'side-by-side' | 'overlay' | 'three-way' | 'planned-vs-actual' | 'shift-compare';

interface SliderComparisonProps {
  baselineImage?: string;
  currentImage: string;
  diffImage?: string;
  plannedImage?: string;
  plannedDiffImage?: string;
  alignedBaselineImage?: string;
  alignedCurrentImage?: string;
  alignmentSegments?: AlignmentSegment[];
  leftLabel?: string;
  rightLabel?: string;
  className?: string;
}

export function SliderComparison({
  baselineImage,
  currentImage,
  diffImage,
  plannedImage,
  plannedDiffImage,
  alignedBaselineImage,
  alignedCurrentImage,
  alignmentSegments,
  leftLabel = 'Baseline',
  rightLabel = 'Current',
  className = '',
}: SliderComparisonProps) {
  const hasAlignedImages = !!(alignedBaselineImage && alignedCurrentImage);

  const defaultMode: ViewMode = hasAlignedImages
    ? 'shift-compare'
    : baselineImage && plannedImage
      ? 'three-way'
      : baselineImage
        ? 'slider'
        : plannedImage
          ? 'planned-vs-actual'
          : 'slider';

  const [sliderPosition, setSliderPosition] = useState(50);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const ViewModeButtons = () => (
    <div className="flex gap-2 mb-4 flex-wrap">
      {baselineImage && (
        <>
          <button
            className={`px-3 py-1 rounded text-sm ${viewMode === 'slider' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            onClick={() => setViewMode('slider')}
          >
            Slider
          </button>
          <button
            className={`px-3 py-1 rounded text-sm ${viewMode === 'side-by-side' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            onClick={() => setViewMode('side-by-side')}
          >
            Side by Side
          </button>
          {diffImage && (
            <button
              className={`px-3 py-1 rounded text-sm ${viewMode === 'overlay' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
              onClick={() => setViewMode('overlay')}
            >
              Diff Overlay
            </button>
          )}
        </>
      )}
      {hasAlignedImages && (
        <button
          className={`px-3 py-1 rounded text-sm ${viewMode === 'shift-compare' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700'}`}
          onClick={() => setViewMode('shift-compare')}
        >
          Shift Compare
        </button>
      )}
      {plannedImage && (
        <>
          {baselineImage && (
            <button
              className={`px-3 py-1 rounded text-sm ${viewMode === 'three-way' ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}
              onClick={() => setViewMode('three-way')}
            >
              Three-Way
            </button>
          )}
          <button
            className={`px-3 py-1 rounded text-sm ${viewMode === 'planned-vs-actual' ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}
            onClick={() => setViewMode('planned-vs-actual')}
          >
            Planned vs Actual
          </button>
        </>
      )}
    </div>
  );

  if (viewMode === 'shift-compare' && hasAlignedImages) {
    const totalRows = alignmentSegments?.reduce((sum, s) => sum + s.count, 0) ?? 1;
    const markers: { op: 'insert' | 'delete'; topPct: number; heightPct: number }[] = [];
    let rowOffset = 0;
    for (const seg of alignmentSegments ?? []) {
      if (seg.op === 'insert' || seg.op === 'delete') {
        markers.push({
          op: seg.op,
          topPct: (rowOffset / totalRows) * 100,
          heightPct: (seg.count / totalRows) * 100,
        });
      }
      rowOffset += seg.count;
    }

    return (
      <div className={className}>
        <ViewModeButtons />
        <div className="grid grid-cols-[16px_1fr_1fr_16px] gap-0 border rounded-lg overflow-hidden">
          {/* Left gutter: delete markers */}
          <div className="relative bg-muted/30">
            {markers.filter(m => m.op === 'delete').map((m, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 bg-red-500/70"
                style={{ top: `${m.topPct}%`, height: `${Math.max(m.heightPct, 0.3)}%` }}
              />
            ))}
          </div>
          {/* Aligned baseline */}
          <div className="relative">
            <div className="text-xs text-muted-foreground text-center py-1 bg-muted/20 border-b">
              {leftLabel} (Aligned)
            </div>
            <img src={alignedBaselineImage} alt="Aligned baseline" className="w-full" />
          </div>
          {/* Aligned current */}
          <div className="relative">
            <div className="text-xs text-muted-foreground text-center py-1 bg-muted/20 border-b">
              {rightLabel} (Aligned)
            </div>
            <img src={alignedCurrentImage} alt="Aligned current" className="w-full" />
          </div>
          {/* Right gutter: insert markers */}
          <div className="relative bg-muted/30">
            {markers.filter(m => m.op === 'insert').map((m, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 bg-green-500/70"
                style={{ top: `${m.topPct}%`, height: `${Math.max(m.heightPct, 0.3)}%` }}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500/70 rounded-sm" /> Deleted rows</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500/70 rounded-sm" /> Inserted rows</span>
        </div>
      </div>
    );
  }

  if (viewMode === 'side-by-side' && baselineImage) {
    return (
      <div className={className}>
        <ViewModeButtons />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground mb-2">{leftLabel}</div>
            <img src={baselineImage} alt={leftLabel} className="w-full border rounded" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-2">{rightLabel}</div>
            <img src={currentImage} alt={rightLabel} className="w-full border rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'three-way' && plannedImage && baselineImage) {
    return (
      <div className={className}>
        <ViewModeButtons />
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-muted-foreground mb-2">{leftLabel}</div>
            <img src={baselineImage} alt={leftLabel} className="w-full border rounded" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground mb-2">{rightLabel}</div>
            <img src={currentImage} alt={rightLabel} className="w-full border rounded" />
          </div>
          <div>
            <div className="text-sm text-primary mb-2 font-medium">Planned (Design)</div>
            <img src={plannedImage} alt="Planned" className="w-full border-2 border-primary/30 rounded" />
          </div>
        </div>
        {plannedDiffImage && (
          <div className="mt-4">
            <div className="text-sm text-primary mb-2 font-medium">Planned vs Current Diff</div>
            <img src={plannedDiffImage} alt="Planned Diff" className="w-full border border-primary/30 rounded" />
          </div>
        )}
      </div>
    );
  }

  if (viewMode === 'planned-vs-actual' && plannedImage) {
    return (
      <div className={className}>
        <ViewModeButtons />

        <div
          ref={containerRef}
          className="relative select-none border-2 border-primary/30 rounded overflow-hidden"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchMove={handleTouchMove}
        >
          {/* Planned (left side) */}
          <div className="relative">
            <img src={plannedImage} alt="Planned" className="w-full" draggable={false} />
          </div>

          {/* Current (right side, clipped) */}
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
          >
            <img src={currentImage} alt="Current" className="w-full" draggable={false} />
          </div>

          {/* Slider handle */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-primary cursor-ew-resize shadow-lg"
            style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleMouseDown}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-primary rounded-full shadow-lg flex items-center justify-center">
              <div className="flex gap-0.5">
                <div className="w-0.5 h-4 bg-white" />
                <div className="w-0.5 h-4 bg-white" />
              </div>
            </div>
          </div>

          {/* Labels */}
          <div className="absolute top-2 left-2 bg-primary/80 text-primary-foreground px-2 py-1 rounded text-xs">
            Planned
          </div>
          <div className="absolute top-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
            {rightLabel}
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'overlay' && diffImage) {
    return (
      <div className={className}>
        <ViewModeButtons />
        <div className="relative">
          <img src={currentImage} alt="Current" className="w-full border rounded" />
          <img
            src={diffImage}
            alt="Diff"
            className="absolute inset-0 w-full h-full opacity-70 mix-blend-multiply"
          />
        </div>
      </div>
    );
  }

  // Default slider mode — requires baselineImage
  if (!baselineImage) {
    // Fallback: just show current image if no baseline and no planned mode matched
    return (
      <div className={className}>
        <ViewModeButtons />
        <div className="text-sm text-muted-foreground mb-2">{rightLabel}</div>
        <img src={currentImage} alt={rightLabel} className="w-full border rounded" />
      </div>
    );
  }

  return (
    <div className={className}>
      <ViewModeButtons />

      <div
        ref={containerRef}
        className="relative select-none border rounded overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchMove={handleTouchMove}
      >
        {/* Baseline (left side) */}
        <div className="relative">
          <img src={baselineImage} alt={leftLabel} className="w-full" draggable={false} />
        </div>

        {/* Current (right side, clipped) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
        >
          <img src={currentImage} alt={rightLabel} className="w-full" draggable={false} />
        </div>

        {/* Slider handle */}
        <div
          className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize shadow-lg"
          style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleMouseDown}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
            <div className="flex gap-0.5">
              <div className="w-0.5 h-4 bg-gray-400" />
              <div className="w-0.5 h-4 bg-gray-400" />
            </div>
          </div>
        </div>

        {/* Labels */}
        <div className="absolute top-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
          {leftLabel}
        </div>
        <div className="absolute top-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
          {rightLabel}
        </div>
      </div>
    </div>
  );
}
