import { NextRequest, NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

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

  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  });
}
