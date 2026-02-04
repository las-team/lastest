'use client';

import { useState, useRef, useCallback } from 'react';

type ViewMode = 'slider' | 'side-by-side' | 'overlay' | 'three-way' | 'planned-vs-actual';

interface SliderComparisonProps {
  baselineImage: string;
  currentImage: string;
  diffImage?: string;
  plannedImage?: string;
  plannedDiffImage?: string;
  className?: string;
}

export function SliderComparison({
  baselineImage,
  currentImage,
  diffImage,
  plannedImage,
  plannedDiffImage,
  className = '',
}: SliderComparisonProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [viewMode, setViewMode] = useState<ViewMode>('slider');
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
      <button
        className={`px-3 py-1 rounded text-sm ${viewMode === 'slider' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        onClick={() => setViewMode('slider')}
      >
        Slider
      </button>
      <button
        className={`px-3 py-1 rounded text-sm ${viewMode === 'side-by-side' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        onClick={() => setViewMode('side-by-side')}
      >
        Side by Side
      </button>
      {diffImage && (
        <button
          className={`px-3 py-1 rounded text-sm ${viewMode === 'overlay' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
          onClick={() => setViewMode('overlay')}
        >
          Diff Overlay
        </button>
      )}
      {plannedImage && (
        <>
          <button
            className={`px-3 py-1 rounded text-sm ${viewMode === 'three-way' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700'}`}
            onClick={() => setViewMode('three-way')}
          >
            Three-Way
          </button>
          <button
            className={`px-3 py-1 rounded text-sm ${viewMode === 'planned-vs-actual' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700'}`}
            onClick={() => setViewMode('planned-vs-actual')}
          >
            Planned vs Actual
          </button>
        </>
      )}
    </div>
  );

  if (viewMode === 'side-by-side') {
    return (
      <div className={className}>
        <ViewModeButtons />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-500 mb-2">Baseline</div>
            <img src={baselineImage} alt="Baseline" className="w-full border rounded" />
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-2">Current</div>
            <img src={currentImage} alt="Current" className="w-full border rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'three-way' && plannedImage) {
    return (
      <div className={className}>
        <ViewModeButtons />
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-gray-500 mb-2">Baseline</div>
            <img src={baselineImage} alt="Baseline" className="w-full border rounded" />
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-2">Current</div>
            <img src={currentImage} alt="Current" className="w-full border rounded" />
          </div>
          <div>
            <div className="text-sm text-purple-600 mb-2 font-medium">Planned (Design)</div>
            <img src={plannedImage} alt="Planned" className="w-full border-2 border-purple-300 rounded" />
          </div>
        </div>
        {plannedDiffImage && (
          <div className="mt-4">
            <div className="text-sm text-purple-600 mb-2 font-medium">Planned vs Current Diff</div>
            <img src={plannedDiffImage} alt="Planned Diff" className="w-full border border-purple-300 rounded" />
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
          className="relative select-none border-2 border-purple-300 rounded overflow-hidden"
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
            className="absolute top-0 bottom-0 w-1 bg-purple-500 cursor-ew-resize shadow-lg"
            style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleMouseDown}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-purple-500 rounded-full shadow-lg flex items-center justify-center">
              <div className="flex gap-0.5">
                <div className="w-0.5 h-4 bg-white" />
                <div className="w-0.5 h-4 bg-white" />
              </div>
            </div>
          </div>

          {/* Labels */}
          <div className="absolute top-2 left-2 bg-purple-600/80 text-white px-2 py-1 rounded text-xs">
            Planned
          </div>
          <div className="absolute top-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
            Current
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
          <img src={baselineImage} alt="Baseline" className="w-full" draggable={false} />
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
          Baseline
        </div>
        <div className="absolute top-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
          Current
        </div>
      </div>
    </div>
  );
}
