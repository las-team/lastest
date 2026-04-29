'use client';

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Wifi, WifiOff, Loader2, RefreshCw, Upload } from 'lucide-react';
import { BrowserToolbar } from '@/components/embedded-browser/browser-toolbar-client';
import { Button } from '@/components/ui/button';
import type { StreamMouseEvent, StreamKeyboardEvent, StreamTouchEvent } from '@/lib/ws/protocol';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const FRAME_STALL_TIMEOUT_MS = 8000; // Reconnect if no frames for 8s while "connected"

const SESSION_EXPIRY_WARN_MS = 5 * 60 * 1000; // Warn when <5 min remain

export interface InspectElementResult {
  tag: string;
  id?: string;
  textContent?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  selectors: Array<{ type: string; value: string }>;
}

export interface DomSnapshotResult {
  elements: InspectElementResult[];
  url: string;
  timestamp: number;
}

interface BrowserViewerProps {
  streamUrl: string;
  initialViewport?: { width: number; height: number };
  className?: string;
  expiresAt?: Date | string | null;
  hideControls?: boolean;
  hideToolbar?: boolean; // Suppress the URL/controls bar entirely (no translucent header strip)
  hideStatusBar?: boolean; // Suppress the FPS/viewport-size strip below the canvas
  hideFullscreenToggle?: boolean;
  hideScreenshot?: boolean;
  hideViewportSelector?: boolean;
  readOnlyUrl?: boolean;
  interactive?: boolean;
  inspectMode?: boolean;
  fit?: boolean;
  onInspectResult?: (result: InspectElementResult | null) => void;
  onDomSnapshot?: (result: DomSnapshotResult) => void;
  onViewportChange?: (viewport: { width: number; height: number }) => void;
}

export interface BrowserViewerHandle {
  requestDomSnapshot: () => void;
  sendInspectMode: (enabled: boolean) => void;
}

export const BrowserViewer = forwardRef<BrowserViewerHandle, BrowserViewerProps>(function BrowserViewer({ streamUrl, initialViewport, className, expiresAt, hideControls, hideToolbar, hideStatusBar, hideFullscreenToggle, hideScreenshot, hideViewportSelector, readOnlyUrl, interactive = true, inspectMode, fit, onInspectResult, onDomSnapshot, onViewportChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [viewport, setViewport] = useState(initialViewport ?? { width: 1280, height: 720 });
  const [currentUrl, setCurrentUrl] = useState<string>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fps, setFps] = useState(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [fileChooserPending, setFileChooserPending] = useState(false);

  // FPS counter refs — initialized in useEffect to avoid impure render calls
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalCloseRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const stallCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screencastPausedRef = useRef(false);

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

  // Track the latest frame dimensions so the canvas/wrapper can match the
  // *real* stream aspect ratio. CDP's deviceWidth/Height drifts from the
  // requested viewport (browser chrome, scrollbar, device-metrics rounding)
  // — especially after setup restarts the screencast on a different page.
  const lastFrameSizeRef = useRef<{ width: number; height: number } | null>(null);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  // Render a frame onto the canvas. CDP's metadata width/height can drift
  // from the encoded JPEG's natural dimensions (DPR, scrollbar, device-metrics
  // rounding) — drawing the image unscaled into a metadata-sized buffer would
  // misalign content with the box. Use the image's actual pixel size instead.
  const renderFrame = useCallback((base64Data: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (!imageRef.current) {
      imageRef.current = new Image();
    }
    const img = imageRef.current;
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(img, 0, 0);

      // Sync display aspect with the real frame size when it changes
      const last = lastFrameSizeRef.current;
      if (!last || last.width !== w || last.height !== h) {
        lastFrameSizeRef.current = { width: w, height: h };
        setViewport({ width: w, height: h });
        onViewportChangeRef.current?.({ width: w, height: h });
      }
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

  // Keep callback refs current so the WebSocket onmessage handler (created
  // once at connection time) always calls the latest callback.
  const onInspectResultRef = useRef(onInspectResult);
  onInspectResultRef.current = onInspectResult;
  const onDomSnapshotRef = useRef(onDomSnapshot);
  onDomSnapshotRef.current = onDomSnapshot;

  // Expose imperative methods for parent components
  useImperativeHandle(ref, () => ({
    requestDomSnapshot: () => {
      sendWs({ type: 'stream:dom_snapshot_request', payload: {} });
    },
    sendInspectMode: (enabled: boolean) => {
      sendWs({ type: 'stream:inspect_mode', payload: { enabled } });
    },
  }), [sendWs]);

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
        if (window.location.protocol === 'https:') {
          // On HTTPS pages, direct ws:// is blocked by mixed-content policy.
          // Route through the ws-proxy-preload.js proxy via the origin.
          const url = new URL(streamUrl);
          wsUrl = `wss://${window.location.host}/api/embedded/stream/ws?target=${url.hostname}:${url.port}`;
        } else {
          // HTTP (local dev) — connect directly
          wsUrl = streamUrl;
        }
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
        lastFrameTimeRef.current = Date.now();
        screencastPausedRef.current = false;

        // Start frame stall detection — if no frames arrive for FRAME_STALL_TIMEOUT_MS,
        // the CDP screencast likely died silently. Force reconnect to recover.
        if (stallCheckRef.current) clearInterval(stallCheckRef.current);
        stallCheckRef.current = setInterval(() => {
          if (
            lastFrameTimeRef.current > 0 &&
            Date.now() - lastFrameTimeRef.current > FRAME_STALL_TIMEOUT_MS &&
            wsRef.current?.readyState === WebSocket.OPEN &&
            !screencastPausedRef.current
          ) {
            console.warn('[BrowserViewer] Frame stall detected — reconnecting');
            wsRef.current?.close();
          }
        }, 3000);

        // Apply the initial viewport size to the remote browser
        ws.send(JSON.stringify({
          type: 'stream:session',
          payload: { action: 'resize', viewport: initialViewport ?? { width: 1280, height: 720 } },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'stream:frame': {
              const { data } = message.payload;
              renderFrame(data);

              // Reset stall timer on every frame
              lastFrameTimeRef.current = Date.now();

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

            case 'stream:inspect_element_response': {
              onInspectResultRef.current?.(message.payload.element ?? null);
              break;
            }

            case 'stream:dom_snapshot_response': {
              onDomSnapshotRef.current?.(message.payload);
              break;
            }

            case 'stream:status': {
              if (message.payload.currentUrl) {
                setCurrentUrl(message.payload.currentUrl);
              }
              if (message.payload.viewport) {
                setViewport(message.payload.viewport);
              }
              setFileChooserPending(message.payload.fileChooserPending ?? false);

              // Any status message from the server proves the connection is alive
              lastFrameTimeRef.current = Date.now();

              // Track intentional screencast pauses to suppress stall detection
              const status = message.payload.status;
              if (status === 'busy' || status === 'recording' || status === 'debugging') {
                screencastPausedRef.current = true;
              } else {
                screencastPausedRef.current = false;
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
        if (stallCheckRef.current) { clearInterval(stallCheckRef.current); stallCheckRef.current = null; }
        lastFrameTimeRef.current = 0;
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
      if (stallCheckRef.current) { clearInterval(stallCheckRef.current); stallCheckRef.current = null; }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const scaleX = rect.width ? canvas.width / rect.width : 1;
      const scaleY = rect.height ? canvas.height / rect.height : 1;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

      // In inspect mode: forward moves (for CDP overlay highlighting),
      // intercept clicks to send inspect request instead
      if (inspectMode) {
        if (action === 'move') {
          // Forward moves so CDP Overlay can highlight elements
          sendWs({
            type: 'stream:input',
            payload: { type: 'mouse', action: 'move', x, y } satisfies StreamMouseEvent,
          });
        } else if (action === 'down') {
          // Click → inspect element at this point
          sendWs({
            type: 'stream:inspect_element_request',
            payload: { x, y },
          });
        }
        // Suppress up/wheel in inspect mode
        return;
      }

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
    [sendWs, inspectMode]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width ? canvas.width / rect.width : 1;
      const scaleY = rect.height ? canvas.height / rect.height : 1;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);

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

  // File upload handler for embedded browser
  const handleFileUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files?.length) return;
      const files: Array<{ name: string; data: string; mimeType: string }> = [];
      for (const file of Array.from(input.files)) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        files.push({ name: file.name, data: btoa(binary), mimeType: file.type || 'application/octet-stream' });
      }
      sendWs({ type: 'stream:input', payload: { type: 'file_upload' as const, files } });
      setFileChooserPending(false);
    };
    input.click();
  }, [sendWs]);

  // Keyboard input — hidden textarea receives all keyboard events so that
  // IME composition (accented chars like áúőóüáé) works.  Canvas elements
  // never fire composition events, so we focus a 1×1 textarea instead.
  //
  // Strategy:
  //   • Printable chars: DON'T preventDefault — let them enter the textarea,
  //     then read + forward + clear via the `input` event.
  //   • Non-printable keys (Enter, Backspace, arrows, etc.) and modifier
  //     combos (Ctrl+A): preventDefault and forward as keydown/keyup.
  //   • Dead keys / composition: let the browser compose, then forward the
  //     final composed string from compositionEnd.

  const focusTextarea = useCallback(() => {
    if (interactive && textareaRef.current) {
      // Use rAF so the call runs after the browser finishes its own focus
      // handling for the mousedown that triggered this.
      requestAnimationFrame(() => {
        textareaRef.current?.focus({ preventScroll: true });
      });
    }
  }, [interactive]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // During IME composition, let the browser handle everything
      if (composingRef.current) return;

      // Dead key — let the browser start composition
      if (e.key === 'Dead') return;

      // Intercept paste: read local clipboard and send as clipboard_paste event
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text) {
            sendWs({
              type: 'stream:input',
              payload: { type: 'clipboard_paste' as const, text },
            });
          }
        }).catch(() => {});
        return;
      }

      // Printable character without modifier — let it type into the textarea;
      // the `input` event handler will read, forward, and clear it.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        return; // don't preventDefault — textarea needs the char
      }

      // Everything else (non-printable keys, modifier combos): forward directly
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
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (composingRef.current || e.key === 'Dead') return;
      // Only forward non-printable keyups (printable chars handled via input event)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return;
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

  // Textarea input event — fires for every character that enters the textarea
  // (both normal typing and after composition completes)
  const handleTextareaInput = useCallback(() => {
    if (composingRef.current) return;
    const ta = textareaRef.current;
    if (!ta || !ta.value) return;
    // Forward all accumulated text and clear
    sendWs({
      type: 'stream:input',
      payload: {
        type: 'keyboard',
        action: 'type',
        key: '',
        text: ta.value,
      } satisfies StreamKeyboardEvent,
    });
    ta.value = '';
  }, [sendWs]);

  // IME composition handlers for accented/special characters (á, ú, ő, ó, ü, é, etc.)
  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      composingRef.current = false;
      const composed = e.data;
      if (composed) {
        sendWs({
          type: 'stream:input',
          payload: {
            type: 'keyboard',
            action: 'type',
            key: '',
            text: composed,
          } satisfies StreamKeyboardEvent,
        });
      }
      if (textareaRef.current) {
        textareaRef.current.value = '';
      }
    },
    [sendWs]
  );

  // Touch event helper — extracts touch points relative to canvas
  const getTouchPoints = useCallback((e: globalThis.TouchEvent): StreamTouchEvent['touches'] => {
    const canvas = canvasRef.current;
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width ? canvas.width / rect.width : 1;
    const scaleY = rect.height ? canvas.height / rect.height : 1;
    return Array.from(e.touches).map((t) => ({
      x: Math.round((t.clientX - rect.left) * scaleX),
      y: Math.round((t.clientY - rect.top) * scaleY),
      id: t.identifier,
    }));
  }, []);

  // Attach non-passive touch listeners so preventDefault() works (suppresses synthetic mouse events)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: globalThis.TouchEvent) => {
      e.preventDefault();
      sendWs({
        type: 'stream:input',
        payload: { type: 'touch', action: 'start', touches: getTouchPoints(e) } satisfies StreamTouchEvent,
      });
    };

    const onTouchMove = (e: globalThis.TouchEvent) => {
      e.preventDefault();
      sendWs({
        type: 'stream:input',
        payload: { type: 'touch', action: 'move', touches: getTouchPoints(e) } satisfies StreamTouchEvent,
      });
    };

    const onTouchEnd = (e: globalThis.TouchEvent) => {
      e.preventDefault();
      // On touchend, e.touches is empty — send empty array so CDP knows all fingers lifted
      sendWs({
        type: 'stream:input',
        payload: { type: 'touch', action: 'end', touches: [] } satisfies StreamTouchEvent,
      });
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [sendWs, getTouchPoints]);

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
      {!hideToolbar && (
        <BrowserToolbar
          currentUrl={currentUrl}
          viewport={viewport}
          isFullscreen={isFullscreen}
          onNavigate={handleNavigate}
          onViewportChange={handleViewportChange}
          onFullscreenToggle={hideFullscreenToggle ? undefined : toggleFullscreen}
          hideControls={hideControls}
          hideFullscreenToggle={hideFullscreenToggle}
          hideScreenshot={hideScreenshot}
          hideViewportSelector={hideViewportSelector}
          readOnly={readOnlyUrl}
        />
      )}

      {/* Canvas container — 1:1 pixel rendering (scrollable) or fit-to-container (centered) */}
      <div className={`relative ${hideToolbar ? '' : 'rounded-b-lg border'} bg-black ${fit ? 'flex-1 min-h-0 overflow-hidden flex items-center justify-center' : 'overflow-auto'}`}>
        {connectionStatus !== 'connected' && (
          <div className="absolute inset-0 layer-canvas-overlay flex items-center justify-center bg-black/80">
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

        {fileChooserPending && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 layer-canvas-overlay bg-background/90 border rounded-lg p-6 shadow-lg flex flex-col items-center gap-3">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">File upload requested</p>
            <Button onClick={handleFileUpload} size="sm">Choose Files</Button>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className={`outline-none ${inspectMode ? 'cursor-crosshair' : interactive ? 'cursor-default' : 'cursor-default pointer-events-none'}`}
          style={
            fit
              ? {
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  aspectRatio: `${viewport.width} / ${viewport.height}`,
                  objectFit: 'contain',
                }
              : {
                  width: viewport.width,
                  height: viewport.height,
                }
          }
          onMouseMove={(e) => handleMouseEvent(e, 'move')}
          onMouseDown={(e) => { handleMouseEvent(e, 'down'); focusTextarea(); }}
          onMouseUp={(e) => handleMouseEvent(e, 'up')}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* Hidden textarea for IME/composition support — canvas can't receive composition events.
            pointer-events:none keeps mouse events going to the canvas; focus is set programmatically. */}
        {interactive && (
          <textarea
            ref={textareaRef}
            className="absolute top-0 left-0 overflow-hidden outline-none"
            style={{ width: 1, height: 1, opacity: 0.01, resize: 'none', zIndex: 10, pointerEvents: 'none', caretColor: 'transparent' }}
            tabIndex={0}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-hidden="true"
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onInput={handleTextareaInput}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        )}
      </div>

      {/* Status bar */}
      {!hideStatusBar && (
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
      )}
    </div>
  );
});
