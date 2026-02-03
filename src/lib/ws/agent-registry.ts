/**
 * Agent Registry
 *
 * Manages active WebSocket connections for remote agents.
 * Tracks agent status, handles connection lifecycle, and routes commands.
 */

// Use generic WebSocket type to avoid ws dependency in Next.js server components
interface WebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}
import type { Agent, AgentStatus } from '@/lib/db/schema';
import type {
  Message,
  ServerCommand,
  HeartbeatPayload,
  ConnectionEstablishedMessage,
} from './protocol';
import { createMessage } from './protocol';

export interface ConnectedAgent {
  agentId: string;
  teamId: string;
  socket: WebSocket;
  status: AgentStatus;
  capabilities: string[];
  connectedAt: number;
  lastHeartbeat: number;
  currentTask?: string;
}

type MessageHandler = (agentId: string, message: Message) => void;

class AgentRegistry {
  private agents: Map<string, ConnectedAgent> = new Map();
  private agentsByTeam: Map<string, Set<string>> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeatMonitor();
  }

  /**
   * Register a new agent connection.
   */
  registerAgent(
    agentId: string,
    teamId: string,
    socket: WebSocket,
    capabilities: string[] = ['run', 'record']
  ): void {
    const agent: ConnectedAgent = {
      agentId,
      teamId,
      socket,
      status: 'online',
      capabilities,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    this.agents.set(agentId, agent);

    // Track by team
    if (!this.agentsByTeam.has(teamId)) {
      this.agentsByTeam.set(teamId, new Set());
    }
    this.agentsByTeam.get(teamId)!.add(agentId);

    // Setup socket handlers
    socket.on('message', (data: unknown) => {
      try {
        const message = JSON.parse(String(data)) as Message;
        this.handleMessage(agentId, message);
      } catch (err) {
        console.error(`Invalid message from agent ${agentId}:`, err);
      }
    });

    socket.on('close', () => {
      this.unregisterAgent(agentId);
    });

    socket.on('error', (err: unknown) => {
      console.error(`WebSocket error for agent ${agentId}:`, err);
      this.unregisterAgent(agentId);
    });

    // Send connection established message
    const connMsg = createMessage<ConnectionEstablishedMessage>(
      'connection:established',
      { agentId, teamId, capabilities }
    );
    this.sendToAgent(agentId, connMsg);
  }

  /**
   * Unregister an agent connection.
   */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Remove from team tracking
    const teamAgents = this.agentsByTeam.get(agent.teamId);
    if (teamAgents) {
      teamAgents.delete(agentId);
      if (teamAgents.size === 0) {
        this.agentsByTeam.delete(agent.teamId);
      }
    }

    // Close socket if still open
    if (agent.socket.readyState === 1) {
      agent.socket.close();
    }

    this.agents.delete(agentId);
  }

  /**
   * Get agent by ID.
   */
  getAgent(agentId: string): ConnectedAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents for a team.
   */
  getAgentsByTeam(teamId: string): ConnectedAgent[] {
    const agentIds = this.agentsByTeam.get(teamId);
    if (!agentIds) return [];

    return Array.from(agentIds)
      .map((id) => this.agents.get(id))
      .filter((a): a is ConnectedAgent => a !== undefined);
  }

  /**
   * Get an available (online, idle) agent for a team.
   */
  getAvailableAgent(teamId: string, capability: string = 'run'): ConnectedAgent | undefined {
    const agents = this.getAgentsByTeam(teamId);
    return agents.find(
      (a) =>
        a.status === 'online' &&
        a.capabilities.includes(capability)
    );
  }

  /**
   * Send a command to a specific agent.
   */
  sendToAgent(agentId: string, message: Message): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.socket.readyState !== 1) {
      return false;
    }

    agent.socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * Send a command and wait for response.
   */
  async sendCommand(
    agentId: string,
    command: ServerCommand,
    timeout: number = 30000
  ): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageHandlers.delete(handler);
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      const handler: MessageHandler = (respAgentId, message) => {
        if (respAgentId !== agentId) return;
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

      if (!this.sendToAgent(agentId, command)) {
        clearTimeout(timer);
        this.messageHandlers.delete(handler);
        reject(new Error('Failed to send command to agent'));
      }
    });
  }

  /**
   * Update agent status from heartbeat.
   */
  updateAgentStatus(agentId: string, heartbeat: HeartbeatPayload): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Map heartbeat status to agent status
    if (heartbeat.status === 'idle') {
      agent.status = 'online';
    } else if (heartbeat.status === 'busy') {
      agent.status = 'busy';
    } else {
      // recording maps to busy
      agent.status = 'busy';
    }
    agent.lastHeartbeat = Date.now();
    agent.currentTask = heartbeat.currentTask;
  }

  /**
   * Handle incoming message from agent.
   */
  private handleMessage(agentId: string, message: Message): void {
    // Update heartbeat timestamp
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = Date.now();
    }

    // Handle heartbeat messages
    if (message.type === 'status:heartbeat') {
      this.updateAgentStatus(agentId, message.payload as HeartbeatPayload);
    }

    // Notify all handlers
    for (const handler of this.messageHandlers) {
      handler(agentId, message);
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

      for (const [agentId, agent] of this.agents) {
        if (agent.lastHeartbeat < staleThreshold) {
          console.log(`Agent ${agentId} heartbeat stale, disconnecting`);
          this.unregisterAgent(agentId);
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
   * Get all connected agents (for admin/debugging).
   */
  getAllAgents(): ConnectedAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Check if any agent is connected for a team.
   */
  hasConnectedAgent(teamId: string): boolean {
    return (this.agentsByTeam.get(teamId)?.size ?? 0) > 0;
  }
}

// Singleton instance
export const agentRegistry = new AgentRegistry();
