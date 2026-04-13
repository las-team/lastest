'use server';

import { requireTeamAccess } from '@/lib/auth';
import { getTeamStorageUsage } from '@/lib/db/queries/storage';
import { recalculateTeamStorage } from '@/lib/storage/calculator';
import { cleanupTeamStorage } from '@/lib/storage/cleanup';
import { createBackgroundJob, updateBackgroundJob } from '@/lib/db/queries/background-jobs';
import { revalidatePath } from 'next/cache';

export async function getStorageUsageAction() {
  const session = await requireTeamAccess();
  return getTeamStorageUsage(session.team.id);
}

export async function recalculateStorageAction() {
  const session = await requireTeamAccess();
  const result = await recalculateTeamStorage(session.team.id, true);
  revalidatePath('/settings');
  return result;
}

export async function triggerStorageCleanupAction() {
  const session = await requireTeamAccess();

  if (session.user.role !== 'owner' && session.user.role !== 'admin') {
    throw new Error('Only admins can trigger storage cleanup');
  }

  const teamId = session.team.id;

  const { id: jobId } = await createBackgroundJob({
    type: 'storage_cleanup',
    label: 'Storage cleanup',
  });

  // Run cleanup asynchronously
  (async () => {
    try {
      await updateBackgroundJob(jobId, { status: 'running', startedAt: new Date() });
      const result = await cleanupTeamStorage(teamId);
      await updateBackgroundJob(jobId, {
        status: 'completed',
        completedAt: new Date(),
        metadata: { deletedRuns: result.deletedRuns, freedBytes: result.freedBytes },
      });
    } catch (err) {
      await updateBackgroundJob(jobId, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        completedAt: new Date(),
      });
    }
  })();

  revalidatePath('/settings');
  return { jobId };
}
