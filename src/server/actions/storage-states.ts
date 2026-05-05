'use server';

import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { requireStorageStateOwnership } from '@/lib/auth/ownership';
import { getStorageStates, getStorageState, createStorageState, deleteStorageState } from '@/lib/db/queries';
import { revalidatePath } from 'next/cache';

export async function listStorageStates(repositoryId: string | null) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();
  return getStorageStates(repositoryId);
}

export async function saveStorageState(repositoryId: string | null, name: string, json: string) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();

  // Validate JSON
  try {
    JSON.parse(json);
  } catch {
    throw new Error('Invalid storage state JSON');
  }

  const result = await createStorageState({ repositoryId, name, storageStateJson: json });
  revalidatePath('/settings');
  return result;
}

export async function removeStorageState(id: string) {
  const state = await getStorageState(id);
  if (!state) throw new Error('Storage state not found');
  if (state.repositoryId) await requireRepoAccess(state.repositoryId);
  else await requireTeamAccess();
  await deleteStorageState(id);
  revalidatePath('/settings');
}

export async function getStorageStateJson(id: string) {
  const { state } = await requireStorageStateOwnership(id);
  return state?.storageStateJson ?? null;
}
