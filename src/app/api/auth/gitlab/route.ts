import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { getGitLabAuthUrl } from '@/lib/gitlab/oauth';

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));
  }

  const authUrl = getGitLabAuthUrl();
  return NextResponse.redirect(authUrl);
}
