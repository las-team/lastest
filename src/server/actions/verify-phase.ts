'use server';

import { revalidatePath } from 'next/cache';
import * as queries from '@/lib/db/queries';
import { requireTeamAdmin } from '@/lib/auth';

export async function toggleVerifyPhase(enabled: boolean) {
  const session = await requireTeamAdmin();
  await queries.updateTeam(session.team.id, { verifyPhaseEnabled: enabled });
  revalidatePath('/settings');
  revalidatePath('/verify');
  revalidatePath('/run');
  revalidatePath('/review');
  return { enabled };
}
