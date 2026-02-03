'use server';

import { db } from '@/lib/db';
import { agents, type Agent, type AgentCapability } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { requireTeamAdmin, requireTeamAccess } from '@/lib/auth';

/**
 * Hash an agent token using SHA256
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a secure agent token
 * Format: lastest_agent_<random>
 */
function generateAgentToken(): string {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `lastest_agent_${randomBytes}`;
}

/**
 * Get all agents for the current team
 */
export async function getAgents(): Promise<Agent[]> {
  const session = await requireTeamAccess();
  return db
    .select()
    .from(agents)
    .where(eq(agents.teamId, session.team.id))
    .orderBy(desc(agents.createdAt))
    .all();
}

/**
 * Get a specific agent by ID (team-scoped)
 */
export async function getAgent(agentId: string): Promise<Agent | null> {
  const session = await requireTeamAccess();
  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, session.team.id)))
    .get();
  return agent ?? null;
}

/**
 * Create a new agent (admin only)
 * Returns the agent AND the plain token (only shown once)
 */
export async function createAgent(name: string, capabilities: AgentCapability[] = ['run', 'record']): Promise<{
  agent: Agent;
  token: string;
} | { error: string }> {
  const session = await requireTeamAdmin();

  const id = uuid();
  const token = generateAgentToken();
  const tokenHash = hashToken(token);
  const now = new Date();

  await db.insert(agents).values({
    id,
    teamId: session.team.id,
    createdById: session.user.id,
    name,
    tokenHash,
    status: 'offline',
    capabilities,
    createdAt: now,
  });

  const agent = await db.select().from(agents).where(eq(agents.id, id)).get();
  if (!agent) {
    return { error: 'Failed to create agent' };
  }

  return { agent, token };
}

/**
 * Update agent name (admin only)
 */
export async function updateAgentName(agentId: string, name: string): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, session.team.id)))
    .get();

  if (!agent) {
    return { error: 'Agent not found' };
  }

  await db.update(agents).set({ name }).where(eq(agents.id, agentId));
  return { success: true };
}

/**
 * Regenerate agent token (admin only)
 * Returns the new plain token (only shown once)
 */
export async function regenerateAgentToken(agentId: string): Promise<{ token: string } | { error: string }> {
  const session = await requireTeamAdmin();

  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, session.team.id)))
    .get();

  if (!agent) {
    return { error: 'Agent not found' };
  }

  const token = generateAgentToken();
  const tokenHash = hashToken(token);

  await db.update(agents).set({ tokenHash }).where(eq(agents.id, agentId));
  return { token };
}

/**
 * Delete an agent (admin only)
 */
export async function deleteAgent(agentId: string): Promise<{ success: boolean } | { error: string }> {
  const session = await requireTeamAdmin();

  const agent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.teamId, session.team.id)))
    .get();

  if (!agent) {
    return { error: 'Agent not found' };
  }

  await db.delete(agents).where(eq(agents.id, agentId));
  return { success: true };
}

/**
 * Update agent status (internal use - called by WebSocket handler)
 */
export async function updateAgentStatus(
  agentId: string,
  status: 'online' | 'offline' | 'busy',
  lastSeen?: Date
): Promise<void> {
  await db
    .update(agents)
    .set({
      status,
      lastSeen: lastSeen ?? new Date(),
    })
    .where(eq(agents.id, agentId));
}

/**
 * Validate agent token and return agent info
 * Used by WebSocket connection handler
 */
export async function validateAgentToken(token: string): Promise<Agent | null> {
  const tokenHash = hashToken(token);
  const agent = await db
    .select()
    .from(agents)
    .where(eq(agents.tokenHash, tokenHash))
    .get();
  return agent ?? null;
}

/**
 * Get online agents for a team (for UI status display)
 */
export async function getOnlineAgents(): Promise<Agent[]> {
  const session = await requireTeamAccess();
  return db
    .select()
    .from(agents)
    .where(and(eq(agents.teamId, session.team.id), eq(agents.status, 'online')))
    .all();
}

/**
 * Check if team has any connected agents
 */
export async function hasConnectedAgents(): Promise<boolean> {
  const session = await requireTeamAccess();
  const onlineAgent = await db
    .select()
    .from(agents)
    .where(and(eq(agents.teamId, session.team.id), eq(agents.status, 'online')))
    .limit(1)
    .get();
  return !!onlineAgent;
}

/**
 * Get online agents filtered by capability (for UI selection)
 */
export async function getOnlineAgentsWithCapability(capability?: AgentCapability): Promise<Agent[]> {
  const session = await requireTeamAccess();
  const onlineAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.teamId, session.team.id), eq(agents.status, 'online')))
    .all();

  // Filter by capability if specified
  if (capability) {
    return onlineAgents.filter((agent) => {
      const caps = agent.capabilities || ['run', 'record'];
      return caps.includes(capability);
    });
  }

  return onlineAgents;
}
