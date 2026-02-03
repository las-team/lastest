import { NextRequest, NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { sendPasswordResetEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Find user
    const user = await queries.getUserByEmail(email);

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({
        message: 'If an account exists with that email, a password reset link has been sent.',
      });
    }

    // Check if user has a password (OAuth-only users can't reset password)
    if (!user.hashedPassword) {
      return NextResponse.json({
        message: 'If an account exists with that email, a password reset link has been sent.',
      });
    }

    // Create password reset token
    const token = await queries.createPasswordResetToken(user.id);

    // Send email
    await sendPasswordResetEmail(user.email, token);

    return NextResponse.json({
      message: 'If an account exists with that email, a password reset link has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
