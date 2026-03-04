/**
 * Embedded Runner Client
 *
 * Extends the standard runner polling client pattern to also manage
 * the embedded browser session lifecycle. Registers with the main app
 * on startup and maintains heartbeat + streaming.
 */

import os from 'os';

// Re-define minimal protocol types to avoid cross-package imports
interface BaseMessage {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
}

interface HeartbeatPayload {
  status: 'idle' | 'busy' | 'recording';
  currentTask?: string;
  systemInfo: {
    platform: string;
    memory: { used: number; total: number };
    uptime: number;
  };
  disconnect?: boolean;
}

interface ConnectResponse {
  runnerId: string;
  teamId: string;
  capabilities?: string[];
  commands?: BaseMessage[];
  sessionId: string;
}

interface HeartbeatResponse {
  commands?: BaseMessage[];
}

interface RegisterResponse {
  sessionId: string;
  runnerId: string;
}

export interface EmbeddedRunnerOptions {
  serverUrl: string;
  token: string;
  streamPort: number;
  streamHost?: string;
  pollInterval?: number;
  /** System EB shared token — if set, uses /api/embedded/auto-register instead */
  systemToken?: string;
  /** Container instance ID (os.hostname()) for system registration */
  instanceId?: string;
}

export class EmbeddedRunnerClient {
  private serverUrl: string;
  private token: string;
  private streamPort: number;
  private streamHost: string;
  private pollInterval: number;
  private running = false;
  private sessionId?: string;
  private runnerId?: string;
  private embeddedSessionId?: string;
  private status: 'idle' | 'busy' = 'idle';
  private currentTask?: string;
  private wakeHeartbeat: (() => void) | null = null;
  private systemToken?: string;
  private instanceId?: string;

  /** Called when the main app sends a command (test/recording) */
  onCommand?: (command: BaseMessage) => Promise<void>;

  constructor(options: EmbeddedRunnerOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, '');
    this.token = options.token;
    this.streamPort = options.streamPort;
    this.streamHost = options.streamHost || '';
    this.pollInterval = options.pollInterval ?? 1000;
    this.systemToken = options.systemToken;
    this.instanceId = options.instanceId;
  }

  /**
   * Register this embedded browser with the main app.
   * Creates both a runner record and an embedded session record.
   */
  async register(): Promise<boolean> {
    try {
      const hostname = this.streamHost || os.hostname();
      const streamUrl = `ws://${hostname}:${this.streamPort}`;
      const containerUrl = `http://${hostname}:${this.streamPort}`;

      const response = await fetch(`${this.serverUrl}/api/embedded/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          streamUrl,
          containerUrl,
          viewport: { width: 1280, height: 720 },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[EmbeddedRunner] Registration failed: ${response.status} ${text}`);
        return false;
      }

      const data = (await response.json()) as RegisterResponse;
      this.embeddedSessionId = data.sessionId;
      this.runnerId = data.runnerId;

      console.log(`[EmbeddedRunner] Registered: session=${data.sessionId}, runner=${data.runnerId}`);
      return true;
    } catch (error) {
      console.error('[EmbeddedRunner] Registration error:', error);
      return false;
    }
  }

  /**
   * Connect to the runner polling endpoint (same as standard runner).
   */
  async connect(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/api/ws/runner`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[EmbeddedRunner] Connect failed: ${response.status} ${text}`);
        return false;
      }

      const data = (await response.json()) as ConnectResponse;
      this.sessionId = data.sessionId;
      this.runnerId = data.runnerId;

      console.log(`[EmbeddedRunner] Connected: runner=${data.runnerId}, session=${data.sessionId}`);

      // Process any pending commands
      if (data.commands && data.commands.length > 0) {
        for (const cmd of data.commands) {
          this.onCommand?.(cmd);
        }
      }

      return true;
    } catch (error) {
      console.error('[EmbeddedRunner] Connect error:', error);
      return false;
    }
  }

  /**
   * Register as a system EB via shared SYSTEM_EB_TOKEN.
   * The server creates/updates a system runner and returns a per-runner token.
   */
  async registerAsSystem(): Promise<boolean> {
    try {
      const hostname = this.streamHost || os.hostname();
      const streamUrl = `ws://${hostname}:${this.streamPort}`;
      const containerUrl = `http://${hostname}:${this.streamPort}`;

      const response = await fetch(`${this.serverUrl}/api/embedded/auto-register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.systemToken}`,
        },
        body: JSON.stringify({
          streamUrl,
          containerUrl,
          viewport: { width: 1280, height: 720 },
          instanceId: this.instanceId || os.hostname(),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`[EmbeddedRunner] System registration failed: ${response.status} ${text}`);
        return false;
      }

      const data = (await response.json()) as { runnerId: string; token: string; sessionId: string };
      this.runnerId = data.runnerId;
      this.embeddedSessionId = data.sessionId;
      // Replace token with the per-runner token for heartbeats
      this.token = data.token;

      console.log(`[EmbeddedRunner] System registered: runner=${data.runnerId}, session=${data.sessionId}`);
      return true;
    } catch (error) {
      console.error('[EmbeddedRunner] System registration error:', error);
      return false;
    }
  }

  async start(): Promise<void> {
    this.running = true;

    if (this.systemToken) {
      // System EB mode: auto-register via shared token
      const registered = await this.registerAsSystem();
      if (!registered) {
        throw new Error('Failed to register as system embedded browser');
      }
    } else {
      // Standard mode: register via per-runner LASTEST2_TOKEN
      const registered = await this.register();
      if (!registered) {
        throw new Error('Failed to register embedded browser');
      }
    }

    // Then connect as a runner
    const connected = await this.connect();
    if (!connected) {
      throw new Error('Failed to connect to runner endpoint');
    }

    // Start heartbeat loop
    this.heartbeatLoop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this.wakeHeartbeat?.();

    // Send disconnect heartbeat
    try {
      await this.sendHeartbeat(true);
    } catch {
      // Ignore
    }

    console.log('[EmbeddedRunner] Stopped');
  }

  setStatus(status: 'idle' | 'busy', task?: string): void {
    this.status = status;
    this.currentTask = task;
  }

  private async heartbeatLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.sendHeartbeat(false);
      } catch (error) {
        console.error('[EmbeddedRunner] Heartbeat error:', error);
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.pollInterval);
        this.wakeHeartbeat = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wakeHeartbeat = null;
    }
  }

  private async sendHeartbeat(disconnect: boolean): Promise<void> {
    const heartbeat: BaseMessage = {
      id: crypto.randomUUID(),
      type: 'status:heartbeat',
      timestamp: Date.now(),
      payload: {
        status: this.status,
        currentTask: this.currentTask,
        systemInfo: this.getSystemInfo(),
        disconnect,
      } satisfies HeartbeatPayload,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };

    if (this.sessionId) {
      headers['X-Session-ID'] = this.sessionId;
    }

    const response = await fetch(`${this.serverUrl}/api/ws/runner`, {
      method: 'POST',
      headers,
      body: JSON.stringify(heartbeat),
    });

    if (response.ok) {
      const data = (await response.json()) as HeartbeatResponse;
      if (data.commands && data.commands.length > 0) {
        for (const cmd of data.commands) {
          this.onCommand?.(cmd);
        }
      }
    }
  }

  async sendMessage(message: BaseMessage): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      };

      if (this.sessionId) {
        headers['X-Session-ID'] = this.sessionId;
      }

      const response = await fetch(`${this.serverUrl}/api/ws/runner`, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });

      return response.ok;
    } catch (error) {
      console.error('[EmbeddedRunner] Send error:', error);
      return false;
    }
  }

  private getSystemInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
      platform: `${os.platform()} ${os.release()}`,
      memory: { used: totalMem - freeMem, total: totalMem },
      uptime: os.uptime(),
    };
  }
}
