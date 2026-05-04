'use server';

import { db } from '@/lib/db';
import { runners, plannedScreenshots, userInvitations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth';
import * as queries from '@/lib/db/queries';

export async function deleteMyAccount(
  confirmation: string
): Promise<{ success: true } | { error: string }> {
  const session = await requireAuth();
  const user = session.user;

  const expected = (user.name || user.email).trim();
  if (!confirmation || confirmation.trim() !== expected) {
    return { error: `Confirmation does not match. Type "${expected}" exactly to confirm.` };
  }

  // If user is a team owner with other members, require ownership transfer first.
  if (user.teamId && user.role === 'owner') {
    const members = await queries.getTeamMembers(user.teamId);
    const others = members.filter((m) => m.id !== user.id);
    if (others.length > 0) {
      return {
        error:
          'You are the owner of a team with other members. Transfer ownership to another member before deleting your account.',
      };
    }
  }

  // Manual cleanup of FK references that don't have ON DELETE CASCADE.
  // - userInvitations.invitedById: nullable, preserve audit trail by NULLing
  // - plannedScreenshots.uploadedBy: nullable, screenshots belong to the team
  // - runners.createdById: NOT NULL — delete runners owned by this user
  await db.update(userInvitations).set({ invitedById: null }).where(eq(userInvitations.invitedById, user.id));
  await db.update(plannedScreenshots).set({ uploadedBy: null }).where(eq(plannedScreenshots.uploadedBy, user.id));

  if (user.teamId) {
    await db.delete(runners).where(and(eq(runners.createdById, user.id), eq(runners.teamId, user.teamId)));
  } else {
    await db.delete(runners).where(eq(runners.createdById, user.id));
  }

  // Capture team to potentially clean up after the user is gone.
  const teamId = user.teamId;

  // Delete user — cascades sessions, oauth, password/email tokens, consents, bug reports.
  await queries.deleteUser(user.id);

  // If the user was the sole member of their team, clean up the team too.
  if (teamId) {
    const remaining = await queries.getTeamMembers(teamId);
    if (remaining.length === 0) {
      await queries.deleteTeam(teamId);
    }
  }

  return { success: true };
}
