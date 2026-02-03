import { NextRequest, NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { hashPassword, validatePassword, createSessionToken, setSessionCookie } from '@/lib/auth';
import type { UserRole } from '@/lib/db/schema';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, name, password } = body;

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and password are required' },
        { status: 400 }
      );
    }

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.error },
        { status: 400 }
      );
    }

    // Get invitation
    const invitation = await queries.getInvitationByToken(token);

    if (!invitation) {
      return NextResponse.json(
        { error: 'Invitation not found' },
        { status: 404 }
      );
    }

    if (invitation.acceptedAt) {
      return NextResponse.json(
        { error: 'This invitation has already been used' },
        { status: 400 }
      );
    }

    if (invitation.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 400 }
      );
    }

    if (!invitation.teamId) {
      return NextResponse.json(
        { error: 'Invitation is missing team information' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await queries.getUserByEmail(invitation.email);
    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password and create user with team from invitation
    const hashedPassword = await hashPassword(password);
    const user = await queries.createUser({
      email: invitation.email,
      hashedPassword,
      name: name || invitation.email.split('@')[0],
      teamId: invitation.teamId,
      role: invitation.role as UserRole,
      emailVerified: true, // Invited users have verified emails
    });

    // Mark invitation as accepted
    await queries.markInvitationAccepted(token);

    // Create session
    const sessionToken = await createSessionToken(user.id, request);
    await setSessionCookie(sessionToken);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        teamId: user.teamId,
      },
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    return NextResponse.json(
      { error: 'Failed to accept invitation' },
      { status: 500 }
    );
  }
}
