'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Wifi, WifiOff, Loader2, RefreshCw } from 'lucide-react';
import { BrowserToolbar } from '@/components/embedded-browser/browser-toolbar-client';
import { Button } from '@/components/ui/button';
import type { StreamMouseEvent, StreamKeyboardEvent } from '@/lib/ws/protocol';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;

const SESSION_EXPIRY_WARN_MS = 5 * 60 * 1000; // Warn when <5 min remain

interface BrowserViewerProps {
  streamUrl: string;
  initialViewport?: { width: number; height: number };
  className?: string;
  expiresAt?: Date | string | null;
}

export function BrowserViewer({ streamUrl, initialViewport, className, expiresAt }: BrowserViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [viewport, setViewport] = useState(initialViewport ?? { width: 1280, height: 720 });
  const [currentUrl, setCurrentUrl] = useState<string>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fps, setFps] = useState(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  // FPS counter refs — initialized in useEffect to avoid impure render calls
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);

  // Session expiry countdown
  useEffect(() => {
    if (!expiresAt) return;
    const expiryTime = new Date(expiresAt).getTime();

    const tick = () => {
      const remaining = expiryTime - Date.now();
      setTimeRemaining(remaining > 0 ? remaining : 0);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
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

  // At 1:1 rendering, canvas pixels map directly to viewport pixels

  // Send message to WebSocket
  const sendWs = useCallback((message: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  // Ref to hold the connect function so onclose can call it without circular deps
  const connectWsRef = useRef<(attempt: number) => void>(() => {});

  // WebSocket connection lifecycle
  useEffect(() => {
    if (!streamUrl) return;

    // Initialize FPS timer on first mount
    if (lastFpsUpdateRef.current === 0) {
      lastFpsUpdateRef.current = Date.now();
    }

    const connect = (attempt: number) => {
      let wsUrl = streamUrl;
      if (streamUrl.startsWith('ws://') || streamUrl.startsWith('wss://')) {
        // Direct stream URL — replace hostname with current page hostname for remote access
        const parsed = new URL(wsUrl);
        parsed.hostname = window.location.hostname;
        wsUrl = parsed.toString();
      } else if (streamUrl.startsWith('/')) {
        // Relative path — construct full WebSocket URL from page origin
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${proto}//${window.location.host}${streamUrl}`;
      }
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
        setReconnectAttempt(0);
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
        wsRef.current = null;
        if (intentionalCloseRef.current) {
          setConnectionStatus('disconnected');
          return;
        }
        // Auto-reconnect with exponential backoff
        const nextAttempt = attempt + 1;
        if (nextAttempt <= MAX_RECONNECT_ATTEMPTS) {
          setConnectionStatus('reconnecting');
          setReconnectAttempt(nextAttempt);
          const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt);
          reconnectTimerRef.current = setTimeout(() => connect(nextAttempt), delay);
        } else {
          setConnectionStatus('disconnected');
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, reconnect handled there
      };
    };

    connectWsRef.current = connect;
    intentionalCloseRef.current = false;
    connect(0);

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        // Suppress error/close handlers for intentional cleanup
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN) {
          ws.onopen = null;
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          // Close after handshake completes to avoid browser warning
          // (React Strict Mode double-invokes effects in dev)
          ws.onopen = () => ws.close();
        }
      }
    };
  }, [streamUrl, renderFrame]);

  // Manual reconnect handler
  const handleManualReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    intentionalCloseRef.current = false;
    setConnectionStatus('connecting');
    setReconnectAttempt(0);
    connectWsRef.current(0);
  }, []);

  // Mouse event handlers
  const handleMouseEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>, action: StreamMouseEvent['action']) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = Math.round(e.clientX - rect.left);
      const y = Math.round(e.clientY - rect.top);

      const payload: StreamMouseEvent = {
        type: 'mouse',
        action,
        x,
        y,
        button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
      };

      if (action === 'down' || action === 'up') {
        payload.clickCount = e.detail || 1;
      }

      sendWs({ type: 'stream:input', payload });
    },
    [sendWs]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = Math.round(e.clientX - rect.left);
      const y = Math.round(e.clientY - rect.top);

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
    [sendWs]
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
    try {
      if (!isFullscreen) {
        containerRef.current.requestFullscreen?.();
        setIsFullscreen(true);
      } else if (document.fullscreenElement) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  // Sync fullscreen state with browser API
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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

      {/* Canvas container — 1:1 pixel rendering, scrollable if larger than available space */}
      <div className="relative overflow-auto rounded-b-lg border bg-black">
        {connectionStatus !== 'connected' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
            {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') ? (
              <div className="flex flex-col items-center gap-2 text-white">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm">
                  {connectionStatus === 'reconnecting'
                    ? `Reconnecting... (attempt ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`
                    : 'Connecting to browser...'}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-white">
                <WifiOff className="h-8 w-8" />
                <span className="text-sm">Browser disconnected</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualReconnect}
                  className="text-white border-white/30 hover:bg-white/10"
                >
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                  Reconnect
                </Button>
              </div>
            )}
          </div>
        )}

        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="cursor-default outline-none"
          style={{
            width: viewport.width,
            height: viewport.height,
          }}
          onMouseMove={(e) => handleMouseEvent(e, 'move')}
          onMouseDown={(e) => handleMouseEvent(e, 'down')}
          onMouseUp={(e) => handleMouseEvent(e, 'up')}
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
        {connectionStatus === 'reconnecting' && (
          <div className="flex items-center gap-1.5 text-xs text-yellow-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            Reconnecting ({reconnectAttempt}/{MAX_RECONNECT_ATTEMPTS})...
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
        <div className="flex items-center gap-3">
          {timeRemaining !== null && timeRemaining <= SESSION_EXPIRY_WARN_MS && (
            <span className={`text-xs font-medium ${timeRemaining <= 60_000 ? 'text-destructive' : 'text-yellow-600'}`}>
              {timeRemaining <= 0
                ? 'Session expired'
                : `${Math.floor(timeRemaining / 60_000)}:${String(Math.floor((timeRemaining % 60_000) / 1000)).padStart(2, '0')} remaining`}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {viewport.width}×{viewport.height}
          </span>
        </div>
      </div>
    </div>
  );
}
