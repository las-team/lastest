"use server";

import * as queries from "@/lib/db/queries";
import { requireTeamAdmin, requireTeamAccess, requireAuth } from "@/lib/auth";
import { sendInvitationEmail } from "@/lib/email";
import type { UserRole } from "@/lib/db/schema";
import { revalidatePath } from "next/cache";

/**
 * Accept a team invitation. Token-bound: the caller must be signed in, and the
 * invitation token must exist, be unexpired/unaccepted, and have been issued to
 * the signed-in user's own email. This is the ONLY path that joins a user to an
 * invited team — sign-up never auto-joins by email match (see auth.ts), so a
 * user cannot inherit a team by registering someone else's invited address.
 */
export async function acceptInvitation(
  token: string,
): Promise<{ success: true } | { error: string }> {
  const session = await requireAuth();

  const invite = await queries.getInvitationByToken(token);
  if (
    !invite ||
    invite.acceptedAt ||
    (invite.expiresAt && invite.expiresAt < new Date())
  ) {
    return { error: "This invitation is invalid or has expired" };
  }

  // The invitation must have been issued to this signed-in user's email
  // (invites are stored lowercased).
  if (invite.email.toLowerCase() !== session.user.email.toLowerCase()) {
    return { error: "This invitation was issued to a different email address" };
  }

  if (!invite.teamId) {
    return { error: "This invitation is not associated with a team" };
  }

  const previousTeamId = session.user.teamId;

  await queries.updateUser(session.user.id, {
    teamId: invite.teamId,
    role: (invite.role as UserRole) ?? "member",
  });
  await queries.markInvitationAccepted(invite.token);

  // Best-effort cleanup: if the user was moving out of a personal team that is
  // now empty (no other members, no repos), drop it so we don't leave orphans.
  if (previousTeamId && previousTeamId !== invite.teamId) {
    try {
      const [members, repos] = await Promise.all([
        queries.getTeamMembers(previousTeamId),
        queries.getRepositoriesByTeam(previousTeamId),
      ]);
      if (members.length === 0 && repos.length === 0) {
        await queries.deleteTeam(previousTeamId);
      }
    } catch {
      // Non-fatal — an orphaned empty team is harmless.
    }
  }

  revalidatePath("/");
  return { success: true };
}

export async function getUsers() {
  const session = await requireTeamAccess();
  return queries.getTeamMembers(session.team.id);
}

export async function getPendingInvitations() {
  const session = await requireTeamAccess();
  return queries.getPendingInvitationsByTeam(session.team.id);
}

export async function inviteUser(email: string, role: UserRole = "member") {
  const session = await requireTeamAdmin();

  // Only an owner may mint an owner-level invitation. Without this, a non-owner
  // admin could introduce a new owner-role member.
  if (role === "owner" && session.user.role !== "owner") {
    return { error: "Only the team owner can grant the owner role" };
  }

  // Check if user already exists
  const existingUser = await queries.getUserByEmail(email);
  if (existingUser) {
    return { error: "A user with this email already exists" };
  }

  // Check if there's a pending invitation
  const existingInvitation = await queries.getInvitationByEmail(email);
  if (
    existingInvitation &&
    !existingInvitation.acceptedAt &&
    existingInvitation.expiresAt > new Date()
  ) {
    return { error: "An invitation has already been sent to this email" };
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
    return { error: "You cannot change your own role" };
  }

  // Verify user is in the same team
  const targetUser = await queries.getUserById(userId);
  if (!targetUser || targetUser.teamId !== session.team.id) {
    return { error: "User not found in your team" };
  }

  // Cannot change owner role
  if (targetUser.role === "owner") {
    return { error: "Cannot change the role of the team owner" };
  }

  // Only an owner may promote a member to owner.
  if (role === "owner" && session.user.role !== "owner") {
    return { error: "Only the team owner can grant the owner role" };
  }

  await queries.updateUserRole(userId, role);
  return { success: true };
}

export async function removeUser(userId: string) {
  const session = await requireTeamAdmin();

  // Prevent admin from removing themselves
  if (userId === session.user.id) {
    return { error: "You cannot remove yourself" };
  }

  // Verify user is in the same team
  const targetUser = await queries.getUserById(userId);
  if (!targetUser || targetUser.teamId !== session.team.id) {
    return { error: "User not found in your team" };
  }

  // Cannot remove the owner
  if (targetUser.role === "owner") {
    return { error: "Cannot remove the team owner" };
  }

  await queries.deleteUser(userId);
  return { success: true };
}

export async function cancelInvitation(invitationId: string) {
  const session = await requireTeamAdmin();
  const invitation = await queries.getInvitationById(invitationId);
  if (!invitation || invitation.teamId !== session.team.id) {
    return { error: "Invitation not found" };
  }
  await queries.deleteInvitation(invitation.id);
  return { success: true };
}

export async function resendInvitation(invitationId: string) {
  const session = await requireTeamAdmin();

  const invitation = await queries.getInvitationById(invitationId);
  if (!invitation) {
    return { error: "Invitation not found" };
  }

  // Verify invitation is for the same team
  if (invitation.teamId !== session.team.id) {
    return { error: "Invitation not found" };
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
