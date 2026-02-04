import { redirect } from 'next/navigation';
import { getGitLabAuthUrl } from '@/lib/gitlab/oauth';

export async function GET() {
  const authUrl = getGitLabAuthUrl();
  redirect(authUrl);
}
