'use server';

import * as queries from '@/lib/db/queries';
import { requireAdmin, getCurrentUser } from '@/lib/auth';
import { sendInvitationEmail } from '@/lib/email';
import type { UserRole } from '@/lib/db/schema';

export async function getUsers() {
  await requireAdmin();
  return queries.getUsers();
}

export async function getPendingInvitations() {
  await requireAdmin();
  return queries.getPendingInvitations();
}

export async function inviteUser(email: string, role: UserRole = 'member') {
  const session = await requireAdmin();

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

  // Create invitation
  const token = await queries.createInvitation({
    email,
    invitedById: session.user.id,
    role,
  });

  // Send email
  const inviterName = session.user.name || session.user.email;
  await sendInvitationEmail(email, token, inviterName);

  return { success: true };
}

export async function updateUserRole(userId: string, role: UserRole) {
  const session = await requireAdmin();

  // Prevent admin from changing their own role
  if (userId === session.user.id) {
    return { error: 'You cannot change your own role' };
  }

  await queries.updateUserRole(userId, role);
  return { success: true };
}

export async function removeUser(userId: string) {
  const session = await requireAdmin();

  // Prevent admin from removing themselves
  if (userId === session.user.id) {
    return { error: 'You cannot remove yourself' };
  }

  await queries.deleteUser(userId);
  return { success: true };
}

export async function cancelInvitation(invitationId: string) {
  await requireAdmin();
  await queries.deleteInvitation(invitationId);
  return { success: true };
}

export async function resendInvitation(invitationId: string) {
  const session = await requireAdmin();

  const invitation = await queries.getInvitationByToken(invitationId);
  if (!invitation) {
    return { error: 'Invitation not found' };
  }

  // Create a new invitation (the old one will be replaced)
  const token = await queries.createInvitation({
    email: invitation.email,
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
