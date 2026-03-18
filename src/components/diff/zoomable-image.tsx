'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export interface ZoomState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface ZoomableImageProps {
  src: string;
  alt: string;
  className?: string;
  onZoomChange?: (zoomState: ZoomState) => void;
}

export function ZoomableImage({ src, alt, className, onZoomChange }: ZoomableImageProps) {
  const [zoomState, setZoomState] = useState<ZoomState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const updateZoomState = useCallback(
    (newState: ZoomState) => {
      setZoomState(newState);
      onZoomChange?.(newState);
    },
    [onZoomChange]
  );

  const handleZoomIn = useCallback(() => {
    const newScale = Math.min(zoomState.scale * 1.5, 5);
    updateZoomState({ ...zoomState, scale: newScale });
  }, [zoomState, updateZoomState]);

  const handleZoomOut = useCallback(() => {
    const newScale = Math.max(zoomState.scale / 1.5, 0.1);
    updateZoomState({ ...zoomState, scale: newScale });
  }, [zoomState, updateZoomState]);

  const handleFitToScreen = useCallback(() => {
    if (!containerRef.current || !imageRef.current) return;

    const container = containerRef.current.getBoundingClientRect();
    const image = imageRef.current;

    const scaleX = container.width / image.naturalWidth;
    const scaleY = container.height / image.naturalHeight;
    const scale = Math.min(scaleX, scaleY, 1);

    updateZoomState({
      scale,
      offsetX: 0,
      offsetY: 0,
    });
  }, [updateZoomState]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      setDragStart({ x: e.clientX - zoomState.offsetX, y: e.clientY - zoomState.offsetY });
    },
    [zoomState.offsetX, zoomState.offsetY]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;

      const newOffsetX = e.clientX - dragStart.x;
      const newOffsetY = e.clientY - dragStart.y;

      updateZoomState({
        ...zoomState,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      });
    },
    [isDragging, dragStart, zoomState, updateZoomState]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(Math.max(zoomState.scale * delta, 0.1), 5);

      updateZoomState({ ...zoomState, scale: newScale });
    },
    [zoomState, updateZoomState]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleFitToScreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleFitToScreen]);

  return (
    <div className="relative">
      <div className="absolute top-2 right-2 flex gap-1 z-10">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleZoomOut}
          disabled={zoomState.scale <= 0.1}
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleZoomIn}
          disabled={zoomState.scale >= 5}
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button variant="secondary" size="sm" onClick={handleFitToScreen}>
          <Maximize2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="absolute top-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-xs z-10">
        {Math.round(zoomState.scale * 100)}%
      </div>

      <div
        ref={containerRef}
        className={`overflow-hidden relative ${className}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          className="transition-transform duration-150"
          style={{
            transform: `scale(${zoomState.scale}) translate(${zoomState.offsetX}px, ${zoomState.offsetY}px)`,
            transformOrigin: 'top left',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}
