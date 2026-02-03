/**
 * Runner Registry
 *
 * Manages active WebSocket connections for remote runners.
 * Tracks runner status, handles connection lifecycle, and routes commands.
 */

// Use generic WebSocket type to avoid ws dependency in Next.js server components
interface WebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}
import type { Runner, RunnerStatus } from '@/lib/db/schema';
import type {
  Message,
  ServerCommand,
  HeartbeatPayload,
  ConnectionEstablishedMessage,
} from './protocol';
import { createMessage } from './protocol';

export interface ConnectedRunner {
  runnerId: string;
  teamId: string;
  socket: WebSocket;
  status: RunnerStatus;
  capabilities: string[];
  connectedAt: number;
  lastHeartbeat: number;
  currentTask?: string;
}

type MessageHandler = (runnerId: string, message: Message) => void;

class RunnerRegistry {
  private runners: Map<string, ConnectedRunner> = new Map();
  private runnersByTeam: Map<string, Set<string>> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeatMonitor();
  }

  /**
   * Register a new runner connection.
   */
  registerRunner(
    runnerId: string,
    teamId: string,
    socket: WebSocket,
    capabilities: string[] = ['run', 'record']
  ): void {
    const runner: ConnectedRunner = {
      runnerId,
      teamId,
      socket,
      status: 'online',
      capabilities,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    this.runners.set(runnerId, runner);

    // Track by team
    if (!this.runnersByTeam.has(teamId)) {
      this.runnersByTeam.set(teamId, new Set());
    }
    this.runnersByTeam.get(teamId)!.add(runnerId);

    // Setup socket handlers
    socket.on('message', (data: unknown) => {
      try {
        const message = JSON.parse(String(data)) as Message;
        this.handleMessage(runnerId, message);
      } catch (err) {
        console.error(`Invalid message from runner ${runnerId}:`, err);
      }
    });

    socket.on('close', () => {
      this.unregisterRunner(runnerId);
    });

    socket.on('error', (err: unknown) => {
      console.error(`WebSocket error for runner ${runnerId}:`, err);
      this.unregisterRunner(runnerId);
    });

    // Send connection established message
    const connMsg = createMessage<ConnectionEstablishedMessage>(
      'connection:established',
      { runnerId, teamId, capabilities, agentId: runnerId }
    );
    this.sendToRunner(runnerId, connMsg);
  }

  /**
   * Unregister a runner connection.
   */
  unregisterRunner(runnerId: string): void {
    const runner = this.runners.get(runnerId);
    if (!runner) return;

    // Remove from team tracking
    const teamRunners = this.runnersByTeam.get(runner.teamId);
    if (teamRunners) {
      teamRunners.delete(runnerId);
      if (teamRunners.size === 0) {
        this.runnersByTeam.delete(runner.teamId);
      }
    }

    // Close socket if still open
    if (runner.socket.readyState === 1) {
      runner.socket.close();
    }

    this.runners.delete(runnerId);
  }

  /**
   * Get runner by ID.
   */
  getRunner(runnerId: string): ConnectedRunner | undefined {
    return this.runners.get(runnerId);
  }

  /**
   * Get all runners for a team.
   */
  getRunnersByTeam(teamId: string): ConnectedRunner[] {
    const runnerIds = this.runnersByTeam.get(teamId);
    if (!runnerIds) return [];

    return Array.from(runnerIds)
      .map((id) => this.runners.get(id))
      .filter((r): r is ConnectedRunner => r !== undefined);
  }

  /**
   * Get an available (online, idle) runner for a team.
   */
  getAvailableRunner(teamId: string, capability: string = 'run'): ConnectedRunner | undefined {
    const runners = this.getRunnersByTeam(teamId);
    return runners.find(
      (r) =>
        r.status === 'online' &&
        r.capabilities.includes(capability)
    );
  }

  /**
   * Send a command to a specific runner.
   */
  sendToRunner(runnerId: string, message: Message): boolean {
    const runner = this.runners.get(runnerId);
    if (!runner || runner.socket.readyState !== 1) {
      return false;
    }

    runner.socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * Send a command and wait for response.
   */
  async sendCommand(
    runnerId: string,
    command: ServerCommand,
    timeout: number = 30000
  ): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageHandlers.delete(handler);
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      const handler: MessageHandler = (respRunnerId, message) => {
        if (respRunnerId !== runnerId) return;
        if (
          'payload' in message &&
          typeof message.payload === 'object' &&
          message.payload !== null &&
          'correlationId' in message.payload &&
          message.payload.correlationId === command.id
        ) {
          clearTimeout(timer);
          this.messageHandlers.delete(handler);
          resolve(message);
        }
      };

      this.messageHandlers.add(handler);

      if (!this.sendToRunner(runnerId, command)) {
        clearTimeout(timer);
        this.messageHandlers.delete(handler);
        reject(new Error('Failed to send command to runner'));
      }
    });
  }

  /**
   * Update runner status from heartbeat.
   */
  updateRunnerStatus(runnerId: string, heartbeat: HeartbeatPayload): void {
    const runner = this.runners.get(runnerId);
    if (!runner) return;

    // Map heartbeat status to runner status
    if (heartbeat.status === 'idle') {
      runner.status = 'online';
    } else if (heartbeat.status === 'busy') {
      runner.status = 'busy';
    } else {
      // recording maps to busy
      runner.status = 'busy';
    }
    runner.lastHeartbeat = Date.now();
    runner.currentTask = heartbeat.currentTask;
  }

  /**
   * Handle incoming message from runner.
   */
  private handleMessage(runnerId: string, message: Message): void {
    // Update heartbeat timestamp
    const runner = this.runners.get(runnerId);
    if (runner) {
      runner.lastHeartbeat = Date.now();
    }

    // Handle heartbeat messages
    if (message.type === 'status:heartbeat') {
      this.updateRunnerStatus(runnerId, message.payload as HeartbeatPayload);
    }

    // Notify all handlers
    for (const handler of this.messageHandlers) {
      handler(runnerId, message);
    }
  }

  /**
   * Add a message handler.
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Start heartbeat monitoring to detect stale connections.
   */
  private startHeartbeatMonitor(): void {
    // Check every 60 seconds for stale connections
    this.heartbeatInterval = setInterval(() => {
      const staleThreshold = Date.now() - 90000; // 90 seconds

      for (const [runnerId, runner] of this.runners) {
        if (runner.lastHeartbeat < staleThreshold) {
          console.log(`Runner ${runnerId} heartbeat stale, disconnecting`);
          this.unregisterRunner(runnerId);
        }
      }
    }, 60000);
  }

  /**
   * Stop heartbeat monitoring.
   */
  stopHeartbeatMonitor(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get all connected runners (for admin/debugging).
   */
  getAllRunners(): ConnectedRunner[] {
    return Array.from(this.runners.values());
  }

  /**
   * Check if any runner is connected for a team.
   */
  hasConnectedRunner(teamId: string): boolean {
    return (this.runnersByTeam.get(teamId)?.size ?? 0) > 0;
  }
}

// Singleton instance
export const runnerRegistry = new RunnerRegistry();
