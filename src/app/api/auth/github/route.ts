import { redirect } from 'next/navigation';
import { getGitHubAuthUrl } from '@/lib/github/oauth';

export async function GET() {
  const authUrl = getGitHubAuthUrl();
  redirect(authUrl);
}
