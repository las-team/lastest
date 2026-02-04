import * as vscode from 'vscode';
import type { WSMessage, TestProgressPayload, TestCompletePayload } from './types';

/**
 * SSE-based real-time updates for the VSCode extension.
 * Uses Server-Sent Events since Next.js App Router doesn't support WebSocket.
 */
export class Lastest2WebSocket {
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectInterval = 5000;
  private abortController: AbortController | null = null;

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

  connect(serverUrl: string, apiToken?: string) {
    this.serverUrl = serverUrl;
    this.apiToken = apiToken || '';
    this.doConnect();
  }

  private async doConnect() {
    // Close existing connection
    this.closeConnection();

    const sseUrl = `${this.serverUrl}/api/v1/events`;
    this.abortController = new AbortController();

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
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      console.log('Lastest2 SSE connected');
      this.onConnectionChangeEmitter.fire(true);

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Read the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              this.handleMessage(data as WSMessage);
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return; // Intentional disconnect
      }
      console.error('Lastest2 SSE error:', e);
      this.onConnectionChangeEmitter.fire(false);
      this.scheduleReconnect();
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
        console.log('Lastest2 SSE handshake complete');
        break;
    }
  }

  disconnect() {
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
