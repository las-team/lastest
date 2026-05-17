import * as vscode from 'vscode';
import type { WSMessage, TestProgressPayload, TestCompletePayload } from './types';
import { getOutputChannel } from './output';

/**
 * SSE-based real-time updates for the VSCode extension.
 * Uses Server-Sent Events since Next.js App Router doesn't support WebSocket.
 *
 * The server enforces a 90s lifetime cap and sends `event: reconnect` before
 * closing the stream (see src/app/api/v1/events/route.ts). The client must
 * treat both clean stream-end and errors as triggers to reconnect.
 */
export class LastestWebSocket {
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectInterval = 5000;
  private abortController: AbortController | null = null;
  private intentionalClose = false;
  private serverRequestedReconnect = false;

  private readonly onTestStartEmitter = new vscode.EventEmitter<{ testId: number; runId: number }>();
  private readonly onTestProgressEmitter = new vscode.EventEmitter<TestProgressPayload>();
  private readonly onTestCompleteEmitter = new vscode.EventEmitter<TestCompletePayload>();
  private readonly onConnectionChangeEmitter = new vscode.EventEmitter<boolean>();

  readonly onTestStart = this.onTestStartEmitter.event;
  readonly onTestProgress = this.onTestProgressEmitter.event;
  readonly onTestComplete = this.onTestCompleteEmitter.event;
  readonly onConnectionChange = this.onConnectionChangeEmitter.event;

  private serverUrl: string = '';
  private apiToken: string = '';
  private currentEvent: string = '';

  connect(serverUrl: string, apiToken?: string) {
    this.serverUrl = serverUrl;
    this.apiToken = apiToken || '';
    this.intentionalClose = false;
    this.doConnect();
  }

  private log(line: string) {
    getOutputChannel().appendLine(`[connect] ${line}`);
  }

  private async doConnect() {
    this.closeConnection();
    this.intentionalClose = false;
    this.serverRequestedReconnect = false;

    const sseUrl = `${this.serverUrl}/api/v1/events`;
    this.abortController = new AbortController();
    this.log(`dialing ${sseUrl}`);

    let streamEndedCleanly = false;

    try {
      const headers: Record<string, string> = {
        'Accept': 'text/event-stream',
      };

      if (this.apiToken) {
        headers['Authorization'] = `Bearer ${this.apiToken}`;
      }

      const response = await fetch(sseUrl, {
        headers,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('empty response body');
      }

      console.log('Lastest SSE connected');
      this.log('connected');
      this.onConnectionChangeEmitter.fire(true);

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          streamEndedCleanly = true;
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          this.parseSseLine(line);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError' || this.intentionalClose) {
        return;
      }
      const msg = (err as Error).message || String(err);
      console.error('Lastest SSE error:', err);
      this.log(`disconnected: ${msg}`);
      this.onConnectionChangeEmitter.fire(false);
      this.scheduleReconnect();
      return;
    }

    if (streamEndedCleanly && !this.intentionalClose) {
      if (this.serverRequestedReconnect) {
        // Planned 90s lifetime-cap recycle — re-dial without flipping the
        // status bar to "Disconnected". Otherwise users see the indicator
        // flicker every 90s during normal operation.
        this.log('reconnecting (planned)');
        this.doConnect();
        return;
      }
      this.log('stream closed by server');
      this.onConnectionChangeEmitter.fire(false);
      this.scheduleReconnect();
    }
  }

  private parseSseLine(line: string) {
    if (line === '') {
      this.currentEvent = '';
      return;
    }
    if (line.startsWith(':')) {
      // comment / keepalive — ignore
      return;
    }
    if (line.startsWith('event: ')) {
      this.currentEvent = line.slice(7).trim();
      return;
    }
    if (line.startsWith('data: ')) {
      const raw = line.slice(6);
      if (this.currentEvent === 'reconnect') {
        let reason = 'server-initiated';
        try {
          const parsed = JSON.parse(raw) as { reason?: string };
          if (parsed?.reason) reason = parsed.reason;
        } catch {
          // keep default reason
        }
        this.serverRequestedReconnect = true;
        this.log(`server requested reconnect (${reason})`);
        return;
      }
      try {
        const data = JSON.parse(raw);
        this.handleMessage(data as WSMessage);
      } catch {
        // ignore parse errors
      }
    }
  }

  private closeConnection() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private scheduleReconnect() {
    if (!this.reconnectTimer && this.serverUrl) {
      this.log(`retrying in ${Math.round(this.reconnectInterval / 1000)}s`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.doConnect();
      }, this.reconnectInterval);
    }
  }

  private handleMessage(message: WSMessage) {
    switch (message.type) {
      case 'test:start':
        this.onTestStartEmitter.fire(message.payload as { testId: number; runId: number });
        break;
      case 'test:progress':
        this.onTestProgressEmitter.fire(message.payload as TestProgressPayload);
        break;
      case 'test:complete':
        this.onTestCompleteEmitter.fire(message.payload as TestCompletePayload);
        break;
      case 'connected':
        console.log('Lastest SSE handshake complete');
        break;
    }
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeConnection();
    this.onConnectionChangeEmitter.fire(false);
  }

  dispose() {
    this.disconnect();
    this.onTestStartEmitter.dispose();
    this.onTestProgressEmitter.dispose();
    this.onTestCompleteEmitter.dispose();
    this.onConnectionChangeEmitter.dispose();
  }
}
