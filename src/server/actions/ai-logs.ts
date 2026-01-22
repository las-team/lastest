'use server';

import * as queries from '@/lib/db/queries';
import { revalidatePath } from 'next/cache';

export async function getPromptLogs(repositoryId?: string | null, limit = 50) {
  return queries.getAIPromptLogs(repositoryId, limit);
}

export async function clearPromptLogs(repositoryId?: string | null) {
  await queries.deleteAllAIPromptLogs(repositoryId);
  revalidatePath('/settings');
  return { success: true };
}
