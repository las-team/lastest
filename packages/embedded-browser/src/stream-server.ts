/**
 * Stream Server
 *
 * WebSocket server that streams CDP screencast frames to connected clients
 * and forwards input events back to the browser.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { ScreencastManager } from "./screencast.js";
import type { InputHandler, InputEvent } from "./input-handler.js";

export interface StreamServerOptions {
  port: number;
  authToken?: string; // Optional token for authenticating stream clients
}

interface StreamClient {
  ws: WebSocket;
  id: string;
  connectedAt: number;
  alive: boolean;
  /** Client opted into binary frame transport via `?bin=1` on the upgrade
   *  URL. Legacy clients (older app deploys) keep receiving JSON frames. */
  binaryFrames: boolean;
}

/** First byte of every binary WS message — identifies a JPEG frame. The rest
 *  of the buffer is the raw JPEG. Control messages stay JSON text frames. */
const BINARY_FRAME_TAG = 0x01;

function encodeBinaryFrame(base64Data: string): Buffer {
  const jpeg = Buffer.from(base64Data, "base64");
  const out = Buffer.allocUnsafe(jpeg.length + 1);
  out[0] = BINARY_FRAME_TAG;
  jpeg.copy(out, 1);
  return out;
}

export interface ActionProgressPayload {
  active: boolean;
  label?: string;
  kind?: "selector" | "wait" | "navigation" | "fallback";
  timeoutMs?: number;
  stepIndex?: number;
}

export class StreamServer {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, StreamClient>();
  private screencast: ScreencastManager | null = null;
  private inputHandler: InputHandler | null = null;
  private authToken?: string;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private keepaliveInterval: ReturnType<typeof setInterval> | null = null;
  private lastBroadcastTime = 0;
  private lastStatus = "idle";
  // Last in-flight action progress (selector wait / load wait / fallback
  // click) with the wall-clock time it started — replayed to late-joining
  // viewers with an adjusted remaining budget so their countdown bar lines
  // up with the action's real deadline.
  private lastActionProgress: {
    payload: ActionProgressPayload;
    startedAt: number;
  } | null = null;
  // Last broadcast frame, replayed to newly connected clients. CDP only
  // emits frames on repaint — without the replay, a viewer that (re)connects
  // mid-wait (fullscreen toggle remount, reconnect) stares at a blank canvas
  // until the page next repaints, which can be the rest of a long wait.
  private lastFrame: {
    data: string;
    width: number;
    height: number;
    timestamp: number;
  } | null = null;

  /** Callback for navigate requests from stream clients */
  onNavigate?: (url: string) => Promise<void>;
  /** Callback for viewport resize requests from stream clients */
  onResize?: (viewport: { width: number; height: number }) => Promise<void>;
  /** Callback for inspect element at coordinates */
  onInspectElement?: (x: number, y: number) => Promise<object | null>;
  /** Callback for full DOM snapshot */
  onDomSnapshot?: () => Promise<object>;
  /** Callback when inspect mode toggles (for CDP overlay) */
  onInspectModeChange?: (enabled: boolean) => void;
  /** Called on any forwarded input event — used as a liveness signal so the
   *  recording inactivity watchdog doesn't kill a session the user is
   *  actively looking at / interacting with. */
  onInputActivity?: () => void;
  /** Whether inspect mode is active (suppresses non-mouse input forwarding) */
  inspectMode = false;

  constructor(private options: StreamServerOptions) {
    this.authToken = options.authToken;
  }

  start(): void {
    this.wss = new WebSocketServer({
      port: this.options.port,
      verifyClient: (info, callback) => {
        if (!this.authToken) {
          callback(true);
          return;
        }

        // Check token from query string or header
        const url = new URL(
          info.req.url ?? "",
          `http://localhost:${this.options.port}`,
        );
        const token =
          url.searchParams.get("token") ?? info.req.headers["x-stream-token"];

        if (token === this.authToken) {
          callback(true);
        } else {
          callback(false, 401, "Unauthorized");
        }
      },
    });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const clientId = crypto.randomUUID();
      const reqUrl = new URL(
        req.url ?? "",
        `http://localhost:${this.options.port}`,
      );
      const client: StreamClient = {
        ws,
        id: clientId,
        connectedAt: Date.now(),
        alive: true,
        binaryFrames: reqUrl.searchParams.get("bin") === "1",
      };
      this.clients.set(clientId, client);

      console.log(
        `[StreamServer] Client connected: ${clientId} (total: ${this.clients.size})`,
      );

      // Send the CURRENT status (not a hardcoded "connected") so a viewer
      // that (re)connects mid-phase — e.g. while setup streams frames and no
      // keepalive fires — immediately knows the EB is in setup/recording/etc.
      this.sendToClient(ws, {
        type: "stream:status",
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: {
          status: this.lastStatus,
        },
      });

      // Replay the most recent frame so the canvas paints immediately
      // instead of staying blank until the page next repaints.
      if (this.lastFrame) {
        if (client.binaryFrames) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(encodeBinaryFrame(this.lastFrame.data));
          }
        } else {
          this.sendToClient(ws, {
            type: "stream:frame",
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            payload: this.lastFrame,
          });
        }
      }

      // Replay any in-flight action countdown with the remaining (not the
      // original) budget so a viewer joining mid-wait sees an accurate bar.
      if (this.lastActionProgress?.payload.active) {
        const { payload, startedAt } = this.lastActionProgress;
        const remaining =
          payload.timeoutMs !== undefined
            ? payload.timeoutMs - (Date.now() - startedAt)
            : undefined;
        if (remaining === undefined || remaining > 250) {
          this.sendToClient(ws, {
            type: "stream:action_progress",
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            payload: { ...payload, timeoutMs: remaining },
          });
        }
      }

      // Mark alive on pong response
      ws.on("pong", () => {
        client.alive = true;
      });

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(clientId, message);
        } catch (error) {
          console.error(
            `[StreamServer] Invalid message from ${clientId}:`,
            error,
          );
        }
      });

      ws.on("close", () => {
        this.clients.delete(clientId);
        console.log(
          `[StreamServer] Client disconnected: ${clientId} (total: ${this.clients.size})`,
        );
        // Reset inspect mode when all clients disconnect to prevent stuck state
        if (this.clients.size === 0 && this.inspectMode) {
          this.inspectMode = false;
          this.onInspectModeChange?.(false);
          console.log("[StreamServer] Inspect mode auto-reset (no clients)");
        }
      });

      ws.on("error", (error) => {
        console.error(`[StreamServer] Client error (${clientId}):`, error);
        this.clients.delete(clientId);
      });
    });

    // Ping all clients every 30s to detect dead connections
    this.pingInterval = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (!client.alive) {
          console.log(
            `[StreamServer] Terminating unresponsive client: ${clientId}`,
          );
          client.ws.terminate();
          this.clients.delete(clientId);
          continue;
        }
        client.alive = false;
        client.ws.ping();
      }
    }, 30_000);

    // Send keepalive status when no frames have been broadcast recently,
    // so clients don't mistake an idle page for a broken connection.
    //
    // Two fixes vs the original 5s/"idle" keepalive:
    //  - Re-broadcast the CURRENT status, not a hardcoded "idle". During a
    //    recording, an "idle" keepalive flipped the viewer's stall-detection
    //    suppression off; a short user pause then raced the keepalive against
    //    the viewer's stall timeout and intermittently forced a reconnect
    //    (canvas freeze + viewport reset mid-recording).
    //  - Fire every 2s instead of 5s — the old cadence could deliver the
    //    first keepalive ~8s after the last frame, exactly at the viewer's
    //    stall deadline, making the false-stall race tight and frequent.
    this.keepaliveInterval = setInterval(() => {
      if (this.clients.size === 0) return;
      if (Date.now() - this.lastBroadcastTime < 2000) return;
      this.broadcastStatus(this.lastStatus);
    }, 2000);

    console.log(`[StreamServer] Listening on port ${this.options.port}`);
  }

  setScreencast(screencast: ScreencastManager): void {
    this.screencast = screencast;
  }

  setInputHandler(inputHandler: InputHandler): void {
    this.inputHandler = inputHandler;
  }

  /** Broadcast a frame to all connected clients */
  broadcastFrame(
    data: string,
    width: number,
    height: number,
    timestamp: number,
  ): void {
    this.lastBroadcastTime = Date.now();
    this.lastFrame = { data, width, height, timestamp };
    // Binary transport for opted-in clients (1-byte tag + raw JPEG): ~25%
    // less bandwidth than base64 and no client-side JSON.parse per frame.
    // The legacy JSON envelope is only built if a legacy client is connected.
    let binaryMessage: Buffer | null = null;
    let jsonMessage: string | null = null;

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) {
        this.clients.delete(clientId);
        continue;
      }
      if (client.binaryFrames) {
        binaryMessage ??= encodeBinaryFrame(data);
        client.ws.send(binaryMessage);
      } else {
        jsonMessage ??= JSON.stringify({
          type: "stream:frame",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          payload: { data, width, height, timestamp },
        });
        client.ws.send(jsonMessage);
      }
    }
  }

  /** Broadcast a status update to all connected clients */
  broadcastStatus(
    status: string,
    currentUrl?: string,
    viewport?: { width: number; height: number },
    fileChooserPending?: boolean,
  ): void {
    // A phase change (setup → busy → ready …) obsoletes any in-flight action
    // countdown; keepalives re-broadcast the same status and must not clear it.
    if (status !== this.lastStatus) {
      this.lastActionProgress = null;
    }
    this.lastStatus = status;
    const message = JSON.stringify({
      type: "stream:status",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload: { status, currentUrl, viewport, fileChooserPending },
    });

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      } else {
        this.clients.delete(clientId);
      }
    }
  }

  /** Broadcast the start/end of a deadline-bound action (selector wait,
   *  page-load wait, fallback click). Viewers animate the countdown locally
   *  from `timeoutMs`, so only the start and the clear are sent — no ticks. */
  broadcastActionProgress(payload: ActionProgressPayload): void {
    this.lastActionProgress = payload.active
      ? { payload, startedAt: Date.now() }
      : null;
    const message = JSON.stringify({
      type: "stream:action_progress",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload,
    });

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      } else {
        this.clients.delete(clientId);
      }
    }
  }

  private handleClientMessage(
    clientId: string,
    message: { type: string; payload?: unknown },
  ): void {
    switch (message.type) {
      case "stream:input": {
        const payload = (message as { payload: InputEvent }).payload;
        if (!payload) break;
        this.onInputActivity?.();
        // In inspect mode, only forward mouse moves (for CDP overlay highlighting)
        if (
          this.inspectMode &&
          (payload.type !== "mouse" ||
            (payload as { action?: string }).action !== "move")
        )
          break;
        if (this.inputHandler) {
          const handled = this.inputHandler.handleInput(payload);
          // Once a file upload is applied, tell all viewers the chooser is
          // resolved so their "File upload requested" overlay clears.
          if (payload.type === "file_upload") {
            handled
              .then(() =>
                this.broadcastStatus(
                  this.lastStatus,
                  undefined,
                  undefined,
                  false,
                ),
              )
              .catch(() => {});
          }
        }
        break;
      }

      case "stream:inspect_mode": {
        const modePayload = message.payload as { enabled: boolean } | undefined;
        if (modePayload) {
          this.inspectMode = modePayload.enabled;
          console.log(
            `[StreamServer] Inspect mode: ${this.inspectMode ? "ON" : "OFF"}`,
          );
          this.onInspectModeChange?.(modePayload.enabled);
        }
        break;
      }

      case "stream:inspect_element_request": {
        const payload = message.payload as { x: number; y: number } | undefined;
        if (payload && this.onInspectElement) {
          this.onInspectElement(payload.x, payload.y)
            .then((element) => {
              this.sendToClientById(clientId, {
                type: "stream:inspect_element_response",
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                payload: { element },
              });
            })
            .catch((err) => {
              console.error(`[StreamServer] Inspect element error:`, err);
              this.sendToClientById(clientId, {
                type: "stream:inspect_element_response",
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                payload: { element: null },
              });
            });
        }
        break;
      }

      case "stream:dom_snapshot_request": {
        if (this.onDomSnapshot) {
          this.onDomSnapshot()
            .then((snapshot) => {
              this.sendToClientById(clientId, {
                type: "stream:dom_snapshot_response",
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                payload: snapshot,
              });
            })
            .catch((err) => {
              console.error(`[StreamServer] DOM snapshot error:`, err);
              this.sendToClientById(clientId, {
                type: "stream:dom_snapshot_response",
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                payload: { elements: [], url: "", timestamp: Date.now() },
              });
            });
        }
        break;
      }

      case "stream:session": {
        const payload = message.payload as {
          action: string;
          url?: string;
          viewport?: { width: number; height: number };
        };
        if (payload?.action === "navigate" && payload.url && this.onNavigate) {
          this.onNavigate(payload.url).catch((err) => {
            console.error(`[StreamServer] Navigate error:`, err);
          });
        }
        if (payload?.action === "resize" && payload.viewport) {
          if (this.onResize) {
            this.onResize(payload.viewport).catch((err) => {
              console.error(`[StreamServer] Resize error:`, err);
            });
          }
          if (this.screencast) {
            this.screencast.updateViewport(
              payload.viewport.width,
              payload.viewport.height,
            );
          }
        }
        break;
      }

      default:
        console.warn(
          `[StreamServer] Unknown message type from ${clientId}: ${message.type}`,
        );
    }
  }

  private sendToClient(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendToClientById(clientId: string, message: object): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.sendToClient(client.ws, message);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  async stop(): Promise<void> {
    // Stop ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }

    // Close all clients
    for (const [, client] of this.clients) {
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();

    // Close server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    console.log("[StreamServer] Stopped");
  }
}
