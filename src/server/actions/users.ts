'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAdmin, requireTeamAccess } from '@/lib/auth';
import { sendInvitationEmail } from '@/lib/email';
import type { UserRole } from '@/lib/db/schema';

export async function getUsers() {
  const session = await requireTeamAccess();
  return queries.getTeamMembers(session.team.id);
}

export async function getPendingInvitations() {
  const session = await requireTeamAccess();
  return queries.getPendingInvitationsByTeam(session.team.id);
}

export async function inviteUser(email: string, role: UserRole = 'member') {
  const session = await requireTeamAdmin();

  // Check if user already exists
  const existingUser = await queries.getUserByEmail(email);
  if (existingUser) {
    return { error: 'A user with this email already exists' };
  }

  // Check if there's a pending invitation
  const existingInvitation = await queries.getInvitationByEmail(email);
  if (existingInvitation && !existingInvitation.acceptedAt && existingInvitation.expiresAt > new Date()) {
    return { error: 'An invitation has already been sent to this email' };
  }

  // Create invitation with team context
  const token = await queries.createInvitation({
    email,
    teamId: session.team.id,
    invitedById: session.user.id,
    role,
  });

  // Send email
  const inviterName = session.user.name || session.user.email;
  await sendInvitationEmail(email, token, inviterName);

  return { success: true };
}

export async function updateUserRole(userId: string, role: UserRole) {
  const session = await requireTeamAdmin();

  // Prevent admin from changing their own role
  if (userId === session.user.id) {
    return { error: 'You cannot change your own role' };
  }

  // Verify user is in the same team
  const targetUser = await queries.getUserById(userId);
  if (!targetUser || targetUser.teamId !== session.team.id) {
    return { error: 'User not found in your team' };
  }

  // Cannot change owner role
  if (targetUser.role === 'owner') {
    return { error: 'Cannot change the role of the team owner' };
  }

  await queries.updateUserRole(userId, role);
  return { success: true };
}

export async function removeUser(userId: string) {
  const session = await requireTeamAdmin();

  // Prevent admin from removing themselves
  if (userId === session.user.id) {
    return { error: 'You cannot remove yourself' };
  }

  // Verify user is in the same team
  const targetUser = await queries.getUserById(userId);
  if (!targetUser || targetUser.teamId !== session.team.id) {
    return { error: 'User not found in your team' };
  }

  // Cannot remove the owner
  if (targetUser.role === 'owner') {
    return { error: 'Cannot remove the team owner' };
  }

  await queries.deleteUser(userId);
  return { success: true };
}

export async function cancelInvitation(invitationId: string) {
  await requireTeamAdmin();
  await queries.deleteInvitation(invitationId);
  return { success: true };
}

export async function resendInvitation(invitationId: string) {
  const session = await requireTeamAdmin();

  const invitation = await queries.getInvitationByToken(invitationId);
  if (!invitation) {
    return { error: 'Invitation not found' };
  }

  // Verify invitation is for the same team
  if (invitation.teamId !== session.team.id) {
    return { error: 'Invitation not found' };
  }

  // Create a new invitation (the old one will be replaced)
  const token = await queries.createInvitation({
    email: invitation.email,
    teamId: session.team.id,
    invitedById: session.user.id,
    role: invitation.role as UserRole,
  });

  // Delete old invitation
  await queries.deleteInvitation(invitation.id);

  // Send email
  const inviterName = session.user.name || session.user.email;
  await sendInvitationEmail(invitation.email, token, inviterName);

  return { success: true };
}
