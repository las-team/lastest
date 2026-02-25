'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { BrowserToolbar } from '@/components/embedded-browser/browser-toolbar-client';
import type { StreamMouseEvent, StreamKeyboardEvent } from '@/lib/ws/protocol';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface BrowserViewerProps {
  streamUrl: string;
  initialViewport?: { width: number; height: number };
  className?: string;
}

export function BrowserViewer({ streamUrl, initialViewport, className }: BrowserViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [viewport, setViewport] = useState(initialViewport ?? { width: 1280, height: 720 });
  const [currentUrl, setCurrentUrl] = useState<string>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fps, setFps] = useState(0);

  // FPS counter refs — initialized in useEffect to avoid impure render calls
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(0);
  // Render a frame onto the canvas
  const renderFrame = useCallback((base64Data: string, width: number, height: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (!imageRef.current) {
      imageRef.current = new Image();
    }
    const img = imageRef.current;
    img.onload = () => {
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${base64Data}`;
  }, []);

  // Scale factor for input coordinate translation
  const getScale = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { scaleX: 1, scaleY: 1 };
    return {
      scaleX: viewport.width / canvas.clientWidth,
      scaleY: viewport.height / canvas.clientHeight,
    };
  }, [viewport]);

  // Send message to WebSocket
  const sendWs = useCallback((message: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  // WebSocket connection
  useEffect(() => {
    if (!streamUrl) return;

    // Initialize FPS timer on first mount
    if (lastFpsUpdateRef.current === 0) {
      lastFpsUpdateRef.current = Date.now();
    }

    const ws = new WebSocket(streamUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'stream:frame': {
            const { data, width, height } = message.payload;
            renderFrame(data, width, height);

            // Update FPS
            frameCountRef.current++;
            const now = Date.now();
            if (now - lastFpsUpdateRef.current >= 1000) {
              setFps(frameCountRef.current);
              frameCountRef.current = 0;
              lastFpsUpdateRef.current = now;
            }
            break;
          }

          case 'stream:status': {
            if (message.payload.currentUrl) {
              setCurrentUrl(message.payload.currentUrl);
            }
            if (message.payload.viewport) {
              setViewport(message.payload.viewport);
            }
            break;
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
    };

    ws.onerror = () => {
      setConnectionStatus('error');
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [streamUrl, renderFrame]);

  // Mouse event handlers
  const handleMouseEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>, action: StreamMouseEvent['action']) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scale = getScale();
      const x = Math.round((e.clientX - rect.left) * scale.scaleX);
      const y = Math.round((e.clientY - rect.top) * scale.scaleY);

      const message: { type: string; payload: StreamMouseEvent } = {
        type: 'stream:input',
        payload: {
          type: 'mouse',
          action,
          x,
          y,
          button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
        },
      };

      sendWs(message);
    },
    [getScale, sendWs]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scale = getScale();
      const x = Math.round((e.clientX - rect.left) * scale.scaleX);
      const y = Math.round((e.clientY - rect.top) * scale.scaleY);

      sendWs({
        type: 'stream:input',
        payload: {
          type: 'mouse',
          action: 'wheel',
          x,
          y,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
        } satisfies StreamMouseEvent,
      });
    },
    [getScale, sendWs]
  );

  // Keyboard event handlers
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      sendWs({
        type: 'stream:input',
        payload: {
          type: 'keyboard',
          action: 'keydown',
          key: e.key,
          code: e.code,
          text: e.key.length === 1 ? e.key : undefined,
          modifiers: {
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey,
          },
        } satisfies StreamKeyboardEvent,
      });
    },
    [sendWs]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      sendWs({
        type: 'stream:input',
        payload: {
          type: 'keyboard',
          action: 'keyup',
          key: e.key,
          code: e.code,
          modifiers: {
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey,
          },
        } satisfies StreamKeyboardEvent,
      });
    },
    [sendWs]
  );

  // Toolbar handlers
  const handleNavigate = useCallback(
    (url: string) => {
      sendWs({
        type: 'stream:session',
        payload: { action: 'navigate', url },
      });
    },
    [sendWs]
  );

  const handleViewportChange = useCallback(
    (newViewport: { width: number; height: number }) => {
      setViewport(newViewport);
      sendWs({
        type: 'stream:session',
        payload: { action: 'resize', viewport: newViewport },
      });
    },
    [sendWs]
  );

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  return (
    <div ref={containerRef} className={`flex flex-col ${className ?? ''}`}>
      <BrowserToolbar
        currentUrl={currentUrl}
        viewport={viewport}
        isFullscreen={isFullscreen}
        onNavigate={handleNavigate}
        onViewportChange={handleViewportChange}
        onFullscreenToggle={toggleFullscreen}
      />

      {/* Canvas container */}
      <div className="relative overflow-hidden rounded-b-lg border bg-black">
        {connectionStatus !== 'connected' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
            {connectionStatus === 'connecting' ? (
              <div className="flex flex-col items-center gap-2 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm">Connecting to browser...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-white">
                <WifiOff className="h-8 w-8" />
                <span className="text-sm">Browser disconnected</span>
              </div>
            )}
          </div>
        )}

        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="w-full cursor-default outline-none"
          style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}
          onMouseMove={(e) => handleMouseEvent(e, 'move')}
          onMouseDown={(e) => handleMouseEvent(e, 'down')}
          onMouseUp={(e) => handleMouseEvent(e, 'up')}
          onClick={(e) => handleMouseEvent(e, 'click')}
          onDoubleClick={(e) => handleMouseEvent(e, 'dblclick')}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-2 py-1">
        {connectionStatus === 'connecting' && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Connecting...
          </div>
        )}
        {connectionStatus === 'connected' && (
          <div className="flex items-center gap-1.5 text-xs text-green-600">
            <Wifi className="h-3 w-3" />
            {fps} FPS
          </div>
        )}
        {(connectionStatus === 'disconnected' || connectionStatus === 'error') && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <WifiOff className="h-3 w-3" />
            Disconnected
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {viewport.width}×{viewport.height}
        </span>
      </div>
    </div>
  );
}
