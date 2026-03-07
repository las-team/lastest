const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/api/connect/github/callback';

export function getGitHubAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: 'repo read:user workflow',
    state: state || crypto.randomUUID(),
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  token_type: string;
  scope: string;
} | null> {
  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });

    if (!response.ok) return null;

    return response.json();
  } catch {
    return null;
  }
}

export async function getGitHubUser(accessToken: string): Promise<{
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
} | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) return null;

    const user = await response.json();

    // If no public email, try to get primary email from /user/emails
    if (!user.email) {
      try {
        const emailResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        });
        if (emailResponse.ok) {
          const emails = await emailResponse.json();
          const primary = emails.find((e: { primary: boolean; verified: boolean }) => e.primary && e.verified);
          if (primary) {
            user.email = primary.email;
          }
        }
      } catch {
        // Ignore email fetch errors
      }
    }

    return user;
  } catch {
    return null;
  }
}

export async function getOpenPRsForBranch(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<Array<{
  number: number;
  title: string;
  head: { ref: string; sha: string };
  base: { ref: string };
}>> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) return [];

    return response.json();
  } catch {
    return [];
  }
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
}

export async function getUserRepos(accessToken: string): Promise<GitHubRepo[]> {
  try {
    const response = await fetch(
      'https://api.github.com/user/repos?type=all&sort=updated&per_page=100',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) return [];

    return response.json();
  } catch {
    return [];
  }
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export async function getRepoBranches(
  accessToken: string,
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) return [];

    return response.json();
  } catch {
    return [];
  }
}
