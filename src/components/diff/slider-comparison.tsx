'use client';

import { useState, useRef, useCallback } from 'react';
import type { AlignmentSegment } from '@/lib/db/schema';

type ViewMode = 'slider' | 'side-by-side' | 'overlay' | 'three-way' | 'planned-vs-actual' | 'shift-compare';

function RegionOverlay({ dims, regions }: { dims: { width: number; height: number } | null; regions: ChangedRegion[] }) {
  if (!dims || regions.length === 0) return null;
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${dims.width} ${dims.height}`}
      preserveAspectRatio="none"
    >
      {regions.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill="none"
          stroke="rgba(255,0,0,0.7)"
          strokeWidth="2"
          strokeDasharray="4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export interface FocusRegionRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function FocusRegionOverlay({
  dims,
  regions,
  onDelete,
}: {
  dims: { width: number; height: number } | null;
  regions: FocusRegionRect[];
  onDelete?: (id: string) => void;
}) {
  if (!dims || regions.length === 0) return null;
  return (
    <>
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${dims.width} ${dims.height}`}
        preserveAspectRatio="none"
      >
        {regions.map((r) => (
          <rect
            key={r.id}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            fill="rgba(34,197,94,0.08)"
            stroke="rgba(34,197,94,0.9)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {onDelete && regions.map((r) => {
        const leftPct = ((r.x + r.width) / dims.width) * 100;
        const topPct = (r.y / dims.height) * 100;
        return (
          <button
            key={`del-${r.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(r.id);
            }}
            title="Remove focus region"
            className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-green-600 text-white text-xs leading-none shadow flex items-center justify-center hover:bg-green-700"
            style={{ left: `${leftPct}%`, top: `${topPct}%` }}
          >
            ×
          </button>
        );
      })}
    </>
  );
}

interface DrawLayerProps {
  dims: { width: number; height: number } | null;
  onDrawn: (rect: { x: number; y: number; width: number; height: number }) => void;
}

function DrawLayer({ dims, onDrawn }: DrawLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);

  const toNatural = useCallback((clientX: number, clientY: number) => {
    if (!layerRef.current || !dims) return null;
    const rect = layerRef.current.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * dims.width;
    const py = ((clientY - rect.top) / rect.height) * dims.height;
    return { x: Math.max(0, Math.min(dims.width, px)), y: Math.max(0, Math.min(dims.height, py)) };
  }, [dims]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = toNatural(e.clientX, e.clientY);
    if (!p) return;
    setStart(p);
    setCurrent(p);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!start) return;
    const p = toNatural(e.clientX, e.clientY);
    if (p) setCurrent(p);
  };
  const onMouseUp = () => {
    if (!start || !current || !dims) {
      setStart(null);
      setCurrent(null);
      return;
    }
    const x = Math.round(Math.min(start.x, current.x));
    const y = Math.round(Math.min(start.y, current.y));
    const width = Math.round(Math.abs(current.x - start.x));
    const height = Math.round(Math.abs(current.y - start.y));
    setStart(null);
    setCurrent(null);
    if (width >= 4 && height >= 4) onDrawn({ x, y, width, height });
  };

  const preview = start && current && dims ? {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  } : null;

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 cursor-crosshair select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {preview && dims && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${dims.width} ${dims.height}`}
          preserveAspectRatio="none"
        >
          <rect
            x={preview.x}
            y={preview.y}
            width={preview.width}
            height={preview.height}
            fill="rgba(34,197,94,0.15)"
            stroke="rgba(34,197,94,0.9)"
            strokeWidth="2"
            strokeDasharray="4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  );
}

function DomRegionOverlay({ dims, regions }: { dims: { width: number; height: number } | null; regions: Array<{ x: number; y: number; width: number; height: number; color: string; border: string }> }) {
  if (!dims || regions.length === 0) return null;
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${dims.width} ${dims.height}`}
      preserveAspectRatio="none"
    >
      {regions.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill={r.color}
          stroke={r.border}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

interface ChangedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SliderComparisonProps {
  baselineImage?: string;
  currentImage: string;
  diffImage?: string;
  plannedImage?: string;
  plannedDiffImage?: string;
  alignedBaselineImage?: string;
  alignedCurrentImage?: string;
  alignedDiffImage?: string;
  alignmentSegments?: AlignmentSegment[];
  changedRegions?: ChangedRegion[];
  domOverlayRegions?: Array<{ x: number; y: number; width: number; height: number; color: string; border: string }>;
  showRegions?: boolean;
  focusRegions?: FocusRegionRect[];
  drawFocusMode?: boolean;
  onFocusRegionDrawn?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onFocusRegionDelete?: (id: string) => void;
  leftLabel?: string;
  rightLabel?: string;
  className?: string;
  initialViewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

export function SliderComparison({
  baselineImage,
  currentImage,
  diffImage,
  plannedImage,
  plannedDiffImage,
  alignedBaselineImage,
  alignedCurrentImage,
  alignedDiffImage,
  alignmentSegments,
  changedRegions,
  domOverlayRegions,
  showRegions: showRegionsProp = false,
  focusRegions,
  drawFocusMode = false,
  onFocusRegionDrawn,
  onFocusRegionDelete,
  leftLabel = 'Baseline',
  rightLabel = 'Current',
  className = '',
  initialViewMode,
  onViewModeChange,
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
  const [viewMode, setViewModeInternal] = useState<ViewMode>(initialViewMode ?? defaultMode);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeInternal(mode);
    onViewModeChange?.(mode);
  }, [onViewModeChange]);
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  const visibleRegions = showRegionsProp && changedRegions?.length ? changedRegions : [];

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

  const viewModeButtons = (
    <div className="flex gap-2 mb-4 flex-wrap">
      {baselineImage && (
        <>
          <button
            className={`px-3 py-1 rounded text-sm ${viewMode === 'slider' ? 'bg-accent text-accent-foreground' : 'bg-muted'}`}
            onClick={() => setViewMode('slider')}
          >
            Slider
          </button>
          <button
            className={`px-3 py-1 rounded text-sm ${viewMode === 'side-by-side' ? 'bg-accent text-accent-foreground' : 'bg-muted'}`}
            onClick={() => setViewMode('side-by-side')}
          >
            Side by Side
          </button>
          {diffImage && (
            <button
              className={`px-3 py-1 rounded text-sm ${viewMode === 'overlay' ? 'bg-accent text-accent-foreground' : 'bg-muted'}`}
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
              className={`px-3 py-1 rounded text-sm ${viewMode === 'three-way' ? 'bg-accent text-accent-foreground' : 'bg-accent/40 text-accent-foreground'}`}
              onClick={() => setViewMode('three-way')}
            >
              Three-Way
            </button>
          )}
          <button
            className={`px-3 py-1 rounded text-sm ${viewMode === 'planned-vs-actual' ? 'bg-accent text-accent-foreground' : 'bg-accent/40 text-accent-foreground'}`}
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
        {viewModeButtons}
        {/* Headers above the grid so gutters + images align vertically */}
        <div className="grid grid-cols-[16px_1fr_1fr_16px] gap-0 border-x border-t rounded-t-lg overflow-hidden">
          <div />
          <div className="text-xs text-muted-foreground text-center py-1 bg-muted/20 border-b">
            {leftLabel} (Aligned)
          </div>
          <div className="text-xs text-muted-foreground text-center py-1 bg-muted/20 border-b">
            {rightLabel} (Aligned)
          </div>
          <div />
        </div>
        <div className="grid grid-cols-[16px_1fr_1fr_16px] gap-0 border rounded-b-lg overflow-hidden">
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
          {/* Aligned baseline with diff overlay */}
          <div className="relative">
            <img src={alignedBaselineImage} alt="Aligned baseline" className="w-full" />
            {alignedDiffImage && (
              <img
                src={alignedDiffImage}
                alt="Diff overlay"
                className="absolute inset-0 w-full h-full opacity-50 mix-blend-multiply pointer-events-none"
              />
            )}
          </div>
          {/* Aligned current with diff overlay */}
          <div className="relative">
            <img src={alignedCurrentImage} alt="Aligned current" className="w-full" />
            {alignedDiffImage && (
              <img
                src={alignedDiffImage}
                alt="Diff overlay"
                className="absolute inset-0 w-full h-full opacity-50 mix-blend-multiply pointer-events-none"
              />
            )}
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
          {alignedDiffImage && (
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-fuchsia-500/70 rounded-sm" /> Pixel differences</span>
          )}
        </div>
      </div>
    );
  }

  if (viewMode === 'side-by-side' && baselineImage) {
    return (
      <div className={className}>
        {viewModeButtons}
        <div className="grid grid-cols-2 gap-4">
          <div className="relative">
            <div className="text-sm text-muted-foreground mb-2">{leftLabel}</div>
            <div className="relative">
              <img src={baselineImage} alt={leftLabel} className="w-full border rounded" onLoad={handleImageLoad} />
              <RegionOverlay dims={imageDims} regions={visibleRegions} />
            </div>
          </div>
          <div className="relative">
            <div className="text-sm text-muted-foreground mb-2">{rightLabel}</div>
            <div className="relative">
              <img src={currentImage} alt={rightLabel} className="w-full border rounded" />
              <RegionOverlay dims={imageDims} regions={visibleRegions} />
              <DomRegionOverlay dims={imageDims} regions={domOverlayRegions ?? []} />
              <FocusRegionOverlay dims={imageDims} regions={focusRegions ?? []} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'three-way' && plannedImage && baselineImage) {
    return (
      <div className={className}>
        {viewModeButtons}
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
        {viewModeButtons}

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
        {viewModeButtons}
        <div className="relative">
          <img src={currentImage} alt="Current" className="w-full border rounded" onLoad={handleImageLoad} />
          <img
            src={diffImage}
            alt="Diff"
            className="absolute inset-0 w-full h-full opacity-70 mix-blend-multiply"
          />
          <RegionOverlay dims={imageDims} regions={visibleRegions} />
          <DomRegionOverlay dims={imageDims} regions={domOverlayRegions ?? []} />
          <FocusRegionOverlay dims={imageDims} regions={focusRegions ?? []} />
        </div>
      </div>
    );
  }

  // Default slider mode — requires baselineImage
  if (!baselineImage) {
    // Fallback: just show current image if no baseline and no planned mode matched
    return (
      <div className={className}>
        {viewModeButtons}
        <div className="text-sm text-muted-foreground mb-2">{rightLabel}</div>
        <img src={currentImage} alt={rightLabel} className="w-full border rounded" />
      </div>
    );
  }

  return (
    <div className={className}>
      {viewModeButtons}

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
          <img src={baselineImage} alt={leftLabel} className="w-full" draggable={false} onLoad={handleImageLoad} />
        </div>

        {/* Current (right side, clipped — fully revealed while drawing focus regions) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 0 0 ${drawFocusMode ? 0 : sliderPosition}%)` }}
        >
          <img src={currentImage} alt={rightLabel} className="w-full" draggable={false} />
        </div>

        {/* Region overlays */}
        <RegionOverlay dims={imageDims} regions={visibleRegions} />
        <DomRegionOverlay dims={imageDims} regions={domOverlayRegions ?? []} />
        <FocusRegionOverlay dims={imageDims} regions={focusRegions ?? []} onDelete={onFocusRegionDelete} />
        {drawFocusMode && onFocusRegionDrawn && (
          <DrawLayer dims={imageDims} onDrawn={onFocusRegionDrawn} />
        )}

        {/* Slider handle — hidden while drawing so it doesn't intercept the mouse mid-drag */}
        {!drawFocusMode && (
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
        )}

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
