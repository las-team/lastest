'use server';

import { revalidatePath } from 'next/cache';
import { createTest, getEnvironmentConfig, upsertEnvironmentConfig } from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { startPlayAgent } from '@/server/actions/play-agent';

export async function createTestFromCode(data: {
  repositoryId: string;
  name: string;
  code: string;
  functionalAreaId?: string | null;
  targetUrl?: string | null;
  viewportWidth?: number;
  viewportHeight?: number;
}): Promise<{ success: boolean; testId?: string; error?: string }> {
  try {
    const { user } = await requireRepoAccess(data.repositoryId);

    if (!data.name.trim()) return { success: false, error: 'Test name is required' };
    if (!data.code.trim()) return { success: false, error: 'Test code is required' };

    const test = await createTest(
      {
        name: data.name.trim(),
        code: data.code,
        repositoryId: data.repositoryId,
        functionalAreaId: data.functionalAreaId || null,
        targetUrl: data.targetUrl || null,
        createdByUserId: user.id,
      },
      null,
      data.viewportWidth
        ? { width: data.viewportWidth, height: data.viewportHeight }
        : null,
    );

    revalidatePath('/tests');
    revalidatePath('/record');

    return { success: true, testId: test.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import test';
    return { success: false, error: message };
  }
}

export async function startAutoExploreFromUrl(data: {
  repositoryId: string;
  baseUrl: string;
}): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    await requireRepoAccess(data.repositoryId);

    const trimmed = data.baseUrl.trim();
    if (!trimmed) return { success: false, error: 'Target URL is required' };

    let origin: string;
    try {
      origin = new URL(trimmed).origin;
    } catch {
      return { success: false, error: 'Invalid URL' };
    }

    const current = await getEnvironmentConfig(data.repositoryId);
    if (current.baseUrl !== origin) {
      await upsertEnvironmentConfig(data.repositoryId, { baseUrl: origin });
    }

    const { sessionId } = await startPlayAgent(data.repositoryId);
    return { success: true, sessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start auto-explore';
    return { success: false, error: message };
  }
}
