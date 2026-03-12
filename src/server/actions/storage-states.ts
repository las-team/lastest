'use server';

import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { getStorageStates, getStorageState, createStorageState, deleteStorageState } from '@/lib/db/queries';
import { revalidatePath } from 'next/cache';

export async function listStorageStates(repositoryId: string | null) {
  await requireTeamAccess();
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
  await requireTeamAccess();
  await deleteStorageState(id);
  revalidatePath('/settings');
}

export async function getStorageStateJson(id: string) {
  await requireTeamAccess();
  const state = await getStorageState(id);
  return state?.storageStateJson ?? null;
}
