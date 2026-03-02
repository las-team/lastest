/**
 * Stream Server
 *
 * WebSocket server that streams CDP screencast frames to connected clients
 * and forwards input events back to the browser.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { ScreencastManager } from './screencast.js';
import type { InputHandler, InputEvent } from './input-handler.js';

export interface StreamServerOptions {
  port: number;
  authToken?: string; // Optional token for authenticating stream clients
}

interface StreamClient {
  ws: WebSocket;
  id: string;
  connectedAt: number;
}

export class StreamServer {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, StreamClient>();
  private screencast: ScreencastManager | null = null;
  private inputHandler: InputHandler | null = null;
  private authToken?: string;

  /** Callback for navigate requests from stream clients */
  onNavigate?: (url: string) => Promise<void>;
  /** Callback for viewport resize requests from stream clients */
  onResize?: (viewport: { width: number; height: number }) => Promise<void>;

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
        const url = new URL(info.req.url ?? '', `http://localhost:${this.options.port}`);
        const token = url.searchParams.get('token') ?? info.req.headers['x-stream-token'];

        if (token === this.authToken) {
          callback(true);
        } else {
          callback(false, 401, 'Unauthorized');
        }
      },
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const clientId = crypto.randomUUID();
      const client: StreamClient = { ws, id: clientId, connectedAt: Date.now() };
      this.clients.set(clientId, client);

      console.log(`[StreamServer] Client connected: ${clientId} (total: ${this.clients.size})`);

      // Send current status
      this.sendToClient(ws, {
        type: 'stream:status',
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: {
          status: 'connected',
        },
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(clientId, message);
        } catch (error) {
          console.error(`[StreamServer] Invalid message from ${clientId}:`, error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[StreamServer] Client disconnected: ${clientId} (total: ${this.clients.size})`);
      });

      ws.on('error', (error) => {
        console.error(`[StreamServer] Client error (${clientId}):`, error);
        this.clients.delete(clientId);
      });
    });

    console.log(`[StreamServer] Listening on port ${this.options.port}`);
  }

  setScreencast(screencast: ScreencastManager): void {
    this.screencast = screencast;
  }

  setInputHandler(inputHandler: InputHandler): void {
    this.inputHandler = inputHandler;
  }

  /** Broadcast a frame to all connected clients */
  broadcastFrame(data: string, width: number, height: number, timestamp: number): void {
    const message = JSON.stringify({
      type: 'stream:frame',
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload: { data, width, height, timestamp },
    });

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      } else {
        this.clients.delete(clientId);
      }
    }
  }

  /** Broadcast a status update to all connected clients */
  broadcastStatus(status: string, currentUrl?: string, viewport?: { width: number; height: number }): void {
    const message = JSON.stringify({
      type: 'stream:status',
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      payload: { status, currentUrl, viewport },
    });

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      } else {
        this.clients.delete(clientId);
      }
    }
  }

  private handleClientMessage(clientId: string, message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case 'stream:input': {
        const payload = (message as { payload: InputEvent }).payload;
        if (this.inputHandler && payload) {
          this.inputHandler.handleInput(payload);
        }
        break;
      }

      case 'stream:session': {
        const payload = message.payload as { action: string; url?: string; viewport?: { width: number; height: number } };
        if (payload?.action === 'navigate' && payload.url && this.onNavigate) {
          this.onNavigate(payload.url).catch(err => {
            console.error(`[StreamServer] Navigate error:`, err);
          });
        }
        if (payload?.action === 'resize' && payload.viewport) {
          if (this.onResize) {
            this.onResize(payload.viewport).catch(err => {
              console.error(`[StreamServer] Resize error:`, err);
            });
          }
          if (this.screencast) {
            this.screencast.updateViewport(payload.viewport.width, payload.viewport.height);
          }
        }
        break;
      }

      default:
        console.warn(`[StreamServer] Unknown message type from ${clientId}: ${message.type}`);
    }
  }

  private sendToClient(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  async stop(): Promise<void> {
    // Close all clients
    for (const [, client] of this.clients) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    // Close server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    console.log('[StreamServer] Stopped');
  }
}
