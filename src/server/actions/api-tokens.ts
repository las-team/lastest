'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireAuth } from '@/lib/auth';

/**
 * API tokens are long-lived `sessions` rows with kind='api'.
 * They authenticate against /api/v1/* via Bearer token, used by:
 *   - The MCP server (`@lastest/mcp-server`)
 *   - The VS Code extension
 *   - Custom scripts / CI integrations
 */

function generateApiToken(): string {
  return `lastest_api_${crypto.randomBytes(32).toString('hex')}`;
}

export async function listApiTokens() {
  const session = await requireAuth();
  return queries.listApiTokensByUser(session.user.id);
}

export async function createApiToken(label: string): Promise<{ id: string; token: string } | { error: string }> {
  const session = await requireAuth();
  const trimmed = label.trim();
  if (!trimmed) return { error: 'Label is required' };

  const token = generateApiToken();
  // 10-year expiry — effectively non-expiring; users revoke explicitly.
  const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

  const { id } = await queries.createApiToken({
    userId: session.user.id,
    label: trimmed,
    token,
    expiresAt,
  });

  revalidatePath('/settings');
  return { id, token };
}

export async function revokeApiToken(id: string): Promise<{ success: true } | { error: string }> {
  const session = await requireAuth();
  await queries.deleteApiToken(id, session.user.id);
  revalidatePath('/settings');
  return { success: true };
}
