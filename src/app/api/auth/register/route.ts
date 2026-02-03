import { NextRequest, NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { hashPassword, validatePassword, createSessionToken, setSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, name } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
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

    // Check if user already exists
    const existingUser = await queries.getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 400 }
      );
    }

    // Check if this is the first user (make them admin)
    const userCount = await queries.getUserCount();
    const role = userCount === 0 ? 'admin' : 'member';

    // Hash password and create user
    const hashedPassword = await hashPassword(password);
    const user = await queries.createUser({
      email,
      hashedPassword,
      name: name || email.split('@')[0],
      role,
      emailVerified: false,
    });

    // Create session
    const token = await createSessionToken(user.id, request);
    await setSessionCookie(token);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
