'use server';

import * as queries from '@/lib/db/queries';
import { revalidatePath } from 'next/cache';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';

export async function getPromptLogs(repositoryId?: string | null, limit = 50) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  return queries.getAIPromptLogs(repositoryId, limit);
}

export async function clearPromptLogs(repositoryId?: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  await queries.deleteAllAIPromptLogs(repositoryId);
  revalidatePath('/settings');
  return { success: true };
}
